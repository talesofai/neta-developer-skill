// End-to-end test of all Neta Open Platform scoped endpoints
// Uses NETA_TOKEN directly (first-party token, bypasses scope checks)

import { CONFIG } from './config.js';

const TOKEN = process.env.NETA_TOKEN;
if (!TOKEN) {
  console.error('Set NETA_TOKEN env var');
  process.exit(1);
}

const API = CONFIG.apiBase;
const LLM = CONFIG.llmGatewayEndpoint;

const results = [];

async function call(method, path, body = null, query = null, opts = {}) {
  let url = API + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += '?' + qs;
  }
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  const fetchOpts = { method, headers };
  if (body !== null) fetchOpts.body = JSON.stringify(body);
  const res = await fetch(url, fetchOpts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, text, json };
}

async function callLlm(body) {
  const res = await fetch(LLM + '/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

function record(name, r) {
  const status = r.ok ? 'PASS' : 'FAIL';
  const msg = r.ok
    ? `${r.status} OK`
    : `${r.status} ${r.text?.slice(0, 300) || ''}`;
  results.push({ name, status, msg, json: r.json });
  console.log(`[${status}] ${name}: ${msg}`);
}

// ─── USER:READ ───────────────────────────────────────────────────────────────
console.log('\n=== user:read ===');

let profile = null;
{
  const r = await call('GET', '/v1/user/');
  record('GET /v1/user/', r);
  if (r.ok && r.json) profile = r.json;
}

{
  const r = await call('GET', '/v2/user/ap_info');
  record('GET /v2/user/ap_info', r);
}

{
  const r = await call('GET', '/v2/users/ap-delta-info', null, { page_size: '5' });
  record('GET /v2/users/ap-delta-info', r);
}

// ─── ASSET:READ ──────────────────────────────────────────────────────────────
console.log('\n=== asset:read ===');

let myUserUuid = profile?.uuid || '026ad55220894a9fa80c7e13a2ec495c';

// Search characters
{
  const r = await call('GET', '/v2/travel/parent-search', null, {
    keywords: 'test',
    page_index: '0',
    page_size: '5',
    parent_type: 'oc',
  });
  record('GET /v2/travel/parent-search (oc)', r);
}

// Search elementums
{
  const r = await call('GET', '/v2/travel/parent-search', null, {
    keywords: 'style',
    page_index: '0',
    page_size: '5',
    parent_type: 'elementum',
  });
  record('GET /v2/travel/parent-search (elementum)', r);
}

// List my characters
let myChars = [];
{
  const r = await call('GET', '/v2/travel/parent', null, {
    user_uuid: myUserUuid,
    parent_type: 'oc',
    page_index: '0',
    page_size: '5',
  });
  record('GET /v2/travel/parent (my chars)', r);
  if (r.ok && r.json?.list) myChars = r.json.list;
}

// Get character profile (if any)
if (myChars.length > 0) {
  const uuid = myChars[0].uuid;
  const r = await call('GET', `/v2/travel/parent/${uuid}/profile`);
  record('GET /v2/travel/parent/{uuid}/profile', r);
} else {
  results.push({ name: 'GET /v2/travel/parent/{uuid}/profile', status: 'SKIP', msg: 'No chars to test' });
  console.log('[SKIP] GET /v2/travel/parent/{uuid}/profile: No chars');
}

// List campaigns
let myCampaigns = [];
{
  const r = await call('GET', '/v3/travel/campaigns', null, {
    user_uuid: myUserUuid,
    page_index: '0',
    page_size: '5',
  });
  record('GET /v3/travel/campaigns', r);
  if (r.ok && r.json?.list) myCampaigns = r.json.list;
}

// Get campaign detail (if any)
if (myCampaigns.length > 0) {
  const uuid = myCampaigns[0].uuid;
  const r = await call('GET', `/v3/travel/campaign/${uuid}`);
  record('GET /v3/travel/campaign/{uuid}', r);
} else {
  results.push({ name: 'GET /v3/travel/campaign/{uuid}', status: 'SKIP', msg: 'No campaigns' });
  console.log('[SKIP] GET /v3/travel/campaign/{uuid}: No campaigns');
}

// Collection details — test with a dummy uuid to verify endpoint shape
{
  const r = await call('GET', '/v3/story/story-detail', null, {
    uuids: '00000000-0000-0000-0000-000000000001',
  });
  record('GET /v3/story/story-detail', r);
}

// ─── ASSET:WRITE ─────────────────────────────────────────────────────────────
console.log('\n=== asset:write ===');

// Create collection
let newCollectionUuid = null;
{
  const r = await call('GET', '/v1/story/new-story');
  record('GET /v1/story/new-story', r);
  if (r.ok && r.json?.data?.uuid) newCollectionUuid = r.json.data.uuid;
}

// Save collection (name is required; displayData required for new INIT collections)
if (newCollectionUuid) {
  const r = await call('PUT', '/v3/story/story', {
    uuid: newCollectionUuid,
    name: 'Demo Collection',
    description: 'A showcase collection created by the developer demo.',
    status: 'PUBLISHED',
    displayData: {
      pages: [{
        images: [{
          url: 'https://oss.talesofai.com/picture/573191f9-cb60-4fdc-be82-3f48e1855ed4.webp',
          text: 'Welcome to TalesofAI Open Platform!',
        }],
      }],
    },
  });
  record('PUT /v3/story/story', r);
} else {
  results.push({ name: 'PUT /v3/story/story', status: 'SKIP', msg: 'No collection UUID' });
  console.log('[SKIP] PUT /v3/story/story: No collection UUID');
}

// Publish collection
if (newCollectionUuid) {
  const r = await call('PUT', '/v1/story/story-publish', null, {
    storyId: newCollectionUuid,
    triggerTCPCommentNow: 'false',
    triggerSameStyleReply: 'false',
    sync_mode: 'false',
  });
  record('PUT /v1/story/story-publish', r);
} else {
  results.push({ name: 'PUT /v1/story/story-publish', status: 'SKIP', msg: 'No collection UUID' });
  console.log('[SKIP] PUT /v1/story/story-publish: No collection UUID');
}

// Fetch an existing image artifact to use for character/elementum creation
let sampleArtifactUuid = null;
{
  const r = await call('GET', '/v1/artifact/list', null, {
    page_index: '0',
    page_size: '10',
    modality: 'PICTURE',
    status: 'SUCCESS',
  });
  if (r.ok && r.json?.list) {
    const art = r.json.list.find(a => a.modality === 'PICTURE' && a.status === 'SUCCESS');
    if (art) sampleArtifactUuid = art.uuid;
  }
}

// Create character
let newCharUuid = null;
if (sampleArtifactUuid) {
  const r = await call('POST', '/v3/oc/character', {
    name: 'E2E Test Char',
    description: 'Auto-created test character',
    avatar_artifact_uuid: sampleArtifactUuid,
    prompt: 'a cute anime character with blue hair',
    trigger: '1girl, blue hair, anime style',
    accessibility: 'PUBLIC',
  });
  record('POST /v3/oc/character', r);
  if (r.ok && r.json?.uuid) newCharUuid = r.json.uuid;
} else {
  results.push({ name: 'POST /v3/oc/character', status: 'SKIP', msg: 'No image artifact for avatar' });
  console.log('[SKIP] POST /v3/oc/character: No image artifact');
}

// Update character
if (newCharUuid) {
  const r = await call('PATCH', `/v3/oc/character/${newCharUuid}`, {
    name: 'E2E Test Char Updated',
  });
  record('PATCH /v3/oc/character/{uuid}', r);
} else {
  results.push({ name: 'PATCH /v3/oc/character/{uuid}', status: 'SKIP', msg: 'No char UUID' });
  console.log('[SKIP] PATCH /v3/oc/character/{uuid}: No char UUID');
}

// Create elementum
let newElementumUuid = null;
if (sampleArtifactUuid) {
  const r = await call('POST', '/v3/oc/elementum', {
    name: 'E2E Test Style',
    description: 'Auto-created test style',
    artifact_uuid: sampleArtifactUuid,
    prompt: 'watercolor painting style, soft colors',
    accessibility: 'PUBLIC',
  });
  record('POST /v3/oc/elementum', r);
  if (r.ok && r.json?.uuid) newElementumUuid = r.json.uuid;
} else {
  results.push({ name: 'POST /v3/oc/elementum', status: 'SKIP', msg: 'No image artifact for preview' });
  console.log('[SKIP] POST /v3/oc/elementum: No image artifact');
}

// Update elementum
if (newElementumUuid) {
  const r = await call('PATCH', `/v3/oc/elementum/${newElementumUuid}`, {
    name: 'E2E Test Style Updated',
  });
  record('PATCH /v3/oc/elementum/{uuid}', r);
} else {
  results.push({ name: 'PATCH /v3/oc/elementum/{uuid}', status: 'SKIP', msg: 'No elementum UUID' });
  console.log('[SKIP] PATCH /v3/oc/elementum/{uuid}: No elementum UUID');
}

// Create campaign
let newCampaignUuid = null;
{
  const r = await call('POST', '/v3/travel/campaign/', {
    name: 'E2E Test Campaign',
    subtitle: 'Auto-created test campaign',
    mission_plot: 'The hero discovers a hidden village in the mountains.',
    mission_task: 'Explore the village and find the ancient artifact.',
    status: 'DRAFT',
  });
  record('POST /v3/travel/campaign/', r);
  if (r.ok && r.json?.uuid) newCampaignUuid = r.json.uuid;
}

// Update campaign
if (newCampaignUuid) {
  const r = await call('PATCH', `/v3/travel/campaign/${newCampaignUuid}`, {
    name: 'E2E Test Campaign Updated',
  });
  record('PATCH /v3/travel/campaign/{uuid}', r);
} else {
  results.push({ name: 'PATCH /v3/travel/campaign/{uuid}', status: 'SKIP', msg: 'No campaign UUID' });
  console.log('[SKIP] PATCH /v3/travel/campaign/{uuid}: No campaign UUID');
}

// ─── GENERATE ────────────────────────────────────────────────────────────────
console.log('\n=== generate ===');

// make_image with 3_noobxl
let imageTaskId = null;
{
  const r = await call('POST', '/v3/make_image', {
    jobType: 'universal',
    width: 512,
    height: 512,
    rawPrompt: [{ type: 'freetext', value: 'a blue circle on white background', weight: 1.0 }],
    meta: { entrance: 'PICTURE,PURE' },
    context_model_series: '3_noobxl',
  });
  record('POST /v3/make_image', r);
  // Response is plain string UUID in quotes
  if (r.ok && r.text) {
    try {
      imageTaskId = JSON.parse(r.text);
    } catch {
      imageTaskId = r.text.replace(/^"|"$/g, '');
    }
  }
}

// make_video with volc_seedance_fast_i2v_upscale
let videoTaskId = null;
{
  const r = await call('POST', '/v3/make_video', {
    jobType: 'universal',
    width: -1,
    height: -1,
    rawPrompt: [{ type: 'freetext', value: 'a glowing orb floating in space', weight: 1.0 }],
    meta: { entrance: 'VIDEO,PURE' },
    context_model_series: 'volc_seedance_fast_i2v_upscale',
  });
  record('POST /v3/make_video', r);
  if (r.ok && r.text) {
    try {
      videoTaskId = JSON.parse(r.text);
    } catch {
      videoTaskId = r.text.replace(/^"|"$/g, '');
    }
  }
}

// make_song
let songTaskId = null;
{
  const r = await call('POST', '/v3/make_song', {
    prompt: 'upbeat electronic loop for testing',
    lyrics: 'test test test test test test test test test test test',
    meta: { entrance: 'SONG,CLI' },
  });
  record('POST /v3/make_song', r);
  if (r.ok && r.text) {
    try {
      songTaskId = JSON.parse(r.text);
    } catch {
      songTaskId = r.text.replace(/^"|"$/g, '');
    }
  }
}

// STS upload token
{
  const r = await call('GET', '/v1/oss/sts-upload-token', null, { suffix: 'images' });
  record('GET /v1/oss/sts-upload-token', r);
}

// Anonymous upload token
{
  const r = await call('GET', '/v1/oss/anonymous-upload-token', null, { suffix: 'videos' });
  record('GET /v1/oss/anonymous-upload-token', r);
}

// Task pool
{
  const r = await call('GET', '/v3/task-pool', null, { entrance: 'PICTURE,PURE' });
  record('GET /v3/task-pool', r);
}

// Artifact list
let artifactList = [];
{
  const r = await call('GET', '/v1/artifact/list', null, {
    page_index: '0',
    page_size: '5',
  });
  record('GET /v1/artifact/list', r);
  if (r.ok && r.json?.list) artifactList = r.json.list;
}

// Artifact details (if any)
if (artifactList.length > 0) {
  const uuids = artifactList.slice(0, 3).map(a => a.uuid).join(',');
  const r = await call('GET', '/v1/artifact/artifact-detail', null, { uuids });
  record('GET /v1/artifact/artifact-detail', r);
} else {
  results.push({ name: 'GET /v1/artifact/artifact-detail', status: 'SKIP', msg: 'No artifacts' });
  console.log('[SKIP] GET /v1/artifact/artifact-detail: No artifacts');
}

// Poll image task
if (imageTaskId) {
  const r = await call('GET', '/v3/task', null, { taskId: imageTaskId });
  record('GET /v3/task (image)', r);
} else {
  results.push({ name: 'GET /v3/task (image)', status: 'SKIP', msg: 'No image task' });
  console.log('[SKIP] GET /v3/task (image): No image task');
}

// Poll video task
if (videoTaskId) {
  const r = await call('GET', '/v3/task', null, { taskId: videoTaskId });
  record('GET /v3/task (video)', r);
} else {
  results.push({ name: 'GET /v3/task (video)', status: 'SKIP', msg: 'No video task' });
  console.log('[SKIP] GET /v3/task (video): No video task');
}

// Poll song task
if (songTaskId) {
  const r = await call('GET', '/v3/task', null, { taskId: songTaskId });
  record('GET /v3/task (song)', r);
} else {
  results.push({ name: 'GET /v3/task (song)', status: 'SKIP', msg: 'No song task' });
  console.log('[SKIP] GET /v3/task (song): No song task');
}

// Artifact task endpoint
if (imageTaskId) {
  const r = await call('GET', `/v1/artifact/task/${imageTaskId}`);
  record('GET /v1/artifact/task/{task_uuid}', r);
} else {
  results.push({ name: 'GET /v1/artifact/task/{task_uuid}', status: 'SKIP', msg: 'No image task' });
  console.log('[SKIP] GET /v1/artifact/task/{task_uuid}: No image task');
}

// createPictureFromUrl (dummy URL — expect 400/503, just verify shape)
{
  const r = await call('POST', '/v1/artifact/picture', {
    url: 'https://example.com/dummy.jpg',
  });
  record('POST /v1/artifact/picture', r);
}

// createVideoFromUrl
{
  const r = await call('POST', '/v1/artifact/video', {
    url: 'https://example.com/dummy.mp4',
  });
  record('POST /v1/artifact/video', r);
}

// ─── LLM ─────────────────────────────────────────────────────────────────────
console.log('\n=== llm ===');

{
  const r = await callLlm({
    model: 'bailian/glm-5',
    stream: false,
    messages: [{ role: 'user', content: 'Say hi' }],
  });
  const ok = r.ok && r.text.includes('hi');
  record('POST /chat/completions (non-stream)', { ok, status: r.status, text: r.text });
}

// ─── CLEANUP ASSET:WRITE ─────────────────────────────────────────────────────
console.log('\n=== cleanup ===');

if (newCampaignUuid) {
  const r = await call('PATCH', `/v3/travel/campaign/${newCampaignUuid}`, { status: 'DRAFT' });
  console.log(`[CLEANUP] campaign draft: ${r.status}`);
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
console.log('\n=== SUMMARY ===');
const pass = results.filter(r => r.status === 'PASS').length;
const fail = results.filter(r => r.status === 'FAIL').length;
const skip = results.filter(r => r.status === 'SKIP').length;
console.log(`Total: ${results.length} | PASS: ${pass} | FAIL: ${fail} | SKIP: ${skip}`);

if (fail > 0) {
  console.log('\nFailures:');
  for (const r of results.filter(r => r.status === 'FAIL')) {
    console.log(`  - ${r.name}: ${r.msg}`);
  }
}

process.exit(fail > 0 ? 1 : 0);
