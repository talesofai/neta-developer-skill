import { CONFIG } from './config.js';
import { auth } from './auth.js';

// ─── CORE HELPER ──────────────────────────────────────────────────────────────
// Injects a fresh Bearer token on every call.
async function callApi(method, path, body = null, query = null) {
  const token = await auth.getAccessToken();
  let url = CONFIG.apiBase + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += '?' + qs;
  }
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

// ─── USER API (scope: user:read) ──────────────────────────────────────────────
export const UserAPI = {
  /** GET /v1/user/ — Current user profile */
  getProfile() {
    return callApi('GET', '/v1/user/');
  },

  /** GET /v2/user/ap_info — User AP balance info */
  getApInfo() {
    return callApi('GET', '/v2/user/ap_info');
  },

  /** GET /v2/users/ap-delta-info — User AP delta history (cursor-based) */
  getApDeltaInfo(cursorId = null, pageSize = 10) {
    const q = { page_size: String(pageSize) };
    if (cursorId !== null) q.cursor_id = String(cursorId);
    return callApi('GET', '/v2/users/ap-delta-info', null, q);
  },
};

// ─── ASSET API (scopes: asset:read, asset:write) ──────────────────────────────
export const AssetAPI = {
  // ── Characters / Elementums (TCP) ──

  /** GET /v2/travel/parent-search — Search characters/elementums by keyword */
  searchTCPs(keywords, pageIndex = 0, pageSize = 20, parentType = 'oc') {
    const q = {
      keywords,
      page_index: String(pageIndex),
      page_size: String(pageSize),
      parent_type: Array.isArray(parentType) ? parentType.join(',') : parentType,
    };
    return callApi('GET', '/v2/travel/parent-search', null, q);
  },

  /** GET /v2/travel/parent/{uuid}/profile — Fetch character/elementum profile */
  getTCPProfile(uuid) {
    return callApi('GET', `/v2/travel/parent/${uuid}/profile`);
  },

  /** GET /v2/travel/parent — List user's characters/elementums */
  listMyTCPs(userUuid, parentType = 'oc', pageIndex = 0, pageSize = 20) {
    const q = {
      user_uuid: userUuid,
      parent_type: parentType,
      page_index: String(pageIndex),
      page_size: String(pageSize),
    };
    return callApi('GET', '/v2/travel/parent', null, q);
  },

  /** POST /v3/oc/character — Create a new character */
  createCharacter(payload) {
    return callApi('POST', '/v3/oc/character', payload);
  },

  /** PATCH /v3/oc/character/{tcp_uuid} — Update an existing character */
  updateCharacter(tcpUuid, payload) {
    return callApi('PATCH', `/v3/oc/character/${tcpUuid}`, payload);
  },

  /** POST /v3/oc/elementum — Create a new elementum */
  createElementum(payload) {
    return callApi('POST', '/v3/oc/elementum', payload);
  },

  /** PATCH /v3/oc/elementum/{tcp_uuid} — Update an existing elementum */
  updateElementum(tcpUuid, payload) {
    return callApi('PATCH', `/v3/oc/elementum/${tcpUuid}`, payload);
  },

  // ── Travel Campaigns ──

  /** GET /v3/travel/campaigns — List user's travel campaigns */
  listCampaigns(userUuid, pageIndex = 0, pageSize = 20) {
    const q = {
      user_uuid: userUuid,
      page_index: String(pageIndex),
      page_size: String(pageSize),
    };
    return callApi('GET', '/v3/travel/campaigns', null, q);
  },

  /** GET /v3/travel/campaign/{uuid} — Fetch specific travel campaign details */
  getCampaign(uuid) {
    return callApi('GET', `/v3/travel/campaign/${uuid}`);
  },

  /** POST /v3/travel/campaign/ — Create a new travel campaign */
  createCampaign(payload) {
    return callApi('POST', '/v3/travel/campaign/', payload);
  },

  /** PATCH /v3/travel/campaign/{uuid} — Update an existing travel campaign */
  updateCampaign(uuid, payload) {
    return callApi('PATCH', `/v3/travel/campaign/${uuid}`, payload);
  },
};

// ─── GENERATE API (scope: generate) ───────────────────────────────────────────
export const GenerateAPI = {
  /** POST /v3/make_image — Generate image from prompt */
  makeImage(payload) {
    return callApi('POST', '/v3/make_image', payload);
  },

  /** POST /v3/make_video — Generate video from image and workflow */
  makeVideo(payload) {
    return callApi('POST', '/v3/make_video', payload);
  },

  /** POST /v3/make_song — Generate song with prompt and lyrics */
  makeSong(payload) {
    return callApi('POST', '/v3/make_song', payload);
  },

  /** POST /v1/artifact/picture — Create picture artifact from URL */
  createPictureFromUrl(url, extraData = null) {
    const body = { url };
    if (extraData) body.extra_data = extraData;
    return callApi('POST', '/v1/artifact/picture', body);
  },

  /** POST /v1/artifact/video — Create video artifact from URL */
  createVideoFromUrl(url, extraData = null) {
    const body = { url };
    if (extraData) body.extra_data = extraData;
    return callApi('POST', '/v1/artifact/video', body);
  },

  /** GET /v1/oss/sts-upload-token — Get STS credentials for authenticated upload */
  getStsUploadToken(suffix = 'images') {
    return callApi('GET', '/v1/oss/sts-upload-token', null, { suffix });
  },

  /** GET /v1/oss/anonymous-upload-token — Get STS credentials for anonymous video upload */
  getAnonymousUploadToken(suffix = 'videos') {
    return callApi('GET', '/v1/oss/anonymous-upload-token', null, { suffix });
  },

  /** GET /v1/oss/upload-signed-url — Get a pre-signed URL for direct file upload */
  getUploadSignedUrl(suffix = 'webp') {
    return callApi('GET', '/v1/oss/upload-signed-url', null, { suffix });
  },

  /** GET /v1/artifact/task/{task_uuid} — Fetch artifact task result */
  getArtifactTask(taskUuid) {
    return callApi('GET', `/v1/artifact/task/${taskUuid}`);
  },

  /** GET /v3/task — Fetch raw task result by task ID */
  getRawTask(taskId) {
    return callApi('GET', '/v3/task', null, { taskId });
  },

  /** GET /v3/task-pool — Fetch task pool size */
  getTaskPool(entrance = 'PICTURE,PURE') {
    return callApi('GET', '/v3/task-pool', null, { entrance });
  },

  /** GET /v1/artifact/artifact-detail — Fetch artifact details by UUIDs */
  getArtifactDetails(uuids) {
    const q = { uuids: Array.isArray(uuids) ? uuids.join(',') : uuids };
    return callApi('GET', '/v1/artifact/artifact-detail', null, q);
  },

  /** GET /v1/artifact/list — List user's artifacts (paginated, filterable) */
  listArtifacts(params = {}) {
    const q = {
      page_index: String(params.page_index ?? 0),
      page_size: String(params.page_size ?? 20),
    };
    if (params.status) q.status = params.status;
    if (params.is_starred != null) q.is_starred = String(params.is_starred);
    if (params.modality) q.modality = params.modality;
    if (params.date_range) q.date_range = params.date_range;
    return callApi('GET', '/v1/artifact/list', null, q);
  },
};

// ─── LLM API (scope: llm) ─────────────────────────────────────────────────────
export const LLMAPI = {
  /**
   * Stream chat completions from the LiteLLM gateway.
   * Calls onChunk(textDelta) for every content fragment received.
   * Calls onDone(fullText) when the stream finishes.
   * Calls onError(err) on any error.
   */
  async streamChatCompletion(messages, onChunk, onDone, onError, options = {}) {
    try {
      const token = await auth.getAccessToken();
      const res = await fetch(CONFIG.llmGatewayEndpoint + '/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          model: options.model || 'bailian/glm-5',
          stream: true,
          stream_options: { include_usage: true },
          messages,
          ...options.extraBody,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status} ${text}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              onChunk(delta);
            }
          } catch {
            // ignore malformed JSON
          }
        }
      }

      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                onChunk(delta);
              }
            } catch {
              // ignore
            }
          }
        }
      }

      onDone(fullText);
    } catch (err) {
      onError(err);
    }
  },
};

// ─── PAYLOAD BUILDERS ─────────────────────────────────────────────────────────
export const PayloadBuilders = {
  /**
   * Build a make_image payload (PayLoadV3 schema).
   * @param {string} freetext - The main prompt text
   * @param {object} options
   * @param {number} [options.width=512]
   * @param {number} [options.height=512]
   * @param {string} [options.jobType='universal'] - 'universal' | 'character' | 'scene' | 'cp' | 'oc_preview' | 'elementum_preview'
   * @param {Array} [options.vtokens=[]] - Extra VTokens (characters, elementums, images)
   * @param {string} [options.entrance='PICTURE,PURE']
   * @param {string} [options.contextModelSeries]
   * @param {string} [options.negativeFreetext]
   * @param {boolean} [options.advancedTranslator]
   * @param {object} [options.inherit]
   * @param {object} [options.meta]
   */
  buildMakeImage(freetext, options = {}) {
    const {
      width = 512,
      height = 512,
      jobType = 'universal',
      vtokens = [],
      entrance = 'PICTURE,PURE',
      contextModelSeries,
      negativeFreetext,
      advancedTranslator,
      inherit,
      meta,
    } = options;

    const rawPrompt = [
      { type: 'freetext', value: freetext, weight: 1.0 },
      ...vtokens,
    ];

    const payload = {
      jobType,
      width,
      height,
      rawPrompt,
      meta: meta || { entrance },
    };

    if (contextModelSeries) payload.context_model_series = contextModelSeries;
    if (negativeFreetext) payload.negative_freetext = negativeFreetext;
    if (advancedTranslator != null) payload.advanced_translator = advancedTranslator;
    if (inherit) payload.inherit_params = inherit;

    return payload;
  },

  /**
   * Build a make_video payload (PayLoadV3 schema).
   * @param {string} freetext - The video prompt text
   * @param {object} options
   * @param {string} [options.contextModelSeries]
   * @param {Array} [options.vtokens=[]]
   * @param {string} [options.entrance='VIDEO,PURE']
   * @param {object} [options.inherit]
   * @param {object} [options.meta]
   */
  buildMakeVideo(freetext, options = {}) {
    const {
      contextModelSeries,
      vtokens = [],
      entrance = 'VIDEO,PURE',
      inherit,
      meta,
    } = options;

    const rawPrompt = freetext
      ? [{ type: 'freetext', value: freetext, weight: 1.0 }, ...vtokens]
      : vtokens;

    const payload = {
      jobType: 'universal',
      width: -1,
      height: -1,
      rawPrompt,
      meta: meta || { entrance },
    };

    if (contextModelSeries) payload.context_model_series = contextModelSeries;
    if (inherit) payload.inherit_params = inherit;

    return payload;
  },

  /**
   * Build a make_song payload.
   * @param {string} prompt
   * @param {string} lyrics
   * @param {object} [meta]
   */
  buildMakeSong(prompt, lyrics, meta = { entrance: 'SONG,CLI' }) {
    return { prompt, lyrics, meta };
  },

  /**
   * Build a VToken for a character.
   * @param {string} uuid
   * @param {string} name
   */
  buildCharacterVToken(uuid, name) {
    return { type: 'character', value: uuid, name, weight: 1.0 };
  },

  /**
   * Build a VToken for an elementum (style).
   * @param {string} uuid
   * @param {string} name
   */
  buildElementumVToken(uuid, name) {
    return { type: 'elementum', value: uuid, name, weight: 1.0 };
  },

  /**
   * Build a VToken for an image reference.
   * @param {string} uuid
   * @param {string} url
   */
  buildImageVToken(uuid, url) {
    return { type: 'image', value: uuid, url, weight: 1.0 };
  },
};

// ─── LEGACY EXPORTS (for backward compat with existing app.js) ────────────────
export async function getProfile() { return UserAPI.getProfile(); }
export async function listCharacters(pageIndex = 0, pageSize = 20) {
  // Need user UUID — handled in app.js via profile cache
  const profile = await getProfile();
  return AssetAPI.listMyTCPs(profile.uuid, 'oc', pageIndex, pageSize);
}
export async function makeImage(prompt, width = 512, height = 512) {
  const payload = PayloadBuilders.buildMakeImage(prompt, { width, height });
  return GenerateAPI.makeImage(payload);
}
export async function pollTask(taskId) {
  return GenerateAPI.getRawTask(taskId);
}
export async function streamChatCompletion(prompt, onChunk, onDone, onError) {
  return LLMAPI.streamChatCompletion([{ role: 'user', content: prompt }], onChunk, onDone, onError);
}
