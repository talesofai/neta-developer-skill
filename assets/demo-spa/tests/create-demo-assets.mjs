// Create meaningful public demo assets for the Neta Open Platform
import { CONFIG } from './config.js';

const TOKEN = process.env.NETA_TOKEN;
if (!TOKEN) {
  console.error('Set NETA_TOKEN env var');
  process.exit(1);
}

const API = CONFIG.apiBase;

async function call(method, path, body = null, query = null) {
  let url = API + path;
  if (query) {
    const qs = new URLSearchParams(query).toString();
    if (qs) url += '?' + qs;
  }
  const headers = {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
  const fetchOpts = { method, headers };
  if (body !== null) fetchOpts.body = JSON.stringify(body);
  const res = await fetch(url, fetchOpts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return json ?? text;
}

// Use an existing image artifact for avatars
const ARTIFACT_UUID = '573191f9-cb60-4fdc-be82-3f48e1855ed4';
const USER_UUID = '026ad55220894a9fa80c7e13a2ec495c';

async function main() {
  console.log('Creating demo assets…\n');

  // 1. Character — Neta Navigator
  try {
    const char = await call('POST', '/v3/oc/character', {
      name: 'Neta Navigator',
      description: 'Your guide through the TalesofAI Open Platform. She knows every endpoint, every scope, and every VToken.',
      avatar_artifact_uuid: ARTIFACT_UUID,
      prompt: 'a friendly anime girl with silver hair and violet eyes, wearing a futuristic headset, soft lighting',
      trigger: '1girl, silver hair, violet eyes, futuristic headset, cyberpunk, friendly smile',
      gender: 'female',
      accessibility: 'PUBLIC',
    });
    console.log('✅ Character created:', char.uuid);
  } catch (e) {
    console.error('❌ Character failed:', e.message);
  }

  // 2. Elementum — Cyberpunk Neon
  try {
    const elem = await call('POST', '/v3/oc/elementum', {
      name: 'Cyberpunk Neon',
      description: 'A vibrant cyberpunk aesthetic with neon pink and cyan highlights, rain-slicked streets, and holographic signage.',
      artifact_uuid: ARTIFACT_UUID,
      prompt: 'cyberpunk cityscape, neon lights, pink and cyan, rain, holograms, futuristic, cinematic',
      accessibility: 'PUBLIC',
    });
    console.log('✅ Elementum created:', elem.uuid);
  } catch (e) {
    console.error('❌ Elementum failed:', e.message);
  }

  // 3. Travel Campaign — Open Platform Adventure
  let campaignUuid = null;
  try {
    const camp = await call('POST', '/v3/travel/campaign/', {
      name: 'Open Platform Adventure',
      subtitle: 'Explore the TalesofAI developer ecosystem through an interactive journey.',
      mission_plot: 'You are a developer who has just discovered the TalesofAI Open Platform. Your mission is to explore the five sacred scopes — user:read, asset:read, asset:write, generate, and llm — and build a single-page app that brings characters to life. Along the way, you will encounter the Neta Navigator, who will guide you through OAuth2 PKCE, VTokens, and artifact lifecycle management.',
      mission_task: 'Build a demo SPA that calls at least one endpoint from each scope and publish it.',
      status: 'PUBLISHED',
    });
    campaignUuid = camp.uuid;
    console.log('✅ Campaign created:', campaignUuid);
  } catch (e) {
    console.error('❌ Campaign failed:', e.message);
  }

  // 4. Collection / Story Post — Welcome to the Open Platform
  try {
    const newStory = await call('GET', '/v1/story/new-story');
    const storyUuid = newStory.data.uuid;

    await call('PUT', '/v3/story/story', {
      uuid: storyUuid,
      name: 'Welcome to the TalesofAI Open Platform',
      description: 'A quick-start showcase for developers building on Neta.',
      status: 'PUBLISHED',
      displayData: {
        pages: [{
          images: [{
            url: 'https://oss.talesofai.com/picture/573191f9-cb60-4fdc-be82-3f48e1855ed4.webp',
            text: 'The TalesofAI Open Platform exposes 5 scopes for third-party SPA developers: user:read, asset:read, asset:write, generate, and llm. Start building today!',
          }],
        }],
      },
    });

    await call('PUT', '/v1/story/story-publish', null, {
      storyId: storyUuid,
      triggerTCPCommentNow: 'false',
      triggerSameStyleReply: 'false',
      sync_mode: 'false',
    });

    console.log('✅ Collection published:', storyUuid);
  } catch (e) {
    console.error('❌ Collection failed:', e.message);
  }

  console.log('\nDone!');
}

main();
