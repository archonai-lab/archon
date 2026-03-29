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
                           │
              archon-agent MCP server (per-agent, stdio)
                           │
              nmem-mcp child process (neural memory)
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

### 6. archon-agent MCP Server (`src/mcp/server.ts`)

Each agent runs its own `archon-agent` MCP server instance (stdio transport). It exposes tools the agent's LLM can call:

- **`identity_load`** — reads SOUL.md and IDENTITY.md from the agent's workspace
- **`context_get`**, **`meeting_join`**, **`status_report`** — stubs, not yet implemented
- All neural memory tools forwarded from nmem-mcp (see below)

The server starts by calling `connect()` on the neural memory bridge. If nmem-mcp fails to spawn, the server exits immediately — an agent without memory is broken, not degraded.

### 7. Neural Memory Bridge (`src/mcp/bridge.ts`)

Spawns `nmem-mcp` (from the `neural-memory` package) as a child process via `uvx`. Connects using `StdioClientTransport`, performs a health check via `listTools()`, then registers every discovered tool on the MCP server as a passthrough. Tool calls are forwarded verbatim — no filtering, no transformation.

Fail-fast: if spawn or health check fails, `connect()` throws, and the agent process exits.

### 8. Protocol (`src/protocol/messages.ts`)

Zod schemas for every message type. The `InboundMessage` discriminated union is the single source of truth — if a message type isn't in the union, the hub rejects it.

### 9. Database (`src/db/schema.ts`)

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
│   ├── mcp/              # archon-agent MCP server, neural memory bridge, tool stubs
│   ├── meeting/          # MeetingRoom, methodology parser, relevance, turns
│   ├── protocol/         # Zod message schemas, error codes
│   ├── registry/         # Agent CRUD, agent cards, discovery
│   └── utils/            # Logger
└── tests/                # Vitest test suites
```
