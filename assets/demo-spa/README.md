# Neta Open Platform — Demo SPA

A minimal, zero-dependency single-page app demonstrating all five Neta Open Platform scopes across 8 tabs. Copy this directory to start your own project — no npm, no build step. The pure-JS code is a reference implementation; adapt it to TypeScript, React, Vue, or any framework as your project grows.

The Neta backend project name is TalesofAI, which appears in API domain names (`api.talesofai.com`, `litellm.talesofai.com`, `oss.talesofai.com`). The platform is called **Neta Open Platform**.

| Tab | Scope | Key APIs |
|-----|-------|----------|
| User | `user:read` | `GET /v1/user/`, `GET /v2/user/ap_info`, `GET /v2/users/ap-delta-info` |
| Characters | `asset:read`, `asset:write` | `GET /v2/travel/parent`, `POST /v3/oc/character`, `PATCH /v3/oc/character/{uuid}` |
| Elementums | `asset:read`, `asset:write` | `GET /v2/travel/parent`, `POST /v3/oc/elementum`, `PATCH /v3/oc/elementum/{uuid}` |
| Make Image | `generate` | `POST /v3/make_image`, `GET /v1/oss/upload-signed-url`, `POST /v1/artifact/picture` |
| Make Video | `generate` | `POST /v3/make_video` |
| Make Song | `generate` | `POST /v3/make_song` |
| Campaign | `asset:read`, `asset:write` | `GET /v3/travel/campaigns`, `POST /v3/travel/campaign/`, `PATCH /v3/travel/campaign/{uuid}` |
| LLM Chat | `llm` | `POST /chat/completions` (LLM gateway) |

---

## Architecture

```
index.html  →  app.js  →  auth.js + api.js + config.js
       ↑
   Tailwind Play CDN
```

| File | Purpose |
|------|---------|
| `index.html` | HTML shell with strict CSP `<meta>`, Tailwind Play CDN, 8 tabs, 3 modals |
| `config.js` | Endpoints, CLIENT ID, redirect URI, scopes — only `clientId` needs to change |
| `auth.js` | Generic OAuth2 PKCE client — sign-in, callback, token refresh, logout. Reusable as-is in any SPA |
| `api.js` | Bearer-token helper + namespaced API modules (`UserAPI`, `AssetAPI`, `GenerateAPI`, `LLMAPI`) + payload builders + SSE streaming. Source of truth for all endpoint specs |
| `app.js` | Tab routing, auth boot flow, CRUD modals, polling, `escapeHtml`/`safeUrl` |

---

## Quick start

### 1. Get a CLIENT ID

Register a developer app to get a CLIENT ID. See `../../references/developer-app-crud.md` for the CLI toolkit, or use the [Neta Developer Portal](https://www.neta.art/open/).

### 2. Configure

Edit `config.js` — replace `YOUR_CLIENT_ID` with your CLIENT ID.

### 3. Set the redirect URI

- **Local development**: Set your app's redirect URI to `http://localhost:9999/` (or any localhost port you prefer). `http://localhost:*` works for any port and path.
- **Deployed**: Once your app is complete, ask the cohub AI agent to publish it — cohub copies your frontend artifacts to a public URL. Then update your redirect URI to that link via the [developer portal](https://www.neta.art/open/) or `PATCH /v1/developer/apps/{uuid}`.

### 4. Serve

```bash
python3 -m http.server 9999
# Open http://localhost:9999
```

**Do not commit real credentials.**

---

## Tab features

| Tab | Highlights |
|-----|-----------|
| **User** | AP progress bar, delta history table, raw API response |
| **Characters** | Search, create form with avatar artifact picker, detail/edit modal with profile view |
| **Elementums** | Search, create form with preview artifact picker, detail/edit modal with profile view |
| **Make Image** | Generate from prompt, upload via signed URL, artifact grid with detail modal + task results, task pool indicator |
| **Make Video** | Model selector, generate → poll → display, artifact grid |
| **Make Song** | Prompt + lyrics, generate → poll → play, artifact grid with embedded audio player |
| **Campaign** | Create with cover image, detail/edit modal with full-detail fetch |
| **LLM Chat** | Model selector, optional system prompt, multi-turn streaming |

Every tab has an info button listing the exact API endpoints it calls.

---

## Upload picture

1. Select an image file
2. `GET /v1/oss/upload-signed-url?suffix=<ext>` returns a pre-signed `upload_url` and `view_url`
3. `PUT` the file directly to the pre-signed URL
4. `POST /v1/artifact/picture` creates the artifact from `view_url`
5. The picture grid refreshes

---

## Content Security Policy

The demo uses a `<meta>` CSP because it's served as static files. Update `index.html` when adding external resources:

| Change | Directive |
|--------|-----------|
| New API host | `connect-src` |
| New image CDN | `img-src` |
| New script CDN | `script-src` |
| New font CDN | `font-src` |
| Audio/video CDN | `media-src` |
| WebSocket | `connect-src` (add `wss://host`) |

CSP violations are logged clearly in DevTools Console.

---

## Security

### Token storage

Tokens live in `sessionStorage`. There is no backend-for-frontend (BFF). This is vulnerable to XSS. Mitigations in the demo:

- Strict CSP — no `unsafe-eval`, no inline scripts
- DOM built with `document.createElement` + `textContent`, not `innerHTML`
- `escapeHtml()` and `safeUrl()` on all user-controlled data

SPA owners are responsible for securing their deployment.

### XSS prevention

Never interpolate user-controlled data into HTML strings:

```javascript
// Good
const el = document.createElement('div');
el.textContent = user.name;

// Bad
container.innerHTML = `<div>${user.name}</div>`;
```

### Logout

Client-side only — clears `sessionStorage` and reloads. Does not call the OAuth service's end-session endpoint. This avoids redirecting to a branded logout page and prevents identity provider leakage.

---

## Advanced patterns

These go beyond the demo's vanilla JS approach. Useful when building with TypeScript, React, or a build toolchain.

### Token refresh with request queuing

The demo refreshes tokens proactively (60s before expiry). For concurrent requests, add a queue so only one refresh fires:

```typescript
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

async function getValidAccessToken(): Promise<string> {
  const expiresAt = Number(sessionStorage.getItem('expires_at') ?? '0');
  if (Date.now() < expiresAt - 60000) {
    return sessionStorage.getItem('access_token')!;
  }
  if (isRefreshing) {
    return new Promise((resolve) => refreshQueue.push(resolve));
  }
  isRefreshing = true;
  try {
    const token = await refreshAccessToken();
    refreshQueue.forEach((cb) => cb(token));
    refreshQueue = [];
    return token;
  } finally {
    isRefreshing = false;
  }
}
```

### Axios interceptor

```typescript
function createApiClient(baseURL: string, getToken: () => Promise<string>) {
  const client = axios.create({ baseURL, timeout: 30000 });
  client.interceptors.request.use(async (config) => {
    config.headers.set('Authorization', `Bearer ${await getToken()}`);
    return config;
  });
  client.interceptors.response.use(
    (res) => res,
    async (err) => {
      if (err.response?.status === 401) {
        // Trigger re-auth or token refresh
      }
      return Promise.reject(err);
    }
  );
  return client;
}
```

---

## Production hardening

- [ ] Change `redirectUri` from `http://localhost:9999/` to your cohub public link
- [ ] Register the new redirect URI via `PATCH /v1/developer/apps/{uuid}`
- [ ] Move CSP from `<meta>` to HTTP response headers on your reverse proxy
- [ ] Add `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin` headers
- [ ] Remove `debugTokenScopes()` debug helper before shipping
