# Milestone 2: Registry & Discovery

> Status: **Not Started**
> Goal: Agents can discover each other via Agent Cards.

---

## Tasks

### Agent Workspaces
- [ ] Create CEO agent workspace template in `agents/ceo/` (SOUL.md, IDENTITY.md, MEMORY.md, AGENTS.md)
- [ ] Define default agent workspace template in `agents/templates/default/`

### Database Seeding
- [ ] `src/db/seed.ts` — CEO agent, sample departments (engineering, research, planning), roles

### Registry
- [ ] `src/registry/agent-card.ts` — Read SOUL.md + IDENTITY.md, merge with DB, produce AgentCard JSON
  - Document A2A Agent Card inspiration in comments
- [ ] `src/registry/agent-registry.ts` — CRUD for agents, departments, roles
- [ ] `src/registry/discovery.ts` — Permission-filtered agent listing

### Permissions
- [ ] `src/hub/permissions.ts` — Permission checking against DB

### Router
- [ ] Add `directory.list` handler
- [ ] Add `directory.get` handler

### Tests
- [ ] Agent card generation tests
- [ ] Discovery filtering tests
- [ ] Registry CRUD tests

---

## Notes
_Add implementation notes, blockers, and discoveries here._

---

## Deliverable
Agents see each other's capabilities and organizational positions.
