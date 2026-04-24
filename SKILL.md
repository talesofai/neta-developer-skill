---
name: neta-developer
description: Neta Open Platform developer assistant. Help users build single-page applications on the Neta Open Platform. Use when the user is: (1) registering or managing a developer app, (2) implementing OAuth2 PKCE authentication against the Neta OAuth service, (3) calling open platform APIs (user:read, asset:read, asset:write, generate, llm), (4) building or extending a demo SPA, (5) understanding Neta's API scopes and endpoint mapping, (6) translating Neta capabilities into their own frontend application.
---

# Neta Developer Skill

Help developers build third-party SPAs on the Neta Open Platform.

Neta is operated by **Viscept Limited**.

| Service | URL |
|---------|-----|
| Official site | `https://www.neta.art` |
| Main app | `https://app.neta.art` |
| OAuth service | `https://auth.neta.art` |
| Backend API | `https://api.talesofai.com` |
| LLM gateway | `https://litellm.talesofai.com` |
| Cohub (AI agent platform) | `https://cohub.run` |

## Developer access

To become a Neta developer, contact staff via Discord: `https://discord.com/channels/1196028153085296651/1497137199001501768`

Once granted developer privilege, you receive a **DEV_TOKEN** (scopes: `user:read`, `develop`). This token is used only for managing your developer apps — create, list, update, delete — via the CLI toolkit or direct API calls.

Your SPA issues its own tokens to end users with the scopes you registered for your app: `user:read`, `asset:read`, `asset:write`, `generate`, `llm`. SPA access tokens expire after **1 hour**; a refresh token is included. Your client code is responsible for refreshing proactively to maintain a smooth user experience.

All users who sign in via Neta OAuth are automatically registered as Neta app users (or logged in if they already have an account).

## Core workflow

1. **Register a developer app** — via the CLI toolkit (`bin/neta-dev-app`) or the [Neta Developer Portal](https://www.neta.art/open/)
2. **Implement OAuth2 + PKCE** — against the Neta OAuth service at `https://auth.neta.art`
3. **Request scopes** — match to the smallest set your app needs
4. **Call platform APIs** — with `Authorization: Bearer <access_token>`
5. **Poll tasks** — for async generation results

If your SPA doesn't call Neta backend APIs, registration is optional.

## Scope selection

| If your app needs to... | Request scope |
|---|---|
| Show user profile, avatar, AP balance | `user:read` |
| List or search characters, elementums, campaigns | `asset:read` |
| Create or update characters, elementums, campaigns | `asset:write` |
| Generate images, videos, songs, or upload media | `generate` |
| Stream LLM chat completions | `llm` |

Start with the smallest set. Update later via `PATCH /v1/developer/apps/{uuid}`.

The `develop` scope is reserved for the official portal. Third-party SPAs cannot request it.

## Auth flow (OAuth2 + PKCE)

1. Generate `code_verifier` (512-bit entropy) and `code_challenge` (SHA-256)
2. Redirect to `https://auth.neta.art/oidc/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid offline_access <scopes>`, `code_challenge`, `code_challenge_method=S256`, `state`, `nonce`, `resource=https://api.talesofai`
3. Handle callback: validate `state`, exchange `code` + `code_verifier` for tokens at `https://auth.neta.art/oidc/token`
4. Validate `nonce` in `id_token` payload
5. Store tokens in `sessionStorage`
6. Refresh access token when within 60 seconds of expiry

Reference implementation: `assets/demo-spa/auth.js`.

## Demo SPA quickstart

```bash
cp -r assets/demo-spa my-neta-app
cd my-neta-app
# Edit config.js: replace YOUR_CLIENT_ID with your CLIENT ID from the portal
python3 -m http.server 9999
```

Zero-dependency vanilla JS covering all five scopes across 8 tabs. See `assets/demo-spa/README.md` for architecture, security model, and production hardening.

The demo is a reference starting point. For more ambitious projects, adapt it to any language or framework — TypeScript, React, Vue, or your preferred stack. All auth and API logic is framework-agnostic.

## Security

- **No BFF**: Tokens live in `sessionStorage` only. SPA owners are responsible for securing their deployment. See demo README for XSS prevention patterns.
- **CSP**: Update the `<meta>` tag in `index.html` when adding new hosts. See demo README for the CSP reference table.
- **Redirect URI**: Exactly 1 URI. `http://localhost:*`, `https://*.talesofai.com`, or `https://*.cohub.run`. See `references/developer-app-crud.md` for the full rules table.
- **Logout**: Client-side only (`sessionStorage.clear()` + reload). Tokens are not revoked at the OAuth service.

## Adding API calls

Follow the namespaced pattern in `api.js`. Each scope maps to a namespace:

- `UserAPI.*` — profile, AP balance, delta history
- `AssetAPI.*` — characters, elementums, campaigns
- `GenerateAPI.*` — image/video/song generation, artifacts, upload, task polling
- `LLMAPI.*` — streaming chat completions

To add a new endpoint:
1. Add a function to the appropriate namespace using the `callApi(method, path, body, query)` helper
2. Add UI in `index.html` and wire logic in `app.js`
3. Update CSP `connect-src` / `img-src` / `media-src` if using new hosts

`api.js` is the source of truth for endpoint specs.

## Glossary

Terms users may use, especially Chinese speakers:

| English | Chinese | Meaning |
|---------|---------|---------|
| Neta | 捏Ta | The platform (`neta.art`) |
| Character / OC | 角色 / 原创角色 | A virtual character |
| Elementum | 元素 / 画风元素 | Visual-style token controlling render style |
| TCP (Travel Character Parent) | 角色/元素实体基类 | Base API entity: character or elementum |
| VToken | — | Virtual token referencing a character/elementum in generation prompts |
| Artifact | 作品 | AI-generated output: image, video, or audio |
| AP (Action Points) | 电量 | Energy points consumed per generation |
| Campaign | 旅行 / 冒险活动 | Interactive adventure with AI DM roleplay |
| Scope | 权限范围 | OAuth scope controlling API access |

## Resources

- **Demo SPA reference**: `assets/demo-spa/README.md` — architecture, security model, CSP guide, production checklist
- **CLI toolkit**: `references/developer-app-crud.md` — manage developer apps from the terminal
- **API specs**: `assets/demo-spa/api.js` — full endpoint listing (code is source of truth)
- **Auth implementation**: `assets/demo-spa/auth.js` — OAuth2 PKCE reference client
