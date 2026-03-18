---
title: Architecture Overview
description: How Archon's layers connect.
---

## System Diagram

```
You (CEO) ──WebSocket──→ Hub Server
                           │
                         Router ──→ SessionManager (who's connected)
                           │
                    ┌──────┼──────┐
                    │      │      │
              Agent CRUD  Meeting  Directory
                    │      │      │
                  Postgres DB (drizzle-orm)
                           │
              Agent Spawner (spawns LLM processes for meetings)
                           │
              scripts/agent.ts (LLM + WebSocket client)
```

## Layers

### 1. Boot (`src/index.ts`)

Entry point. Does 3 things in order:
1. Check LLM availability
2. Test database connection
3. Start WebSocket hub

### 2. Hub Server (`src/hub/server.ts`)

WebSocket server using the `ws` library. Accepts connections and hands every message to the Router. Tracks active sessions via `SessionManager` (maps agentId to socket).

### 3. Router (`src/hub/router.ts`)

The brain. Every WebSocket message flows through here:
1. Parse JSON
2. Validate against Zod schema (`InboundMessage` discriminated union)
3. Auth gate — unauthenticated sockets can only send `auth`
4. Dispatch by message type (~40 switch cases)
5. Call handler → send response

### 4. Meeting Room (`src/meeting/meeting-room.ts`)

State machine for a single meeting. Manages phases, turn-taking, proposals, voting, and task assignment. Each `MeetingRoom` instance lives in the Router's `activeMeetings` map.

### 5. Agent Runner (`scripts/agent.ts`)

Spawned as a child process for each agent. Loads identity files (SOUL.md, IDENTITY.md, PLAYBOOK.md) into a system prompt, connects to the hub via WebSocket, and uses an LLM to generate responses to meeting events.

### 6. Protocol (`src/protocol/messages.ts`)

Zod schemas for every message type. The `InboundMessage` discriminated union is the single source of truth — if a message type isn't in the union, the hub rejects it.

### 7. Database (`src/db/schema.ts`)

Drizzle ORM schema with 9 tables. See [Database Schema](/architecture/database/) for details.

## Directory Structure

```
archon/
├── agents/ceo/           # CEO identity files (checked into repo)
├── docs-site/            # This documentation site
├── drizzle/              # SQL migrations
├── methodologies/        # Meeting methodology files
├── scripts/              # Agent runner, meeting scripts, review tools
├── src/
│   ├── agent/            # AgentClient library
│   ├── db/               # Schema, connection, seed
│   ├── hub/              # Server, Router, SessionManager, Spawner
│   ├── meeting/          # MeetingRoom, methodology parser, relevance, turns
│   ├── protocol/         # Zod message schemas, error codes
│   ├── registry/         # Agent CRUD, agent cards, discovery
│   └── utils/            # Logger
└── tests/                # Vitest test suites
```
