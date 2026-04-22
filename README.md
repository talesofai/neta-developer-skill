# neta-developer-skill

AI coding agent skill and project template for building SPAs on the Neta Open Platform. Works with Claude Code, Codex, OpenCode, OpenClaw, and other AI coding agents.

[Neta](https://www.neta.art) is an AI-native creative community where users create virtual characters, generate images, videos, and songs, and publish interactive stories. Neta is operated by **Viscept Limited**. The Open Platform exposes these capabilities via OAuth2 PKCE and REST APIs so third-party developers can build their own applications on top.

> **Not to be confused with [`neta-skills`](https://github.com/talesofai/neta-skills)** — that project equips AI agents to consume Neta APIs. This project helps *human developers* build their own SPAs.

---

## What this is

This repo is both an **AI coding agent skill** and a **project template**:

- **As a skill**: When installed, AI coding agents can guide you through OAuth2 PKCE, scope selection, API integration, and SPA architecture
- **As a template**: Copy `assets/demo-spa/` to start your own project — zero dependencies, all five platform scopes demonstrated

---

## Quick start

```bash
# Copy the demo SPA
cp -r assets/demo-spa my-neta-app
cd my-neta-app

# Register a developer app to get a CLIENT ID
# See references/developer-app-crud.md for CLI tools, or use https://www.neta.art/open/

# Edit config.js: replace YOUR_CLIENT_ID with your CLIENT ID

# Serve and open
python3 -m http.server 9999
# Open http://localhost:9999
```

See `assets/demo-spa/README.md` for detailed setup, architecture, and production hardening.

---

## Directory structure

```
neta-developer-skill/
├── SKILL.md                          # AI agent skill definition
├── README.md                         # This file
├── references/
│   └── developer-app-crud.md         # CLI toolkit for managing developer apps
├── assets/
│   └── demo-spa/                     # Zero-dependency reference SPA
└── bin/                              # Bash CLI for developer app CRUD
```

## Platform scopes

| Scope | Capabilities |
|-------|-------------|
| `user:read` | Profile, avatar, AP balance |
| `asset:read` | Characters, elementums, campaigns |
| `asset:write` | Create/update characters, elementums, campaigns |
| `generate` | AI image/video/song generation + artifact lifecycle |
| `llm` | LLM chat completions via LLM gateway |

`assets/demo-spa/api.js` is the source of truth for all endpoints.

## Links

- [Neta Art](https://www.neta.art)
- [Neta Open Portal](https://www.neta.art/open/)
- [Neta Skills (agent SDK)](https://github.com/talesofai/neta-skills)
- [Twitter / X @NetaArt_AI](https://x.com/NetaArt_AI)

---

For consuming Neta content as an AI agent, see [`neta-skills`](https://github.com/talesofai/neta-skills).
