# Future Considerations

> Ideas to revisit after MVP (Milestones 3-5 done).
> Not blocking current work — just parked here so we don't forget.

---

## Client Layer (post-infrastructure)

The hub is protocol-agnostic — any client that speaks WebSocket can connect.
Build infrastructure first, pick client later.

### Options to evaluate

- [ ] **TUI (Rust + ratatui)** — minimal, fast, matches the CLI-first philosophy.
  Power-user experience. Could be the first client we ship.

- [ ] **Tauri desktop app** — single binary, cross-platform (macOS/Linux/Windows).
  Rust backend could embed the hub itself (no separate server process).
  Frontend still web tech (React/Svelte). Worth it if we want polished UX.

- [ ] **Web UI (minimal React)** — fastest to prototype, no install needed.
  Good for dashboard/meeting viewer. Claw-Empire's patterns available as reference.

- [ ] **Embedded hub in Rust** — rewrite hub in Rust or run TypeScript as Tauri sidecar.
  Single binary distribution (`archon` does everything). Big decision — defer until
  we know if TypeScript hub performance is a bottleneck.

### Decision criteria (evaluate when ready)
- Do we need offline/desktop distribution? → Tauri
- Is the hub a performance bottleneck? → Rust rewrite
- Do users want a quick terminal experience? → TUI first
- Do we just need a meeting viewer? → Web UI

---

## Tech Stack Considerations

- [ ] **Rust for hub** — performance, single binary, cross-platform. But: ecosystem cost
  (no drizzle, less WS tooling). Only worth it if TypeScript hub becomes a bottleneck.

- [ ] **Borrow Claw-Empire patterns** — see `docs/claw-empire-learnings.md` for
  production-tested patterns (WS batching, worktree isolation, task state machine,
  agent spawning model). Cherry-pick as needed per milestone.

- [ ] **WS message batching** — add to hub before Milestone 3 ships. Simple now,
  painful to retrofit when meetings generate high-frequency events.

- [ ] **Connection resilience** — reconnect logic, session recovery after hub restart.
  Not in any current milestone. Add before Milestone 4 (agent connections).

---

## Post-MVP Features (from PLAN.md Section 10)

- Analytics (token tracking per agent/meeting/project)
- Backlog management (tasks, sprints, story points)
- `archon` CLI for power-user management
- Multi-company support
- Agent performance reviews
- Hub replication (HA)
- Community adapters (OpenClaw, NullClaw, ACPX bridges)
- Cross-memory sharing (opt-in between agents)
