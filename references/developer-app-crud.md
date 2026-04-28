# Developer App — CLI Toolkit

Manage developer applications on the Neta Open Platform via the `neta-dev-app` bash CLI.

> **Developer access**: To become a Neta developer, contact staff via Discord: `https://discord.com/channels/1196028153085296651/1497137199001501768`

---

## Setup

```bash
export BASE_URL="https://api.talesofai.com"   # optional; default
export DEV_TOKEN="<your_token>"
```

**DEV_TOKEN** is your developer access token (scopes: `user:read`, `develop`, `asset:read`, `asset:write`, `generate`, `llm`). See `SKILL.md` for how to obtain one. The easiest path: sign in to the [Neta Developer Portal](https://www.neta.art/open/) and copy it from your dashboard.

---

## Commands

All scripts live in `bin/`. Invoke directly or add to `$PATH`.

### `neta-dev-app create`

```bash
neta-dev-app create \
  --name "My Demo App" \
  --scopes user:read,asset:read,generate \
  --redirect-uri "http://localhost:9999/"
```

Optional: `--description`, `--display-name`, `--logo-url`, `--dark-logo-url`, `--terms-url`, `--privacy-url`

On success, highlights:
- `uuid` — internal UUID for updates/deletes
- `logto_app_id` — your OAuth `client_id` (this is your CLIENT ID for `config.js`)

### `neta-dev-app list`

```bash
neta-dev-app list
neta-dev-app list --page-index 0 --page-size 20
```

### `neta-dev-app get`

```bash
neta-dev-app get <uuid>
```

### `neta-dev-app update`

All fields optional (PATCH semantics).

```bash
neta-dev-app update <uuid> \
  --scopes user:read,asset:read,asset:write,generate,llm \
  --description "Updated"
```

### `neta-dev-app delete`

```bash
neta-dev-app delete <uuid>
neta-dev-app delete <uuid> --force   # skip confirmation
```

---

## Redirect URI rules

| Rule | Detail |
|------|--------|
| Count | Exactly 1 URI |
| `http://localhost:*` | Any port, any path |
| `https://*.talesofai.com` | Any subdomain |
| `https://*.cohub.run` | Any subdomain |
| Other schemes / domains | Blocked |

Valid: `http://localhost:9999/`, `http://localhost:3000/callback`, `https://myapp.talesofai.com/callback`, `https://myapp.cohub.run/`

Invalid: `http://example.com/callback`, `https://192.168.1.1/callback`, `myapp://callback`

---

## Common errors

| HTTP | Cause |
|------|-------|
| 403 | No `DEVELOPER` privilege, or (third-party tokens) missing `develop` scope. Use a portal-issued or first-party token. |
| 400 | `redirect_uris` != 1, domain whitelist violation, duplicate/invalid scope, `develop` in scopes, or field length exceeded |
| 404 | UUID does not exist or does not belong to you |
| 409 | `logto_app_id` already exists (orphaned from failed cleanup) |

---

## Next steps

Once your app is registered, copy the `logto_app_id` into the demo SPA's `config.js` as `clientId` (this is your CLIENT ID). See `assets/demo-spa/README.md` for full setup instructions.
