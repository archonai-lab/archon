# Milestone 1: Foundation

> Status: **Not Started**
> Goal: Hub boots, Postgres connected, agents can authenticate.

---

## Tasks

### Project Setup
- [ ] Clean workspace (remove Zig scaffold: build.zig, build.zig.zon, src/, zig-out/)
- [ ] Initialize `package.json` with dependencies
- [ ] Create `tsconfig.json`
- [ ] Create `docker-compose.yml` (Postgres 16)
- [ ] Create `drizzle.config.ts`

### Database
- [ ] `src/db/schema.ts` — Drizzle schema for all 9 tables
- [ ] `src/db/connection.ts` — Postgres pool + drizzle instance
- [ ] Generate initial migration (`npm run db:generate`)
- [ ] Run migration (`npm run db:migrate`)

### Hub Core
- [ ] `src/protocol/messages.ts` — Zod schemas (auth messages first)
- [ ] `src/protocol/errors.ts` — Error codes
- [ ] `src/hub/server.ts` — WebSocket server with `ws`
- [ ] `src/hub/session.ts` — AgentSession tracking
- [ ] `src/hub/router.ts` — Message dispatch (auth only)
- [ ] `src/utils/logger.ts` — pino setup

### Entry Point
- [ ] `src/index.ts` — Boot sequence (load config → connect DB → start WS)

### Verification
- [ ] Manual test: connect with `wscat`, send auth, receive auth.ok

---

## Notes
_Add implementation notes, blockers, and discoveries here._

---

## Deliverable
A running WebSocket server that authenticates agents against Postgres.
