# Milestone 3: Meeting Room Core

> Status: **Not Started**
> Goal: The meeting loop works end-to-end through all 4 phases.

---

## Tasks

### Message Types
- [ ] `src/meeting/types.ts` — All meeting message Zod schemas

### Phase State Machine
- [ ] `src/meeting/phases.ts` — PRESENT → DISCUSS → DECIDE → ASSIGN transitions
  - Transition triggers: budget exhaustion, all-pass, initiator advance
  - Cancel from any phase

### Meeting Room
- [ ] `src/meeting/meeting-room.ts` — MeetingRoom class
  - Create meeting record in Postgres
  - Manage participant list
  - Track current phase
  - Broadcast messages to participants
  - Store all messages in `meeting_messages`

### Turn Management
- [ ] `src/meeting/turn-manager.ts` — Relevance collection, 10s timeout, turn ordering
  - MUST_SPEAK first (by response time), then COULD_ADD
  - All PASS → auto-advance phase

### Token Budget
- [ ] `src/utils/token-counter.ts` — tiktoken wrapper
- [ ] Budget enforcement: PRESENT 20%, DISCUSS 50%, DECIDE 20%, ASSIGN 10%
- [ ] Auto-advance on budget exhaustion

### Router
- [ ] Add all `meeting.*` handlers to router

### Persistence
- [ ] Save decisions (DECIDE phase) to meetings.decisions JSONB
- [ ] Save action items (ASSIGN phase) to meetings.action_items JSONB
- [ ] Update meeting status on completion

### Tests
- [ ] Phase transition tests
- [ ] Budget exhaustion tests
- [ ] Turn ordering tests
- [ ] Meeting persistence tests

---

## Notes
_Add implementation notes, blockers, and discoveries here._

---

## Deliverable
Agents can hold a structured meeting through all four phases.
