---
title: Architecture Decision Records
description: Key design decisions and their rationale.
---

## ADR Index

Architecture Decision Records document the reasoning behind key design choices. Each ADR captures the context, decision, and consequences.

### ADR-001: WebSocket Hub Over MCP

**Decision**: Build a purpose-built WebSocket server instead of using MCP (Model Context Protocol).

**Why**: MCP's stdio/SSE transport doesn't support real-time broadcast — a meeting room needs to push messages to all participants simultaneously. WebSocket provides full-duplex, multi-client communication.

### ADR-002: Agents Connect, Not Spawned

**Decision**: Agents connect to the hub as WebSocket clients, rather than being embedded in the hub process.

**Why**: Separation of concerns — each agent runs in its own process with its own LLM context. Agents can be written in any language, use any LLM provider, and crash independently without taking down the hub.

### ADR-003: Three-Phase Streaming

**Decision**: Meeting communication uses a three-phase pattern: relevance check → turn grant → speak.

**Why**: Prevents agents from talking over each other. The relevance-based selection ensures the most qualified agent speaks next, not just whoever responds fastest.

### ADR-004: Simplified Task State Machine

**Decision**: Meeting phases are a linear sequence (PRESENT → DISCUSS → DECIDE → ASSIGN) rather than a graph with arbitrary transitions.

**Why**: Linear phases are predictable and debuggable. Custom methodologies can define any number of phases in any order, but each meeting flows forward, never backward.

### ADR-005: Git Worktree Isolation

**Decision**: Agents doing code work use git worktrees for isolation.

**Why**: Multiple agents working on the same repo simultaneously would create merge conflicts. Worktrees give each agent an isolated copy of the repo that can be merged back cleanly.

---

Full ADR documents are in `docs/decisions/` in the repository.
