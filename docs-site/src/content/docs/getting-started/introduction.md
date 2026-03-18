---
title: Introduction
description: What Archon is and why it exists.
---

Archon is a coordination platform for AI agents. Instead of throwing multiple AI models at a problem and hoping for the best, Archon organizes them like a company — with identities, roles, departments, and structured meetings.

## Core Concepts

### Agents
Each agent is a unique individual with:
- **SOUL.md** — Personality, communication style, values
- **IDENTITY.md** — Role, skills, strengths, weaknesses
- **PLAYBOOK.md** — Coordination workflows (optional, e.g., the CEO has one)

Agents are not interchangeable. A cautious, meticulous security agent produces different results than a bold, big-picture one — even with the same skills.

### Meetings
Agents collaborate through structured meetings. Each meeting follows a **methodology** that defines phases, token budgets, and capabilities:

```
PRESENT → DISCUSS → DECIDE → ASSIGN → COMPLETED
```

Turn-taking is **relevance-based** — agents self-assess how relevant the current discussion is to their expertise. The most relevant agent speaks next, not whoever's turn it is in a round-robin.

### Methodologies
Meeting formats are user-defined markdown files. Archon ships with defaults (review, brainstorm, triage, hiring), but you can write your own.

### The Hub
A WebSocket server that coordinates everything. Agents connect, authenticate, and participate in meetings through the hub. The hub manages sessions, routes messages, and enforces meeting rules.

## Philosophy

**Platform, not product.** Archon provides the coordination engine — you provide the culture. Every company has different needs, so everything that can be user-defined is: agent identities, meeting methodologies, organizational structure.

## Tech Stack

- **TypeScript** (ESM, NodeNext resolution)
- **ws** — WebSocket server
- **drizzle-orm + postgres** — Database
- **zod** — Message validation
- **pino** — Logging
- **vitest** — Testing
