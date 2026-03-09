# Milestone 1: Foundation

> Status: **In Progress**
> Goal: Hub boots, Postgres connected, agents can authenticate.

---

## Tasks

### Project Setup
- [x] Clean workspace (remove Zig scaffold: build.zig, build.zig.zon, src/, zig-out/)
- [x] Initialize `package.json` with dependencies
- [x] Create `tsconfig.json`
- [x] Create `docker-compose.yml` (Postgres 16)
- [x] Create `drizzle.config.ts`

### Database
- [x] `src/db/schema.ts` — Drizzle schema for all 9 tables
- [x] `src/db/connection.ts` — Postgres pool + drizzle instance
- [x] Generate initial migration (`npm run db:generate`)
- [ ] Run migration (`npm run db:migrate`) — **blocked: need Postgres running**

### Hub Core
- [x] `src/protocol/messages.ts` — Zod schemas (auth messages first)
- [x] `src/protocol/errors.ts` — Error codes
- [x] `src/hub/server.ts` — WebSocket server with `ws`
- [x] `src/hub/session.ts` — AgentSession tracking
- [x] `src/hub/router.ts` — Message dispatch (auth only)
- [x] `src/utils/logger.ts` — pino setup

### Entry Point
- [x] `src/index.ts` — Boot sequence (load config → connect DB → start WS)

### Verification
- [ ] Manual test: connect with `wscat`, send auth, receive auth.ok — **blocked: need Postgres running**

---

## Notes
- TypeScript compiles clean (`tsc --noEmit` passes)
- Migration generated: `drizzle/0000_nosy_tombstone.sql` (9 tables, all FKs, all indexes)
- Docker registry unreachable during initial setup — need to start Postgres manually or fix network
- MVP auth: token must match agent ID (pre-shared token). TODO: replace with JWT later.

---

## Deliverable
A running WebSocket server that authenticates agents against Postgres.
