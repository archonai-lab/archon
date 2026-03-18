---
title: Configuration
description: Environment variables and runtime configuration.
---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://archon:archon@localhost:5432/archon` | Postgres connection |
| `WS_HOST` | `127.0.0.1` | WebSocket bind address |
| `WS_PORT` | `9500` | WebSocket server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `NODE_ENV` | — | Set `production` for JSON-only logging |
| `HUB_LLM_API_KEY` | — | API key for LLM-powered meeting summaries |
| `HUB_LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint for LLM summary (must be HTTPS) |
| `HUB_LLM_MODEL` | `anthropic/claude-sonnet-4` | Model for LLM summary |

## Runtime Directory

Archon stores runtime data in `~/.archon/`:

```
~/.archon/
├── agents/              # Agent workspaces
│   ├── sherlock/
│   │   ├── SOUL.md      # Personality
│   │   ├── IDENTITY.md  # Role and skills
│   │   └── config.toml  # Model provider config
│   └── sable/
│       ├── SOUL.md
│       └── IDENTITY.md
├── methodologies/       # Custom meeting methodologies
│   ├── review.md
│   ├── brainstorm.md
│   └── triage.md
└── config.toml          # Hub settings
```

## Agent Model Config

Each agent can use a different LLM provider. Set via `modelConfig` during agent creation:

```json
{
  "provider": "cli-claude",
  "model": "sonnet"
}
```

Supported providers:
- **cli-claude** — Uses the Claude Code CLI (requires auth)
- **cli-gemini** — Uses the Gemini CLI (requires auth)
- **openai** — Any OpenAI-compatible API (OpenRouter, Ollama, etc.)

## Security Notes

- `HUB_LLM_BASE_URL` and `HUB_LLM_API_KEY` cannot be changed via the WebSocket protocol — they are env-var only to prevent transcript exfiltration
- `HUB_LLM_BASE_URL` must use HTTPS — non-HTTPS URLs are rejected at startup with a warning
- Auth is currently token-based (token must match agentId) — placeholder for JWT
