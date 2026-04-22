// ─── IMPORTS ──────────────────────────────────────────────────────────────────
import { CONFIG } from './config.js';
import { auth } from './auth.js';
import {
  UserAPI, AssetAPI, GenerateAPI, LLMAPI, PayloadBuilders,
} from './api.js';

// ─── DEBUG: inspect granted scopes from the access-token JWT ─────────────────
function debugTokenScopes() {
  const raw = sessionStorage.getItem('ta_session');
  if (!raw) return;
  try {
    const session = JSON.parse(raw);
    const token = session.accessToken;
    if (!token || token.split('.').length !== 3) {
      console.warn('[auth] accessToken is not a JWT:', token);
      return;
    }
    const payloadB64 = token.split('.')[1]
      .replace(/-/g, '+').replace(/_/g, '/');
    const pad = 4 - (payloadB64.length % 4);
    const padded = pad !== 4 ? payloadB64 + '='.repeat(pad) : payloadB64;
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    console.log('[auth] Token scopes:', payload.scope);
    console.log('[auth] Token payload:', payload);
  } catch (e) {
    console.error('[auth] Failed to decode token:', e);
  }
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const TABS = ['user', 'characters', 'elementums', 'make-image', 'make-video', 'make-song', 'travel-campaign', 'llm'];
let activeTab = '';

// Polling timers
const timers = {
  image: null,
  video: null,
  song: null,
};

// Pagination
const pages = {
  chars: 0,
  elems: 0,
  imgArtifacts: 0,
  videoArtifacts: 0,
  audioArtifacts: 0,
};

// Cached profile
let cachedProfile = null;

// LLM conversation
let llmMessages = [];

// Owned TCP UUIDs (for edit permission check)
const ownedTCPs = {
  characters: new Set(),
  elementums: new Set(),
};

function stale(tab) { return activeTab !== tab; }

// ─── TAB ROUTING ──────────────────────────────────────────────────────────────
function showTab(tab) {
  activeTab = tab;
  TABS.forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('hidden', t !== tab);
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('border-violet-500', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('border-transparent', !active);
    btn.classList.toggle('text-gray-400', !active);
  });

  if (tab === 'user') loadUserTab();
  if (tab === 'characters') { pages.chars = 0; loadCharacters(true); }
  if (tab === 'elementums') { pages.elems = 0; loadElementums(true); }
  if (tab === 'make-image') { pages.imgArtifacts = 0; loadArtifactsByModality('PICTURE', true); loadTaskPool('image'); }
  if (tab === 'make-video') { pages.videoArtifacts = 0; loadArtifactsByModality('VIDEO', true); loadTaskPool('video'); }
  if (tab === 'make-song') { pages.audioArtifacts = 0; loadArtifactsByModality('AUDIO', true); loadTaskPool('audio'); }
  if (tab === 'travel-campaign') loadCampaigns();
  if (tab === 'llm') renderLLMMessages();

  // Stop polling when leaving generate tabs
  if (tab !== 'make-image' && timers.image) { clearInterval(timers.image); timers.image = null; }
  if (tab !== 'make-video' && timers.video) { clearInterval(timers.video); timers.video = null; }
  if (tab !== 'make-song' && timers.song) { clearInterval(timers.song); timers.song = null; }
}

// ─── USER TAB ─────────────────────────────────────────────────────────────────
async function loadUserTab() {
  const loading = document.getElementById('user-loading');
  const content = document.getElementById('user-content');
  loading.classList.remove('hidden');
  content.classList.add('hidden');

  try {
    const [user, apInfo, apDelta] = await Promise.all([
      UserAPI.getProfile(),
      UserAPI.getApInfo(),
      UserAPI.getApDeltaInfo(null, 10),
    ]);
    if (stale('user')) return;
    cachedProfile = user;

    const avatarEl = document.getElementById('user-avatar');
    if (user.avatar_url) avatarEl.src = user.avatar_url;
    else avatarEl.removeAttribute('src');
    document.getElementById('user-name').textContent = user.nick_name || '(no name)';

    const apCurrent = user.ap_info?.ap ?? user.ap_current ?? 0;
    const apLimit = user.ap_info?.ap_limit ?? user.ap_limit ?? 0;
    const pct = apLimit > 0 ? (apCurrent / apLimit) * 100 : 0;
    document.getElementById('ap-bar').style.width = `${Math.min(pct, 100)}%`;
    document.getElementById('ap-text').textContent = `${apCurrent} / ${apLimit}`;

    document.getElementById('ap-info-raw').textContent = JSON.stringify(apInfo, null, 2);

    const deltaLoading = document.getElementById('ap-delta-loading');
    const deltaEmpty = document.getElementById('ap-delta-empty');
    const deltaTable = document.getElementById('ap-delta-table');
    const deltaBody = document.getElementById('ap-delta-body');

    const deltas = apDelta.list ?? [];
    if (deltas.length === 0) {
      deltaLoading.classList.add('hidden');
      deltaEmpty.classList.remove('hidden');
      deltaTable.classList.add('hidden');
    } else {
      deltaLoading.classList.add('hidden');
      deltaEmpty.classList.add('hidden');
      deltaTable.classList.remove('hidden');
      deltaBody.innerHTML = deltas.map(d => `
        <tr class="border-b border-gray-800">
          <td class="py-2">${escapeHtml(d.type ?? '-')}</td>
          <td class="py-2 ${(d.amount ?? 0) < 0 ? 'text-red-400' : 'text-green-400'}">${d.amount ?? 0}</td>
          <td class="py-2 text-gray-500">${escapeHtml(d.ctime ?? '-')}</td>
        </tr>
      `).join('');
    }

    loading.classList.add('hidden');
    content.classList.remove('hidden');
  } catch (e) {
    loading.textContent = `Error: ${e.message}`;
  }
}

// ─── CONFIG PARSER ────────────────────────────────────────────────────────────
function parseConfig(item) {
  if (!item.config) return {};
  if (typeof item.config === 'string') {
    try { return JSON.parse(item.config); } catch { return {}; }
  }
  return item.config;
}

// ─── GENERIC GRID HELPERS ─────────────────────────────────────────────────────
function renderTCPGrid(items, gridId, moreBtnId, pageKey, type) {
  const grid = document.getElementById(gridId);
  const moreBtn = document.getElementById(moreBtnId);
  items.forEach(item => {
    const cfg = parseConfig(item);
    const avatarUrl = cfg.avatar_img || '';
    const card = document.createElement('div');
    card.className = 'bg-gray-900 rounded-xl overflow-hidden cursor-pointer hover:ring-1 hover:ring-violet-500 transition';
    card.addEventListener('click', () => openEntityModal(item, type));
    const imgWrap = document.createElement('div');
    imgWrap.className = 'aspect-square bg-gray-800 flex items-center justify-center overflow-hidden';
    if (avatarUrl) {
      const img = document.createElement('img');
      img.src = avatarUrl;
      img.className = 'w-full h-full object-cover';
      imgWrap.appendChild(img);
    } else {
      imgWrap.innerHTML = '<span class="text-4xl">🎭</span>';
    }
    card.appendChild(imgWrap);
    const body = document.createElement('div');
    body.className = 'p-3';
    const nameEl = document.createElement('div');
    nameEl.className = 'text-sm font-medium truncate';
    nameEl.textContent = item.name || '';
    const uuidEl = document.createElement('code');
    uuidEl.className = 'text-[10px] text-violet-400 block truncate';
    uuidEl.textContent = item.uuid ?? '-';
    const statusEl = document.createElement('div');
    statusEl.className = 'text-xs text-gray-500 mt-0.5 capitalize';
    statusEl.textContent = (item.status ?? '').toLowerCase();
    body.appendChild(nameEl);
    body.appendChild(uuidEl);
    body.appendChild(statusEl);
    card.appendChild(body);
    grid.appendChild(card);
  });
  moreBtn.classList.toggle('hidden', items.length < 20);
}

// ─── CHARACTERS TAB ───────────────────────────────────────────────────────────
async function loadCharacters(reset = false) {
  const loading = document.getElementById('chars-loading');
  const grid = document.getElementById('chars-grid');
  const moreBtn = document.getElementById('btn-chars-more');
  if (reset) { grid.innerHTML = ''; pages.chars = 0; ownedTCPs.characters.clear(); }
  loading.classList.remove('hidden');
  moreBtn.classList.add('hidden');
  try {
    const profile = cachedProfile || await UserAPI.getProfile();
    const data = await AssetAPI.listMyTCPs(profile.uuid, 'oc', pages.chars);
    if (stale('characters')) return;
    const items = data.list ?? [];
    items.forEach(item => { if (item.uuid) ownedTCPs.characters.add(item.uuid); });
    renderTCPGrid(items, 'chars-grid', 'btn-chars-more', 'chars', 'character');
    loading.classList.add('hidden');
    pages.chars++;
  } catch (e) {
    loading.textContent = `Error: ${e.message}`;
  }
}

async function toggleAvatarPicker() {
  const picker = document.getElementById('char-avatar-picker');
  if (!picker.classList.contains('hidden')) {
    picker.classList.add('hidden');
    return;
  }
  picker.innerHTML = '';
  picker.classList.remove('hidden');
  try {
    const data = await GenerateAPI.listArtifacts({ page_index: 0, page_size: 12, modality: 'PICTURE', status: 'SUCCESS' });
    const items = data.list ?? [];
    if (items.length === 0) {
      picker.innerHTML = '<div class="text-xs text-gray-500 col-span-4">No picture artifacts found. Generate an image first.</div>';
      return;
    }
    items.forEach(a => {
      const thumb = document.createElement('div');
      thumb.className = 'aspect-square bg-gray-800 rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-violet-500';
      const img = document.createElement('img');
      img.src = a.url;
      img.className = 'w-full h-full object-cover';
      thumb.appendChild(img);
      thumb.addEventListener('click', () => {
        document.getElementById('char-avatar-uuid').value = a.uuid;
        picker.classList.add('hidden');
      });
      picker.appendChild(thumb);
    });
  } catch (e) {
    picker.innerHTML = `<div class="text-xs text-red-400 col-span-4">${e.message}</div>`;
  }
}

async function createCharacter() {
  const name = document.getElementById('char-name').value.trim();
  const desc = document.getElementById('char-desc').value.trim();
  const prompt = document.getElementById('char-prompt').value.trim();
  const trigger = document.getElementById('char-trigger').value.trim();
  const avatarUuid = document.getElementById('char-avatar-uuid').value.trim();
  if (!name || !prompt || !trigger || !avatarUuid) {
    showStatus('char', 'Name, prompt, trigger, and avatar UUID are required.');
    return;
  }
  showStatus('char', '');
  const btn = document.getElementById('btn-create-char');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await AssetAPI.createCharacter({
      name, description: desc, avatar_artifact_uuid: avatarUuid,
      prompt, trigger, accessibility: 'PUBLIC',
    });
    btn.disabled = false; btn.textContent = 'Create';
    document.getElementById('char-name').value = '';
    document.getElementById('char-desc').value = '';
    document.getElementById('char-prompt').value = '';
    document.getElementById('char-trigger').value = '';
    document.getElementById('char-avatar-uuid').value = '';
    pages.chars = 0; loadCharacters(true);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Create';
    showStatus('char', `Error: ${e.message}`);
  }
}

// ─── ELEMENTUMS TAB ───────────────────────────────────────────────────────────
async function loadElementums(reset = false) {
  const loading = document.getElementById('elems-loading');
  const grid = document.getElementById('elems-grid');
  const moreBtn = document.getElementById('btn-elems-more');
  if (reset) { grid.innerHTML = ''; pages.elems = 0; ownedTCPs.elementums.clear(); }
  loading.classList.remove('hidden');
  moreBtn.classList.add('hidden');
  try {
    const profile = cachedProfile || await UserAPI.getProfile();
    const data = await AssetAPI.listMyTCPs(profile.uuid, 'elementum', pages.elems);
    if (stale('elementums')) return;
    const items = data.list ?? [];
    items.forEach(item => { if (item.uuid) ownedTCPs.elementums.add(item.uuid); });
    renderTCPGrid(items, 'elems-grid', 'btn-elems-more', 'elems', 'elementum');
    loading.classList.add('hidden');
    pages.elems++;
  } catch (e) {
    loading.textContent = `Error: ${e.message}`;
  }
}

async function toggleElemArtifactPicker() {
  const picker = document.getElementById('elem-artifact-picker');
  if (!picker.classList.contains('hidden')) {
    picker.classList.add('hidden');
    return;
  }
  picker.innerHTML = '';
  picker.classList.remove('hidden');
  try {
    const data = await GenerateAPI.listArtifacts({ page_index: 0, page_size: 12, modality: 'PICTURE', status: 'SUCCESS' });
    const items = data.list ?? [];
    if (items.length === 0) {
      picker.innerHTML = '<div class="text-xs text-gray-500 col-span-4">No picture artifacts found. Generate an image first.</div>';
      return;
    }
    items.forEach(a => {
      const thumb = document.createElement('div');
      thumb.className = 'aspect-square bg-gray-800 rounded overflow-hidden cursor-pointer hover:ring-2 hover:ring-violet-500';
      const img = document.createElement('img');
      img.src = a.url;
      img.className = 'w-full h-full object-cover';
      thumb.appendChild(img);
      thumb.addEventListener('click', () => {
        document.getElementById('elem-artifact-uuid').value = a.uuid;
        picker.classList.add('hidden');
      });
      picker.appendChild(thumb);
    });
  } catch (e) {
    picker.innerHTML = `<div class="text-xs text-red-400 col-span-4">${e.message}</div>`;
  }
}

async function createElementum() {
  const name = document.getElementById('elem-name').value.trim();
  const desc = document.getElementById('elem-desc').value.trim();
  const prompt = document.getElementById('elem-prompt').value.trim();
  const artifactUuid = document.getElementById('elem-artifact-uuid').value.trim();
  if (!name || !prompt || !artifactUuid) {
    showStatus('elem', 'Name, prompt, and artifact UUID are required.');
    return;
  }
  showStatus('elem', '');
  const btn = document.getElementById('btn-create-elem');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    await AssetAPI.createElementum({
      name, description: desc, artifact_uuid: artifactUuid,
      prompt, accessibility: 'PUBLIC',
    });
    btn.disabled = false; btn.textContent = 'Create';
    document.getElementById('elem-name').value = '';
    document.getElementById('elem-desc').value = '';
    document.getElementById('elem-prompt').value = '';
    document.getElementById('elem-artifact-uuid').value = '';
    pages.elems = 0; loadElementums(true);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Create';
    showStatus('elem', `Error: ${e.message}`);
  }
}


// ─── GENERIC POLLING HELPERS ──────────────────────────────────────────────────
function setBusy(prefix, busy) {
  const btn = document.getElementById(`btn-${prefix}`);
  const spinner = document.getElementById(`${prefix.replace('make-', '')}-spinner`);
  if (btn) {
    btn.disabled = busy;
    const labels = { 'make-image': 'Generate Image', 'make-video': 'Generate Video', 'make-song': 'Generate Song' };
    btn.textContent = busy ? 'Generating…' : labels[prefix];
  }
  if (spinner) spinner.classList.toggle('hidden', !busy);
}

function showStatus(prefix, msg) {
  const el = document.getElementById(`${prefix}-status`);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function startPolling(timerKey, taskId, onSuccess, maxRetries = 150) {
  let retries = 0;
  const spinnerText = document.getElementById(`${timerKey}-spinner-text`);
  if (timers[timerKey]) clearInterval(timers[timerKey]);
  timers[timerKey] = setInterval(async () => {
    retries++;
    if (retries > maxRetries) {
      clearInterval(timers[timerKey]); timers[timerKey] = null;
      setBusy(`make-${timerKey}`, false);
      showStatus(timerKey, 'Generation timed out. Please check artifacts later.');
      return;
    }
    try {
      const task = await GenerateAPI.getRawTask(taskId);
      if (spinnerText) spinnerText.textContent = `Generating… (${task.status})`;
      if (task.status === 'SUCCESS') {
        clearInterval(timers[timerKey]); timers[timerKey] = null;
        setBusy(`make-${timerKey}`, false);
        onSuccess(task);
      } else if (task.status === 'FAILURE') {
        clearInterval(timers[timerKey]); timers[timerKey] = null;
        setBusy(`make-${timerKey}`, false);
        showStatus(timerKey, 'Generation failed. Please try again.');
      }
    } catch (e) {
      clearInterval(timers[timerKey]); timers[timerKey] = null;
      setBusy(`make-${timerKey}`, false);
      showStatus(timerKey, `Poll error: ${e.message}`);
    }
  }, 2000);
}

// ─── MAKE IMAGE TAB ───────────────────────────────────────────────────────────
async function startMakeImage() {
  const prompt = document.getElementById('img-prompt').value.trim();
  if (!prompt) return;
  const width = parseInt(document.getElementById('img-width').value, 10) || 512;
  const height = parseInt(document.getElementById('img-height').value, 10) || 512;
  const model = document.getElementById('img-model').value;
  document.getElementById('image-result').classList.add('hidden');
  showStatus('image', '');
  setBusy('make-image', true);
  try {
    const payload = PayloadBuilders.buildMakeImage(prompt, { width, height, contextModelSeries: model });
    const taskId = await GenerateAPI.makeImage(payload);
    startPolling('image', taskId, (task) => {
      const img = document.getElementById('image-result');
      img.src = task.url;
      img.classList.remove('hidden');
      pages.imgArtifacts = 0; loadArtifactsByModality('PICTURE', true);
    });
  } catch (e) {
    setBusy('make-image', false);
    showStatus('image', `Error: ${e.message}`);
  }
}

// ─── MAKE VIDEO TAB ───────────────────────────────────────────────────────────
async function startMakeVideo() {
  const prompt = document.getElementById('video-prompt').value.trim();
  if (!prompt) return;
  const model = document.getElementById('video-model').value;
  document.getElementById('video-result').classList.add('hidden');
  showStatus('video', '');
  setBusy('make-video', true);
  try {
    const payload = PayloadBuilders.buildMakeVideo(prompt, { contextModelSeries: model });
    const taskId = await GenerateAPI.makeVideo(payload);
    startPolling('video', taskId, (task) => {
      const vid = document.getElementById('video-result');
      vid.src = task.url;
      vid.classList.remove('hidden');
      pages.videoArtifacts = 0; loadArtifactsByModality('VIDEO', true);
    });
  } catch (e) {
    setBusy('make-video', false);
    showStatus('video', `Error: ${e.message}`);
  }
}

// ─── MAKE SONG TAB ────────────────────────────────────────────────────────────
async function startMakeSong() {
  const prompt = document.getElementById('song-prompt').value.trim();
  const lyrics = document.getElementById('song-lyrics').value.trim();
  if (!prompt || !lyrics) return;
  document.getElementById('song-result').classList.add('hidden');
  showStatus('song', '');
  setBusy('make-song', true);
  try {
    const payload = PayloadBuilders.buildMakeSong(prompt, lyrics);
    const taskId = await GenerateAPI.makeSong(payload);
    startPolling('song', taskId, (task) => {
      const audio = document.getElementById('song-result');
      audio.src = task.url;
      audio.classList.remove('hidden');
      pages.audioArtifacts = 0; loadArtifactsByModality('AUDIO', true);
    });
  } catch (e) {
    setBusy('make-song', false);
    showStatus('song', `Error: ${e.message}`);
  }
}

// ─── ARTIFACT LISTS PER MODALITY ──────────────────────────────────────────────
async function loadArtifactsByModality(modality, reset = false) {
  const map = {
    PICTURE: { loading: 'img-artifacts-loading', grid: 'img-artifacts-grid', more: 'btn-img-artifacts-more', pageKey: 'imgArtifacts', filter: 'img-artifacts-hide-failures' },
    VIDEO:   { loading: 'video-artifacts-loading', grid: 'video-artifacts-grid', more: 'btn-video-artifacts-more', pageKey: 'videoArtifacts', filter: 'video-artifacts-hide-failures' },
    AUDIO:   { loading: 'audio-artifacts-loading', grid: 'audio-artifacts-grid', more: 'btn-audio-artifacts-more', pageKey: 'audioArtifacts', filter: 'audio-artifacts-hide-failures' },
  };
  const cfg = map[modality];
  const loading = document.getElementById(cfg.loading);
  const grid = document.getElementById(cfg.grid);
  const moreBtn = document.getElementById(cfg.more);
  if (reset) { grid.innerHTML = ''; pages[cfg.pageKey] = 0; }
  loading.classList.remove('hidden');
  moreBtn.classList.add('hidden');
  try {
    const data = await GenerateAPI.listArtifacts({
      page_index: pages[cfg.pageKey],
      page_size: 12,
      modality,
    });
    const modalityTab = { PICTURE: 'make-image', VIDEO: 'make-video', AUDIO: 'make-song' };
    if (stale(modalityTab[modality])) return;
    let items = data.list ?? [];
    const total = data.total ?? 0;

    /* client-side filter */
    const filterEl = document.getElementById(cfg.filter);
    if (filterEl && filterEl.checked) {
      items = items.filter(a => a.status === 'SUCCESS');
    }

    items.forEach(a => {
      const card = document.createElement('div');
      card.className = 'bg-gray-900 rounded-xl overflow-hidden cursor-pointer hover:ring-1 hover:ring-violet-500 transition';
      card.addEventListener('click', () => openArtifactModal(a));

      /* Media thumbnail */
      const imgWrap = document.createElement('div');
      imgWrap.className = 'aspect-square bg-gray-800 flex items-center justify-center overflow-hidden';
      if (a.url && modality === 'PICTURE') {
        const img = document.createElement('img');
        img.src = a.url; img.className = 'w-full h-full object-cover';
        imgWrap.appendChild(img);
      } else if (a.url && modality === 'VIDEO') {
        const vid = document.createElement('video');
        vid.src = a.url; vid.className = 'w-full h-full object-cover'; vid.muted = true;
        imgWrap.appendChild(vid);
      } else if (modality === 'AUDIO') {
        imgWrap.innerHTML = '<span class="text-3xl">🎵</span>';
      } else {
        const label = document.createElement('span');
        label.className = 'text-xs text-gray-500 uppercase';
        label.textContent = modality;
        imgWrap.appendChild(label);
      }
      card.appendChild(imgWrap);

      /* Info body */
      const body = document.createElement('div');
      body.className = 'p-3 space-y-1';

      const uuidRow = document.createElement('div');
      uuidRow.className = 'flex items-center gap-1';
      const uuidLabel = document.createElement('span');
      uuidLabel.className = 'text-[10px] text-gray-500 uppercase';
      uuidLabel.textContent = 'UUID';
      const uuidVal = document.createElement('code');
      uuidVal.className = 'text-[10px] text-violet-400 truncate';
      uuidVal.textContent = a.uuid ?? '-';
      uuidRow.appendChild(uuidLabel);
      uuidRow.appendChild(uuidVal);
      body.appendChild(uuidRow);

      if (a.url) {
        const urlRow = document.createElement('div');
        urlRow.className = 'flex items-center gap-1';
        const urlLabel = document.createElement('span');
        urlLabel.className = 'text-[10px] text-gray-500 uppercase';
        urlLabel.textContent = 'URL';
        const urlVal = document.createElement('a');
        urlVal.href = a.url;
        urlVal.target = '_blank';
        urlVal.className = 'text-[10px] text-blue-400 truncate';
        urlVal.textContent = a.url;
        urlRow.appendChild(urlLabel);
        urlRow.appendChild(urlVal);
        body.appendChild(urlRow);
      }

      if (modality === 'AUDIO' && a.url) {
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.className = 'w-full mt-1';
        audio.src = a.url;
        body.appendChild(audio);
      }

      const metaRow = document.createElement('div');
      metaRow.className = 'flex items-center justify-between text-[10px] text-gray-500';
      metaRow.innerHTML = `<span>${escapeHtml(a.status ?? 'UNKNOWN')}</span><span>${escapeHtml(a.ctime ?? '')}</span>`;
      body.appendChild(metaRow);

      card.appendChild(body);
      grid.appendChild(card);
    });
    loading.classList.add('hidden');
    pages[cfg.pageKey]++;
    const loaded = (pages[cfg.pageKey] - 1) * 12 + items.length;
    if (loaded < total) moreBtn.classList.remove('hidden');
  } catch (e) {
    loading.textContent = `Error: ${e.message}`;
  }
}

// ─── TRAVEL CAMPAIGN TAB ──────────────────────────────────────────────────────
async function loadCampaigns() {
  const loading = document.getElementById('campaigns-loading');
  const grid = document.getElementById('campaigns-grid');
  loading.classList.remove('hidden');
  grid.innerHTML = '';
  try {
    const profile = cachedProfile || await UserAPI.getProfile();
    const data = await AssetAPI.listCampaigns(profile.uuid, 0, 20);
    if (stale('travel-campaign')) return;
    const items = data.list ?? [];
    if (items.length === 0) {
      grid.innerHTML = '<div class="text-gray-500 text-xs col-span-full">No campaigns yet.</div>';
    } else {
      items.forEach(c => {
        const card = document.createElement('div');
        card.className = 'bg-gray-900 rounded-xl overflow-hidden cursor-pointer hover:ring-1 hover:ring-violet-500 transition';
        card.addEventListener('click', () => openEntityModal(c, 'campaign'));
        const imgWrap = document.createElement('div');
        imgWrap.className = 'aspect-video bg-gray-800 flex items-center justify-center overflow-hidden';
        if (c.header_img) {
          const img = document.createElement('img');
          img.src = c.header_img;
          img.className = 'w-full h-full object-cover';
          imgWrap.appendChild(img);
        } else {
          imgWrap.innerHTML = '<span class="text-3xl">🗺️</span>';
        }
        card.appendChild(imgWrap);
        const body = document.createElement('div');
        body.className = 'p-4';
        body.innerHTML = `
          <div class="text-sm font-medium truncate">${escapeHtml(c.name || '(no name)')}</div>
          <code class="text-[10px] text-violet-400 block truncate">${escapeHtml(c.uuid ?? '-')}</code>
          <div class="text-xs text-gray-500 mt-1">${escapeHtml(c.status ?? 'UNKNOWN')}</div>
          <div class="text-xs text-gray-600 mt-1 truncate">${escapeHtml(c.subtitle || '')}</div>
        `;
        card.appendChild(body);
        grid.appendChild(card);
      });
    }
    loading.classList.add('hidden');
  } catch (e) {
    loading.textContent = `Error: ${e.message}`;
  }
}

async function createCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  const subtitle = document.getElementById('camp-subtitle').value.trim();
  const plot = document.getElementById('camp-plot').value.trim();
  const headerImg = document.getElementById('camp-header-img').value.trim();
  if (!name || !plot) {
    showStatus('camp', 'Name and plot are required.');
    return;
  }
  showStatus('camp', '');
  const btn = document.getElementById('btn-create-campaign');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const payload = { name, subtitle, mission_plot: plot, status: 'PUBLISHED' };
    if (headerImg) payload.header_img = headerImg;
    await AssetAPI.createCampaign(payload);
    btn.disabled = false; btn.textContent = 'Create';
    document.getElementById('camp-name').value = '';
    document.getElementById('camp-subtitle').value = '';
    document.getElementById('camp-plot').value = '';
    document.getElementById('camp-header-img').value = '';
    loadCampaigns();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Create';
    showStatus('camp', `Error: ${e.message}`);
  }
}

// ─── TCP SEARCH ───────────────────────────────────────────────────────────────
async function searchTCPs(type) {
  const inputId = type === 'oc' ? 'char-search' : 'elem-search';
  const gridId = type === 'oc' ? 'chars-grid' : 'elems-grid';
  const loadingId = type === 'oc' ? 'chars-loading' : 'elems-loading';
  const moreBtnId = type === 'oc' ? 'btn-chars-more' : 'btn-elems-more';
  const headingId = type === 'oc' ? 'chars-heading' : 'elems-heading';
  const keywords = document.getElementById(inputId).value.trim();
  if (!keywords) return;

  const loading = document.getElementById(loadingId);
  const grid = document.getElementById(gridId);
  const moreBtn = document.getElementById(moreBtnId);
  const heading = document.getElementById(headingId);
  grid.innerHTML = '';
  loading.classList.remove('hidden');
  moreBtn.classList.add('hidden');
  if (heading) heading.textContent = `Search results for "${keywords}"`;

  try {
    const data = await AssetAPI.searchTCPs(keywords, 0, 20, type);
    if (stale(type === 'oc' ? 'characters' : 'elementums')) return;
    const items = data.list ?? [];
    renderTCPGrid(items, gridId, moreBtnId, type === 'oc' ? 'chars' : 'elems', type === 'oc' ? 'character' : 'elementum');
    loading.classList.add('hidden');
  } catch (e) {
    loading.textContent = `Error: ${e.message}`;
  }
}

function clearTCPSearch(type) {
  const inputId = type === 'oc' ? 'char-search' : 'elem-search';
  const headingId = type === 'oc' ? 'chars-heading' : 'elems-heading';
  document.getElementById(inputId).value = '';
  const heading = document.getElementById(headingId);
  if (heading) heading.textContent = type === 'oc' ? 'My Characters' : 'My Elementums';
  if (type === 'oc') { pages.chars = 0; loadCharacters(true); }
  else { pages.elems = 0; loadElementums(true); }
}

// ─── TASK POOL ────────────────────────────────────────────────────────────────
async function loadTaskPool(tabKey) {
  const elId = `${tabKey}-task-pool`;
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = '';
  try {
    const data = await GenerateAPI.getTaskPool();
    el.textContent = `Task pool — size: ${data.pool_size ?? '-'}, active: ${data.active_tasks ?? '-'} (${data.entrance ?? 'PICTURE,PURE'})`;
  } catch (e) {
    el.textContent = `Task pool unavailable: ${e.message}`;
  }
}

// ─── TCP PROFILE / CAMPAIGN DETAIL ────────────────────────────────────────────
async function viewTCPProfile(uuid, name) {
  try {
    const profile = await AssetAPI.getTCPProfile(uuid);
    alert(`TCP Profile: ${name || uuid}\n\n${JSON.stringify(profile, null, 2)}`);
  } catch (e) {
    alert(`Failed to load profile: ${e.message}`);
  }
}

async function fetchCampaignDetail(uuid) {
  try {
    const detail = await AssetAPI.getCampaign(uuid);
    currentEntity = detail;
    openEntityModal(detail, 'campaign');
  } catch (e) {
    alert(`Failed to load campaign detail: ${e.message}`);
  }
}

// ─── UPLOAD PICTURE ───────────────────────────────────────────────────────────
async function uploadPicture() {
  const input = document.getElementById('img-upload-file');
  const file = input.files[0];
  if (!file) return;
  const suffix = file.name.split('.').pop() || 'webp';
  showStatus('upload', '');
  const btn = document.getElementById('btn-upload-picture');
  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    const { upload_url, view_url } = await GenerateAPI.getUploadSignedUrl(suffix);
    const res = await fetch(upload_url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (!res.ok) throw new Error(`OSS upload failed: ${res.status}`);
    await GenerateAPI.createPictureFromUrl(view_url);
    input.value = '';
    btn.disabled = false; btn.textContent = 'Upload';
    pages.imgArtifacts = 0;
    loadArtifactsByModality('PICTURE', true);
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Upload';
    showStatus('upload', `Error: ${e.message}`);
  }
}

// ─── LLM CHAT TAB ─────────────────────────────────────────────────────────────
function renderLLMMessages() {
  const container = document.getElementById('llm-messages');
  container.innerHTML = '';
  llmMessages.forEach((m, i) => {
    const bubble = document.createElement('div');
    bubble.className = `flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`;
    const inner = document.createElement('div');
    inner.className = `max-w-[80%] rounded-xl px-4 py-2 text-sm ${
      m.role === 'user' ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-200'
    }`;
    inner.textContent = m.content;
    bubble.appendChild(inner);
    container.appendChild(bubble);
  });
  container.scrollTop = container.scrollHeight;
}

async function sendLLMMessage() {
  const input = document.getElementById('llm-prompt');
  const prompt = input.value.trim();
  if (!prompt) return;
  const model = document.getElementById('llm-model').value;
  const systemPrompt = document.getElementById('llm-system').value.trim();

  showStatus('llm', '');
  llmMessages.push({ role: 'user', content: prompt });
  llmMessages.push({ role: 'assistant', content: '' });
  renderLLMMessages();

  const container = document.getElementById('llm-messages');
  const assistantInner = container.lastElementChild?.firstElementChild;

  input.value = '';
  const btn = document.getElementById('btn-llm-send');
  btn.disabled = true;

  const apiMessages = [];
  if (systemPrompt) apiMessages.push({ role: 'system', content: systemPrompt });
  apiMessages.push(...llmMessages.filter(m => m.content));

  await LLMAPI.streamChatCompletion(
    apiMessages,
    (delta) => {
      llmMessages[llmMessages.length - 1].content += delta;
      if (assistantInner && activeTab === 'llm') {
        assistantInner.textContent = llmMessages[llmMessages.length - 1].content;
        container.scrollTop = container.scrollHeight;
      }
    },
    () => { btn.disabled = false; },
    (err) => {
      btn.disabled = false;
      llmMessages[llmMessages.length - 1].content += `\n[Error: ${err.message}]`;
      if (assistantInner && activeTab === 'llm') {
        assistantInner.textContent = llmMessages[llmMessages.length - 1].content;
      } else if (activeTab === 'llm') {
        renderLLMMessages();
      }
    },
    { model }
  );
}

function clearLLM() {
  llmMessages = [];
  renderLLMMessages();
}

// ─── MODALS ───────────────────────────────────────────────────────────────────

/* Artifact detail modal */
async function openArtifactModal(a) {
  const modal = document.getElementById('artifact-modal');
  const media = document.getElementById('artifact-modal-media');
  const fields = document.getElementById('artifact-modal-fields');
  const raw = document.getElementById('artifact-modal-raw');

  media.innerHTML = '';
  const safeMediaUrl = safeUrl(a.url);
  if (safeMediaUrl) {
    if (a.modality === 'PICTURE') {
      media.innerHTML = `<img src="${escapeHtml(safeMediaUrl)}" class="w-full object-cover rounded-xl" />`;
    } else if (a.modality === 'VIDEO') {
      media.innerHTML = `<video src="${escapeHtml(safeMediaUrl)}" controls class="w-full rounded-xl"></video>`;
    } else if (a.modality === 'AUDIO') {
      media.innerHTML = `<audio src="${escapeHtml(safeMediaUrl)}" controls class="w-full rounded-xl"></audio>`;
    }
  } else {
    media.innerHTML = `<div class="text-center py-8 text-gray-500 text-sm">No media available</div>`;
  }

  const safeArtifactUrl = safeUrl(a.url);
  fields.innerHTML = `
    <div class="flex justify-between border-b border-gray-800 py-1"><span class="text-gray-500">UUID</span><code class="text-violet-400">${escapeHtml(a.uuid ?? '-')}</code></div>
    <div class="flex justify-between border-b border-gray-800 py-1"><span class="text-gray-500">Status</span><span>${escapeHtml(a.status ?? 'UNKNOWN')}</span></div>
    <div class="flex justify-between border-b border-gray-800 py-1"><span class="text-gray-500">Modality</span><span>${escapeHtml(a.modality ?? '-')}</span></div>
    <div class="flex justify-between border-b border-gray-800 py-1"><span class="text-gray-500">Created</span><span>${escapeHtml(a.ctime ?? '-')}</span></div>
    ${safeArtifactUrl ? `<div class="flex justify-between border-b border-gray-800 py-1"><span class="text-gray-500">URL</span><a href="${escapeHtml(safeArtifactUrl)}" target="_blank" class="text-blue-400 truncate max-w-[60%]">${escapeHtml(safeArtifactUrl)}</a></div>` : ''}
  `;

  /* Fetch detailed info (includes input/prompt) */
  try {
    const details = await GenerateAPI.getArtifactDetails(a.uuid);
    const detail = Array.isArray(details) ? details[0] : details;
    if (detail && detail.input) {
      const promptText = typeof detail.input === 'string' ? detail.input : JSON.stringify(detail.input, null, 2);
      fields.innerHTML += `<div class="border-b border-gray-800 py-1"><span class="text-gray-500 block">Input / Prompt</span><pre class="text-xs text-gray-300 bg-gray-950 rounded p-2 mt-1 overflow-auto max-h-32">${escapeHtml(promptText)}</pre></div>`;
    }
    raw.textContent = JSON.stringify(detail ?? a, null, 2);
  } catch (e) {
    raw.textContent = JSON.stringify(a, null, 2);
  }

  /* Fetch artifact task result */
  try {
    const task = await GenerateAPI.getArtifactTask(a.uuid);
    if (task) {
      fields.innerHTML += `<div class="border-b border-gray-800 py-1"><span class="text-gray-500 block">Task Result</span><pre class="text-xs text-gray-300 bg-gray-950 rounded p-2 mt-1 overflow-auto max-h-32">${escapeHtml(JSON.stringify(task, null, 2))}</pre></div>`;
    }
  } catch (e) {
    /* ignore — task may not exist for uploaded artifacts */
  }

  modal.classList.remove('hidden');
}

function closeArtifactModal() {
  document.getElementById('artifact-modal').classList.add('hidden');
}

/* Entity detail / edit modal */
let currentEntity = null;
let currentEntityType = '';

function openEntityModal(item, type) {
  currentEntity = item;
  currentEntityType = type;
  const modal = document.getElementById('entity-modal');
  const title = document.getElementById('entity-modal-title');
  const content = document.getElementById('entity-modal-content');
  const editForm = document.getElementById('entity-modal-edit-form');
  const editBtn = document.getElementById('btn-entity-edit');
  const saveBtn = document.getElementById('btn-entity-save');
  const cancelBtn = document.getElementById('btn-entity-cancel');
  const statusEl = document.getElementById('entity-modal-status');

  title.textContent = type === 'campaign' ? 'Campaign Detail' : type === 'character' ? 'Character Detail' : 'Elementum Detail';
  statusEl.classList.add('hidden');
  editForm.classList.add('hidden');
  content.classList.remove('hidden');
  editBtn.classList.remove('hidden');
  saveBtn.classList.add('hidden');
  cancelBtn.classList.add('hidden');

  const isOwned = type === 'character' ? ownedTCPs.characters.has(item.uuid) :
                  type === 'elementum' ? ownedTCPs.elementums.has(item.uuid) :
                  true;
  editBtn.classList.toggle('hidden', !isOwned);

  if (type === 'character') {
    const cfg = parseConfig(item);
    const charAvatarUrl = safeUrl(cfg.avatar_img);
    content.innerHTML = `
      <div class="flex gap-4">
        <div class="w-24 h-24 bg-gray-800 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
          ${charAvatarUrl ? `<img src="${escapeHtml(charAvatarUrl)}" class="w-full h-full object-cover" />` : '<span class="text-2xl">🎭</span>'}
        </div>
        <div class="flex-1 space-y-1">
          <div class="text-sm font-medium">${escapeHtml(item.name || '(no name)')}</div>
          <code class="text-[10px] text-violet-400 block">${escapeHtml(item.uuid ?? '-')}</code>
          <div class="text-xs text-gray-500">Status: ${escapeHtml(item.status ?? 'UNKNOWN')} | Accessibility: ${escapeHtml(item.accessibility ?? '-')}</div>
          <div class="text-xs text-gray-400">${escapeHtml(item.description || '')}</div>
          <div class="text-xs text-gray-400">Latin name: ${escapeHtml(cfg.latin_name || '-')}</div>
        </div>
      </div>
      <pre class="text-xs text-gray-500 bg-gray-950 rounded-lg p-3 overflow-auto max-h-40">${JSON.stringify(item, null, 2)}</pre>
    `;
    editForm.innerHTML = `
      <input id="edit-char-name" type="text" value="${escapeHtml(item.name || '')}" placeholder="Name" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <input id="edit-char-desc" type="text" value="${escapeHtml(item.description || '')}" placeholder="Description" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <select id="edit-char-accessibility" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white">
        <option value="PUBLIC" ${item.accessibility === 'PUBLIC' ? 'selected' : ''}>PUBLIC</option>
        <option value="PRIVATE" ${item.accessibility === 'PRIVATE' ? 'selected' : ''}>PRIVATE</option>
      </select>
    `;
  } else if (type === 'elementum') {
    const cfg = parseConfig(item);
    const elemAvatarUrl = safeUrl(cfg.avatar_img);
    content.innerHTML = `
      <div class="flex gap-4">
        <div class="w-24 h-24 bg-gray-800 rounded-xl flex items-center justify-center shrink-0 overflow-hidden">
          ${elemAvatarUrl ? `<img src="${escapeHtml(elemAvatarUrl)}" class="w-full h-full object-cover" />` : '<span class="text-2xl">✨</span>'}
        </div>
        <div class="flex-1 space-y-1">
          <div class="text-sm font-medium">${escapeHtml(item.name || '(no name)')}</div>
          <code class="text-[10px] text-violet-400 block">${escapeHtml(item.uuid ?? '-')}</code>
          <div class="text-xs text-gray-500">Status: ${escapeHtml(item.status ?? 'UNKNOWN')} | Accessibility: ${escapeHtml(item.accessibility ?? '-')}</div>
          <div class="text-xs text-gray-400">${escapeHtml(item.description || '')}</div>
        </div>
      </div>
      <pre class="text-xs text-gray-500 bg-gray-950 rounded-lg p-3 overflow-auto max-h-40">${JSON.stringify(item, null, 2)}</pre>
    `;
    editForm.innerHTML = `
      <input id="edit-elem-name" type="text" value="${escapeHtml(item.name || '')}" placeholder="Name" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <input id="edit-elem-desc" type="text" value="${escapeHtml(item.description || '')}" placeholder="Description" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <select id="edit-elem-accessibility" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white">
        <option value="PUBLIC" ${item.accessibility === 'PUBLIC' ? 'selected' : ''}>PUBLIC</option>
        <option value="PRIVATE" ${item.accessibility === 'PRIVATE' ? 'selected' : ''}>PRIVATE</option>
      </select>
    `;
  } else if (type === 'campaign') {
    const campHeaderUrl = safeUrl(item.header_img);
    content.innerHTML = `
      <div class="space-y-1">
        ${campHeaderUrl ? `<img src="${escapeHtml(campHeaderUrl)}" class="w-full h-32 object-cover rounded-xl" />` : ''}
        <div class="text-sm font-medium">${escapeHtml(item.name || '(no name)')}</div>
        <code class="text-[10px] text-violet-400 block">${escapeHtml(item.uuid ?? '-')}</code>
        <div class="text-xs text-gray-500">Status: ${escapeHtml(item.status ?? 'UNKNOWN')}</div>
        <div class="text-xs text-gray-400">${escapeHtml(item.subtitle || '')}</div>
        <div class="text-xs text-gray-400 mt-2"><span class="text-gray-500">Mission Plot:</span> ${escapeHtml(item.mission_plot || '-')}</div>
        <div class="text-xs text-gray-400"><span class="text-gray-500">Mission Task:</span> ${escapeHtml(item.mission_task || '-')}</div>
      </div>
      <pre class="text-xs text-gray-500 bg-gray-950 rounded-lg p-3 overflow-auto max-h-40">${JSON.stringify(item, null, 2)}</pre>
    `;
    editForm.innerHTML = `
      <input id="edit-camp-name" type="text" value="${escapeHtml(item.name || '')}" placeholder="Name" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <input id="edit-camp-subtitle" type="text" value="${escapeHtml(item.subtitle || '')}" placeholder="Subtitle" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <textarea id="edit-camp-plot" rows="3" placeholder="Mission plot" class="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-xs text-white resize-none">${escapeHtml(item.mission_plot || '')}</textarea>
      <input id="edit-camp-task" type="text" value="${escapeHtml(item.mission_task || '')}" placeholder="Mission task" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <input id="edit-camp-header-img" type="text" value="${escapeHtml(item.header_img || '')}" placeholder="Cover image URL" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white" />
      <select id="edit-camp-status" class="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white">
        <option value="PUBLISHED" ${item.status === 'PUBLISHED' ? 'selected' : ''}>PUBLISHED</option>
        <option value="DRAFT" ${item.status === 'DRAFT' ? 'selected' : ''}>DRAFT</option>
      </select>
    `;
  }

  if (type === 'character' || type === 'elementum') {
    const profileBtn = document.createElement('button');
    profileBtn.className = 'bg-gray-800 hover:bg-gray-700 text-white text-xs py-2 px-4 rounded-lg transition mt-2';
    profileBtn.textContent = 'View Profile';
    profileBtn.addEventListener('click', () => viewTCPProfile(item.uuid, item.name));
    const pre = content.querySelector('pre');
    if (pre) content.insertBefore(profileBtn, pre);
  }
  if (type === 'campaign') {
    const detailBtn = document.createElement('button');
    detailBtn.className = 'bg-gray-800 hover:bg-gray-700 text-white text-xs py-2 px-4 rounded-lg transition mt-2';
    detailBtn.textContent = 'Fetch Full Detail';
    detailBtn.addEventListener('click', () => fetchCampaignDetail(item.uuid));
    const pre = content.querySelector('pre');
    if (pre) content.insertBefore(detailBtn, pre);
  }

  modal.classList.remove('hidden');
}

function closeEntityModal() {
  document.getElementById('entity-modal').classList.add('hidden');
  currentEntity = null;
  currentEntityType = '';
}

function toggleEntityEdit() {
  const content = document.getElementById('entity-modal-content');
  const editForm = document.getElementById('entity-modal-edit-form');
  const editBtn = document.getElementById('btn-entity-edit');
  const saveBtn = document.getElementById('btn-entity-save');
  const cancelBtn = document.getElementById('btn-entity-cancel');

  content.classList.add('hidden');
  editForm.classList.remove('hidden');
  editBtn.classList.add('hidden');
  saveBtn.classList.remove('hidden');
  cancelBtn.classList.remove('hidden');
}

function cancelEntityEdit() {
  const content = document.getElementById('entity-modal-content');
  const editForm = document.getElementById('entity-modal-edit-form');
  const editBtn = document.getElementById('btn-entity-edit');
  const saveBtn = document.getElementById('btn-entity-save');
  const cancelBtn = document.getElementById('btn-entity-cancel');

  content.classList.remove('hidden');
  editForm.classList.add('hidden');
  editBtn.classList.remove('hidden');
  saveBtn.classList.add('hidden');
  cancelBtn.classList.add('hidden');

  if (!currentEntity) return;
  if (currentEntityType === 'character') {
    document.getElementById('edit-char-name').value = currentEntity.name || '';
    document.getElementById('edit-char-desc').value = currentEntity.description || '';
    document.getElementById('edit-char-accessibility').value = currentEntity.accessibility || 'PUBLIC';
  } else if (currentEntityType === 'elementum') {
    document.getElementById('edit-elem-name').value = currentEntity.name || '';
    document.getElementById('edit-elem-desc').value = currentEntity.description || '';
    document.getElementById('edit-elem-accessibility').value = currentEntity.accessibility || 'PUBLIC';
  } else if (currentEntityType === 'campaign') {
    document.getElementById('edit-camp-name').value = currentEntity.name || '';
    document.getElementById('edit-camp-subtitle').value = currentEntity.subtitle || '';
    document.getElementById('edit-camp-plot').value = currentEntity.mission_plot || '';
    document.getElementById('edit-camp-task').value = currentEntity.mission_task || '';
    document.getElementById('edit-camp-header-img').value = currentEntity.header_img || '';
    document.getElementById('edit-camp-status').value = currentEntity.status || 'DRAFT';
  }
}

async function saveEntity() {
  if (!currentEntity || !currentEntityType) return;
  const statusEl = document.getElementById('entity-modal-status');
  statusEl.classList.add('hidden');

  try {
    if (currentEntityType === 'character') {
      const payload = {};
      const name = document.getElementById('edit-char-name').value.trim();
      const desc = document.getElementById('edit-char-desc').value.trim();
      const accessibility = document.getElementById('edit-char-accessibility').value;
      if (name) payload.name = name;
      if (desc) payload.description = desc;
      payload.accessibility = accessibility;
      await AssetAPI.updateCharacter(currentEntity.uuid, payload);
    } else if (currentEntityType === 'elementum') {
      const payload = {};
      const name = document.getElementById('edit-elem-name').value.trim();
      const desc = document.getElementById('edit-elem-desc').value.trim();
      const accessibility = document.getElementById('edit-elem-accessibility').value;
      if (name) payload.name = name;
      if (desc) payload.description = desc;
      payload.accessibility = accessibility;
      await AssetAPI.updateElementum(currentEntity.uuid, payload);
    } else if (currentEntityType === 'campaign') {
      const payload = {};
      const name = document.getElementById('edit-camp-name').value.trim();
      const subtitle = document.getElementById('edit-camp-subtitle').value.trim();
      const plot = document.getElementById('edit-camp-plot').value.trim();
      const task = document.getElementById('edit-camp-task').value.trim();
      const status = document.getElementById('edit-camp-status').value;
      const headerImg = document.getElementById('edit-camp-header-img').value.trim();
      if (name) payload.name = name;
      if (subtitle) payload.subtitle = subtitle;
      if (plot) payload.mission_plot = plot;
      if (task) payload.mission_task = task;
      payload.header_img = headerImg || undefined;
      payload.status = status;
      await AssetAPI.updateCampaign(currentEntity.uuid, payload);
    }
    closeEntityModal();
    if (currentEntityType === 'character') { pages.chars = 0; loadCharacters(true); }
    if (currentEntityType === 'elementum') { pages.elems = 0; loadElementums(true); }
    if (currentEntityType === 'campaign') loadCampaigns();
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    statusEl.classList.remove('hidden');
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? url : '';
  } catch {
    return '';
  }
}

// ─── TAB INFO MODAL ───────────────────────────────────────────────────────────
const TAB_INFO = {
  user: {
    title: 'User Profile APIs',
    endpoints: [
      { method: 'GET', path: '/v1/user/', desc: 'Current user profile' },
      { method: 'GET', path: '/v2/user/ap_info', desc: 'AP balance info' },
      { method: 'GET', path: '/v2/users/ap-delta-info', desc: 'AP delta history' },
    ],
    docs: ['SKILL.md', 'references/'],
  },
  characters: {
    title: 'Character APIs',
    endpoints: [
      { method: 'GET', path: '/v2/travel/parent?parent_type=oc', desc: 'List my characters' },
      { method: 'GET', path: '/v2/travel/parent-search?parent_type=oc', desc: 'Search characters' },
      { method: 'GET', path: '/v2/travel/parent/{uuid}/profile', desc: 'Character profile' },
      { method: 'POST', path: '/v3/oc/character', desc: 'Create character' },
      { method: 'PATCH', path: '/v3/oc/character/{uuid}', desc: 'Update character' },
      { method: 'GET', path: '/v1/artifact/list?modality=PICTURE', desc: 'Avatar picker' },
    ],
    docs: ['SKILL.md', 'references/'],
  },
  elementums: {
    title: 'Elementum APIs',
    endpoints: [
      { method: 'GET', path: '/v2/travel/parent?parent_type=elementum', desc: 'List my elementums' },
      { method: 'GET', path: '/v2/travel/parent-search?parent_type=elementum', desc: 'Search elementums' },
      { method: 'GET', path: '/v2/travel/parent/{uuid}/profile', desc: 'Elementum profile' },
      { method: 'POST', path: '/v3/oc/elementum', desc: 'Create elementum' },
      { method: 'PATCH', path: '/v3/oc/elementum/{uuid}', desc: 'Update elementum' },
      { method: 'GET', path: '/v1/artifact/list?modality=PICTURE', desc: 'Preview picker' },
    ],
    docs: ['SKILL.md', 'references/'],
  },

  'make-image': {
    title: 'Make Image / Artifact APIs',
    endpoints: [
      { method: 'POST', path: '/v3/make_image', desc: 'Generate image from prompt' },
      { method: 'GET', path: '/v1/oss/upload-signed-url', desc: 'Get pre-signed upload URL' },
      { method: 'POST', path: '/v1/artifact/picture', desc: 'Create artifact from URL' },
      { method: 'GET', path: '/v1/artifact/list', desc: 'List artifacts' },
      { method: 'GET', path: '/v1/artifact/artifact-detail', desc: 'Artifact detail (prompt)' },
      { method: 'GET', path: '/v1/artifact/task/{task_uuid}', desc: 'Artifact task result' },
      { method: 'GET', path: '/v3/task', desc: 'Poll generation task' },
      { method: 'GET', path: '/v3/task-pool', desc: 'Task pool size' },
    ],
    docs: ['SKILL.md', 'references/'],
  },
  'make-video': {
    title: 'Make Video APIs',
    endpoints: [
      { method: 'POST', path: '/v3/make_video', desc: 'Generate video from prompt' },
      { method: 'GET', path: '/v1/artifact/list', desc: 'List artifacts' },
      { method: 'GET', path: '/v1/artifact/artifact-detail', desc: 'Artifact detail' },
      { method: 'GET', path: '/v3/task', desc: 'Poll generation task' },
      { method: 'GET', path: '/v3/task-pool', desc: 'Task pool size' },
    ],
    docs: ['SKILL.md', 'references/'],
  },
  'make-song': {
    title: 'Make Song APIs',
    endpoints: [
      { method: 'POST', path: '/v3/make_song', desc: 'Generate song from lyrics' },
      { method: 'GET', path: '/v1/artifact/list', desc: 'List artifacts' },
      { method: 'GET', path: '/v1/artifact/artifact-detail', desc: 'Artifact detail' },
      { method: 'GET', path: '/v3/task', desc: 'Poll generation task' },
      { method: 'GET', path: '/v3/task-pool', desc: 'Task pool size' },
    ],
    docs: ['SKILL.md', 'references/'],
  },
  'travel-campaign': {
    title: 'Travel Campaign APIs',
    endpoints: [
      { method: 'GET', path: '/v3/travel/campaigns', desc: 'List my campaigns' },
      { method: 'GET', path: '/v3/travel/campaign/{uuid}', desc: 'Campaign detail' },
      { method: 'POST', path: '/v3/travel/campaign/', desc: 'Create campaign' },
      { method: 'PATCH', path: '/v3/travel/campaign/{uuid}', desc: 'Update campaign' },
    ],
    docs: ['SKILL.md', 'references/'],
  },
  llm: {
    title: 'LLM Chat APIs',
    endpoints: [
      { method: 'POST', path: '/chat/completions', desc: 'Stream chat completions (LiteLLM gateway)' },
    ],
    docs: ['SKILL.md', 'references/'],
  },
};

function openTabInfo(tab) {
  const info = TAB_INFO[tab];
  if (!info) return;
  document.getElementById('tab-info-title').textContent = info.title;
  document.getElementById('tab-info-content').innerHTML = `
    <div class="font-medium text-gray-300 mb-1">Endpoints</div>
    <ul class="list-disc pl-4 space-y-1">
      ${info.endpoints.map(e => `<li><span class="text-violet-400 font-mono">${e.method}</span> ${e.path} — <span class="text-gray-500">${e.desc}</span></li>`).join('')}
    </ul>
    <div class="font-medium text-gray-300 mt-3 mb-1">Reference</div>
    <div class="text-gray-500">See ${info.docs.map(d => `<code class="text-violet-400">${d}</code>`).join(' / ')} in this repo.</div>
  `;
  document.getElementById('tab-info-modal').classList.remove('hidden');
}

function closeTabInfo() {
  document.getElementById('tab-info-modal').classList.add('hidden');
}

// ─── AUTH BOOT ────────────────────────────────────────────────────────────────
function showApp() {
  document.getElementById('screen-login').classList.add('hidden');
  const app = document.getElementById('screen-app');
  app.classList.remove('hidden');
  showTab('user');
}

function showLogin() {
  document.getElementById('screen-app').classList.add('hidden');
  document.getElementById('screen-login').classList.remove('hidden');
}

async function boot() {
  const url = window.location.href;
  const params = new URLSearchParams(window.location.search);

  if (params.has('error')) {
    const msg = params.get('error_description') || params.get('error');
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('oauth_nonce');
    window.history.replaceState({}, '', window.location.pathname);
    showLogin();
    const errP = document.createElement('p');
    errP.className = 'mt-3 text-xs text-red-400';
    errP.textContent = `Auth error: ${msg}`;
    document.getElementById('btn-login').after(errP);
    return;
  }

  if (params.has('code')) {
    try {
      await auth.handleCallback(url);
      debugTokenScopes();
    } catch (err) {
      console.error('[auth] Callback failed:', err);
    }
    window.history.replaceState({}, '', window.location.pathname);
  }

  if (await auth.isAuthenticated()) {
    debugTokenScopes();
    showApp();
  } else {
    showLogin();
  }
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────
document.getElementById('btn-login').addEventListener('click', () => {
  auth.signIn().catch(err => {
    console.error('Sign-in failed:', err);
    alert('Unable to start sign-in. Please try again.');
  });
});

document.getElementById('btn-signout').addEventListener('click', () => {
  auth.signOut().catch(err => {
    console.error('Sign-out failed:', err);
    auth.signOutLocal();
    window.location.reload();
  });
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// Generate tabs
document.getElementById('btn-make-image').addEventListener('click', startMakeImage);
document.getElementById('btn-make-video').addEventListener('click', startMakeVideo);
document.getElementById('btn-make-song').addEventListener('click', startMakeSong);

// Characters
document.getElementById('btn-pick-char-avatar').addEventListener('click', toggleAvatarPicker);
document.getElementById('btn-create-char').addEventListener('click', createCharacter);
document.getElementById('btn-chars-more').addEventListener('click', () => loadCharacters(false));

// Elementums
document.getElementById('btn-pick-elem-artifact').addEventListener('click', toggleElemArtifactPicker);
document.getElementById('btn-create-elem').addEventListener('click', createElementum);
document.getElementById('btn-elems-more').addEventListener('click', () => loadElementums(false));

// Campaign
document.getElementById('btn-create-campaign').addEventListener('click', createCampaign);

// Artifact lists in generate tabs
document.getElementById('btn-img-artifacts-more').addEventListener('click', () => loadArtifactsByModality('PICTURE', false));
document.getElementById('btn-video-artifacts-more').addEventListener('click', () => loadArtifactsByModality('VIDEO', false));
document.getElementById('btn-audio-artifacts-more').addEventListener('click', () => loadArtifactsByModality('AUDIO', false));

// Artifact filters
document.getElementById('img-artifacts-hide-failures').addEventListener('change', () => { pages.imgArtifacts = 0; loadArtifactsByModality('PICTURE', true); });
document.getElementById('video-artifacts-hide-failures').addEventListener('change', () => { pages.videoArtifacts = 0; loadArtifactsByModality('VIDEO', true); });
document.getElementById('audio-artifacts-hide-failures').addEventListener('change', () => { pages.audioArtifacts = 0; loadArtifactsByModality('AUDIO', true); });

// Modals
document.getElementById('btn-close-artifact-modal').addEventListener('click', closeArtifactModal);
document.getElementById('artifact-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeArtifactModal(); });

document.getElementById('btn-close-entity-modal').addEventListener('click', closeEntityModal);
document.getElementById('entity-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeEntityModal(); });
document.getElementById('btn-entity-edit').addEventListener('click', toggleEntityEdit);
document.getElementById('btn-entity-save').addEventListener('click', saveEntity);
document.getElementById('btn-entity-cancel').addEventListener('click', cancelEntityEdit);

// Upload picture
document.getElementById('btn-upload-picture').addEventListener('click', uploadPicture);

// Tab info buttons
document.querySelectorAll('.tab-info-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTabInfo(btn.dataset.tab);
  });
});
document.getElementById('btn-close-tab-info').addEventListener('click', closeTabInfo);
document.getElementById('tab-info-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeTabInfo(); });

// LLM
document.getElementById('btn-llm-send').addEventListener('click', sendLLMMessage);
document.getElementById('btn-llm-clear').addEventListener('click', clearLLM);
document.getElementById('llm-prompt').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendLLMMessage();
  }
});

// Search
document.getElementById('btn-char-search').addEventListener('click', () => searchTCPs('oc'));
document.getElementById('btn-char-search-clear').addEventListener('click', () => clearTCPSearch('oc'));
document.getElementById('btn-elem-search').addEventListener('click', () => searchTCPs('elementum'));
document.getElementById('btn-elem-search-clear').addEventListener('click', () => clearTCPSearch('elementum'));



boot();

