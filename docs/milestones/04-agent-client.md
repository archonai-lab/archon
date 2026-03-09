# Milestone 4: Agent Client + Relevance Detector

> Status: **Not Started**
> Goal: Agents autonomously decide when to speak and participate in meetings.

---

## Tasks

### Relevance Detector
- [ ] `src/meeting/relevance.ts` — Relevance prompt builder (server-side reference)
  - Prompt template: SOUL + IDENTITY + context → MUST_SPEAK / COULD_ADD / PASS
  - Cheap/fast: short prompt, constrained output

### Agent Client Library
- [ ] Agent client (TypeScript library) wrapping WebSocket connection:
  - [ ] Auth handshake
  - [ ] Meeting participation helpers (join, speak, vote, acknowledge)
  - [ ] Relevance detector (runs prompt via configured model provider)
  - [ ] Reconnect logic with backoff
  - [ ] Local state cache (offline mode — SPOF Phase 1)

### Model Provider Integration
- [ ] acpx provider — send prompts through acpx
- [ ] API provider — direct API calls (OpenAI, Anthropic)
- [ ] CLI provider — subprocess spawn fallback
- [ ] Provider config read from `~/.archon/agents/[name]/config.toml`

### Neural Memory Integration
- [ ] Agent consults Neural Memory (nmem_recall) during relevance check
- [ ] Agent uses Neural Memory (nmem_context) before speaking
- [ ] Agent stores meeting insights (nmem_remember) after meetings

### Agent Runner
- [ ] Runner script: reads SOUL.md/IDENTITY.md → connects to hub → participates
- [ ] Each agent spawns with its own Neural Memory MCP instance

### Integration Test
- [ ] Start hub + 3 agent processes
- [ ] Create meeting, observe emergent discussion
- [ ] Verify relevance-based turn selection works

---

## Notes
_Add implementation notes, blockers, and discoveries here._

---

## Deliverable
Fully autonomous meeting between agents with relevance-based turns and memory-informed responses.
