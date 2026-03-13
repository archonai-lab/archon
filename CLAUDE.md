# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

Archon is a platform that organizes AI agents like a company. Agents have identities, roles, memories, and hold meetings where they collaborate like humans. The hub is a purpose-built WebSocket coordination server (NOT an MCP server — MCP's stdio/SSE transport doesn't support real-time broadcast).

## Commands

```bash
# Development
npm run dev              # Start with tsx watch (auto-reload)
npm run build            # TypeScript compile to dist/
npm start                # Run compiled dist/index.js

# Database (requires Postgres running)
docker compose up -d     # Start Postgres 16
npm run db:generate      # Generate SQL migrations from schema.ts
npm run db:migrate       # Apply migrations to Postgres
npm run db:seed          # Seed CEO agent + sample departments

# Testing
npm test                 # Run vitest (watch mode)
npx vitest run           # Single run
npx vitest run tests/hub # Run specific directory
npx vitest run tests/hub/server.test.ts  # Run single test file

# Review (works on any project — run from target project dir)
npm run review             # Single-agent review of uncommitted changes
npm run review:staged      # Review staged changes only
npm run review:branch      # Review full branch vs main
npm run review:meeting     # Multi-agent Archon review meeting
# Or from another project:
bash ~/archon/scripts/review.sh --project ~/my-project
bash ~/archon/scripts/review-meeting.sh --project ~/my-project
```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://archon:archon@localhost:5432/archon` | Postgres connection |
| `WS_HOST` | `127.0.0.1` | WebSocket bind address |
| `WS_PORT` | `9500` | WebSocket server port |
| `LOG_LEVEL` | `info` | Pino log level |
| `NODE_ENV` | — | Set `production` for JSON-only logging |
| `HUB_LLM_API_KEY` | — | API key for LLM-powered meeting summaries (also configurable via client Settings) |
| `HUB_LLM_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint for LLM summary |
| `HUB_LLM_MODEL` | `anthropic/claude-sonnet-4` | Model for LLM summary |

## Architecture

**Two directory trees**: The repo (`archon/`) is platform source code. Runtime data lives in `~/.archon/` (agent workspaces, config, templates). No hardcoded paths — everything reads from `~/.archon/config.toml`.

**Boot sequence** (`src/index.ts`): Test DB connection → start WebSocket hub on `WS_PORT` → register SIGINT/SIGTERM for graceful shutdown.

**Message flow**: Agent connects via WebSocket → must send `auth` message first → Router validates against Postgres `agents` table → session created → subsequent messages parsed via Zod discriminated union (`InboundMessage`) and dispatched by type.

### Key layers

- **`src/hub/`** — WebSocket server, message routing, session tracking. `Router` handles auth as a gate (unauthenticated sockets only accept `auth` messages), then dispatches by message type. `SessionManager` maps agentId → socket, provides send/broadcast.
- **`src/protocol/`** — Zod schemas for all WebSocket message types (`messages.ts`), error codes and factory (`errors.ts`). New message types must be added to the `InboundMessage` discriminated union.
- **`src/db/`** — Drizzle ORM schema (9 tables), Postgres connection via `postgres` (porsager). Schema defined in `schema.ts`, migrations generated to `drizzle/`.
- **`src/meeting/`** (planned) — Meeting room with phase state machine: PRESENT → DISCUSS → DECIDE → ASSIGN. Relevance-based turns (MUST_SPEAK / COULD_ADD / PASS), not round-robin. Token budget per meeting.
- **`src/registry/`** (planned) — Agent CRUD, Agent Card generation (A2A-inspired), permission-filtered discovery.

## Tech stack

TypeScript (ESM, `"module": "NodeNext"`), ws (WebSocket), drizzle-orm + postgres (porsager), zod, pino, nanoid, vitest, tsx.

## Conventions

- **A2A comments**: Document A2A protocol origins in comments wherever Agent Card patterns are used (inspired by Google A2A, discovery only — not A2A transport)
- **Agent brains are NOT shared**: Each agent gets its own Neural Memory MCP instance
- **CEO is the only pre-built agent**: It manages hiring, roles, and meetings
- **ESM imports**: Use `.js` extensions in import paths (TypeScript NodeNext resolution)
- **IDs**: Text primary keys (nanoid or semantic like `'ceo'`, `'engineering'`)
- **Auth (MVP)**: Token must match agentId (pre-shared token pattern, placeholder for JWT)

## Git workflow

- **Main branch**: `main` — protected, never push directly
- **Never force push** to `main`
- **All work goes through feature branches** — create a branch, commit there, merge via PR
- **Branch naming**: `<type>/<short-description>`
  - `feat/meeting-room` — new feature
  - `fix/auth-token-validation` — bug fix
  - `refactor/session-cleanup` — refactoring
  - `test/hub-integration` — adding tests
  - `docs/api-protocol` — documentation
  - `chore/deps-update` — maintenance
- **Commit messages**: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format
  - `feat: add meeting phase state machine`
  - `fix: validate token before session create`
  - `refactor(hub): simplify session cleanup`
  - `test: add auth integration tests`
  - `docs: update protocol spec`
  - `chore: bump drizzle-orm to 0.40`
  - Use `!` for breaking changes: `feat!: redesign auth protocol`
  - Body/footer optional, use for context when needed
- **One branch per milestone or logical unit** — don't mix unrelated changes

## Key docs

- `PLAN.md` — Full architecture, schema, protocol spec, all 5 milestones
- `docs/CHANGELOG.md` — Running log of completed work
- `docs/milestones/01-05` — Per-milestone task tracking
