# Archon — Agent Company Platform

> Master Plan v1.2 | Created: 2026-03-09
> Status: In Progress (Milestones 1-2 complete, 3 nearly complete, 4 in progress, 5-7 planned)

---

## 1. Vision

A platform that organizes AI agents like a company. Instead of dumb request-response orchestration, agents **collaborate like humans** — they have identities, roles, memories, and hold meetings where they discuss, debate, and decide together.

The core philosophy: **each agent is a human, not a function.**

---

## 2. Architecture Overview

```
~/.archon/                              archon/
(Runtime Data)                          (Platform Source Code)
├── config.toml                         ├── src/
├── agents/                             │   ├── index.ts
│   ├── ceo/  (pre-built)              │   ├── db/
│   ├── vex/                           │   ├── hub/
│   └── satra/                         │   ├── registry/
├── templates/                          │   ├── meeting/
└── data/                               │   ├── protocol/
                                        │   └── utils/
                                        ├── agents/  (templates)
                                        └── tests/
```

```
┌─────────────────────────────────────────────────────────────────┐
│                    Archon Platform                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│  │  Hub (TS)    │  │  Postgres    │  │  Neural-Memory     │   │
│  │  WebSocket   │  │  Company DB  │  │  (per-agent brain) │   │
│  │  Auth/Perms  │  │  Meetings    │  │  Hebbian learning  │   │
│  │  Router      │  │  Projects    │  │  Spreading activ.  │   │
│  └──────┬───────┘  └──────────────┘  └────────────────────┘   │
│         │                                                       │
│  ┌──────┴──────────────────────────────────────────────────┐   │
│  │              Agent Runtime Layer                         │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐  │   │
│  │  │  CEO    │  │  Vex    │  │  Satra  │  │  Kalyx   │  │   │
│  │  │  acpx → │  │  acpx → │  │  acpx → │  │  acpx →  │  │   │
│  │  │  claude │  │  codex  │  │  gemini │  │  claude  │  │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └──────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Confirmed Decisions

### 3.1 TypeScript for Hub
MCP SDK ecosystem is Python/TypeScript. Building MCP protocol handling in Zig would cost weeks with no ecosystem benefit. TypeScript gives us type safety + ecosystem.

### 3.2 Runtime Directory: `~/.archon/`
No hardcoded paths. All agent workspaces, configs, and runtime data live in `~/.archon/`. The project repo is platform source code only.

```
~/.archon/
├── config.toml                  # Hub settings (port, DB url, defaults)
├── agents/
│   ├── ceo/
│   │   ├── config.toml          # Model provider config
│   │   ├── SOUL.md              # Persona, values, communication style
│   │   ├── IDENTITY.md          # Name, characteristics
│   │   ├── MEMORY.md            # Curated long-term memories
│   │   └── AGENTS.md            # Workspace conventions
│   ├── vex/
│   │   ├── config.toml
│   │   └── ...
│   └── [agent-name]/
│       └── ...
├── templates/                   # Agent workspace templates
│   └── default/
│       ├── SOUL.md.template
│       ├── IDENTITY.md.template
│       ├── config.toml.template
│       └── ...
└── data/                        # Local caches, offline queues
```

### 3.3 Agent Model Layer (acpx)
Agents are provider-agnostic. Each agent configures its own LLM backend:

```toml
# ~/.archon/agents/vex/config.toml
[model]
provider = "acpx"           # "acpx" | "api" | "cli"
backend = "claude-code"     # acpx backend name

# OR direct API
# provider = "api"
# backend = "openai"
# api_key_env = "OPENAI_API_KEY"
# model = "gpt-5.4"

# OR raw CLI
# provider = "cli"
# command = "gemini-cli"
# args = ["--headless", "--json"]
```

| Mode | How | When |
|------|-----|------|
| `acpx` | Routes through acpx to Claude Code, Codex, Gemini, etc. | Default. One protocol for all providers. |
| `api` | Direct API call (OpenAI, Anthropic with key) | When you have API access, want lower latency |
| `cli` | Raw subprocess spawn | Fallback for unsupported tools |

### 3.4 A2A-Inspired Agent Cards
Auto-generated from IDENTITY.md + SOUL.md + Postgres role data. Borrowed from Google's A2A protocol Agent Card concept — NOT the full A2A transport protocol.

> **Code convention**: Document A2A origins in comments wherever this pattern is used.

### 3.5 Neural Memory (Per-Agent Brains)
Each agent gets its own [Neural Memory](https://github.com/nhadaututtheky/neural-memory) MCP instance:

- Brain-inspired: neurons + 20 typed synapses (temporal, causal, semantic, emotional, conflict)
- Hebbian learning: co-accessed memories strengthen connections
- Ebbinghaus decay: Short-term → Working → Episodic → Semantic
- Associative retrieval via spreading activation (NOT vector similarity / keyword search)
- Contradiction detection: auto-detects conflicting memories
- Zero LLM dependency: pure algorithmic (regex, graph traversal, SQLite)
- **Memories are NOT shared** — like humans don't share brains

Key MCP tools: `nmem_remember`, `nmem_recall`, `nmem_context`, `nmem_auto`, `nmem_habits`

### 3.6 CEO Agent (Pre-Built)
The CEO is the only agent that ships with the platform. It's the onboarding UX:

- Always online — first agent spawned when platform starts
- Admin permissions — can create agents, departments, assign roles
- Helps users build their company: "I need a SaaS team" → CEO hires, assigns, schedules kickoff
- Manages the org chart, hiring, firing, restructuring
- Suggests agent characteristics based on project needs
- Calls and facilitates meetings

### 3.7 SPOF Mitigation
- **Phase 1 (MVP)**: Local state cache per agent — cached directory, permissions, recent messages
- **Phase 2**: Hub heartbeat + graceful degradation — agents queue messages offline
- **Phase 3 (if needed)**: Replicated hub behind load balancer

### 3.8 Project Methodology
Each project selects a software cycle to structure progress:
- Waterfall, Agile/Scrum, Kanban, or custom
- Defines: what was done, what's next, what's the goal
- Prevents chaos in multi-agent collaboration

---

## 4. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Hub | TypeScript + `ws` | Type-safe, minimal WebSocket (not Socket.IO — agents aren't browsers) |
| Database | PostgreSQL + `drizzle-orm` + `postgres` (porsager) | Type-safe SQL, migrations, JSONB support |
| Validation | `zod` | Runtime validation for all WebSocket messages |
| Token Counting | `tiktoken` | Accurate token budget tracking for meetings |
| Logging | `pino` | Structured JSON logging |
| Agent Memory | Neural Memory MCP | Brain-inspired associative memory (per-agent) |
| Agent Model | `acpx` | Provider-agnostic agent execution |
| IDs | `nanoid` | Compact, URL-safe unique IDs |
| Testing | `vitest` | Fast, TypeScript-native |
| Dev Runtime | `tsx` | TypeScript execution without build step |
| Containerization | Docker Compose | Postgres + dev services |

**Note**: The hub is NOT an MCP server. MCP's transport (stdio/SSE) doesn't support real-time broadcast to multiple agents. The hub is a purpose-built WebSocket coordination server. Agents use MCP independently for Neural Memory and other tools.

---

## 5. Project Source Structure

```
archon/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── docker-compose.yml               # Postgres
├── PLAN.md                           # This file
├── CLAUDE.md
│
├── src/
│   ├── index.ts                     # Entry: boot DB, start WS server
│   │
│   ├── db/
│   │   ├── schema.ts                # Drizzle ORM schema (all tables)
│   │   ├── connection.ts            # Postgres pool + drizzle instance
│   │   └── seed.ts                  # Seed: CEO agent, sample departments
│   │
│   ├── hub/
│   │   ├── server.ts                # WebSocket server (ws library)
│   │   ├── router.ts                # Message type → handler dispatch
│   │   ├── session.ts               # AgentSession tracking (connected agents)
│   │   └── permissions.ts           # Permission checks against DB
│   │
│   ├── registry/
│   │   ├── agent-registry.ts        # CRUD for agents, departments, roles
│   │   ├── agent-card.ts            # Auto-generate Agent Cards from identity + DB
│   │   └── discovery.ts             # Filtered agent listing (permission-aware)
│   │
│   ├── meeting/
│   │   ├── meeting-room.ts          # MeetingRoom class: the core loop
│   │   ├── phases.ts                # Phase state machine: PRESENT→DISCUSS→DECIDE→ASSIGN
│   │   ├── turn-manager.ts          # Relevance scoring, turn ordering, token budget
│   │   ├── token-counter.ts         # Token estimation (chars/4)
│   │   └── types.ts                 # Meeting-specific message types
│   │
│   ├── protocol/
│   │   ├── messages.ts              # All WebSocket message Zod schemas
│   │   └── errors.ts                # Error codes and error message factory
│   │
│   └── utils/
│       └── logger.ts                # pino structured logging
│
├── agents/                           # Agent workspace templates (shipped with platform)
│   └── ceo/                          # The pre-built CEO agent
│       ├── SOUL.md
│       ├── IDENTITY.md
│       ├── MEMORY.md
│       └── AGENTS.md
│
├── scripts/
│   ├── agent.ts                     # Agent runner: connects to hub, participates in meetings via LLM
│   └── start-meeting.ts             # Meeting starter: creates meeting, auto-facilitates phases
│
├── drizzle/                          # Generated SQL migration files
│
└── tests/
    ├── hub/
    │   └── server.test.ts
    ├── meeting/
    │   ├── meeting-room.test.ts
    │   ├── phases.test.ts
    │   └── turn-manager.test.ts
    └── registry/
        └── agent-registry.test.ts
```

---

## 6. Postgres Schema

### Tables

#### `departments`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | e.g. 'engineering', 'research' |
| name | TEXT NOT NULL | Display name |
| description | TEXT | |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

#### `roles`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | e.g. 'lead_dev', 'architect' |
| department_id | TEXT FK → departments | |
| name | TEXT NOT NULL | |
| permissions | JSONB | Array of permission strings |
| created_at | TIMESTAMPTZ | |
| | | UNIQUE(department_id, name) |

#### `agents`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | e.g. 'vex', 'ceo' |
| display_name | TEXT NOT NULL | |
| workspace_path | TEXT NOT NULL | Absolute path to ~/.archon/agents/[name]/ |
| status | TEXT | 'online' / 'offline' / 'busy' |
| agent_card | JSONB | Auto-generated, cached |
| model_config | JSONB | Provider, backend, model info |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `agent_departments`
| Column | Type | Notes |
|--------|------|-------|
| agent_id | TEXT FK → agents | |
| department_id | TEXT FK → departments | |
| role_id | TEXT FK → roles | |
| assigned_at | TIMESTAMPTZ | |
| | | PK(agent_id, department_id) — one role per dept |

#### `permissions`
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| agent_id | TEXT FK → agents | |
| resource | TEXT | e.g. 'agent:satra', 'department:*', 'meeting:*' |
| action | TEXT | e.g. 'view', 'message', 'invite', 'admin', 'create_agent' |
| granted_at | TIMESTAMPTZ | |

#### `projects`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| name | TEXT NOT NULL | |
| description | TEXT | |
| methodology | TEXT | 'waterfall' / 'scrum' / 'kanban' |
| status | TEXT | 'active' / 'completed' / 'archived' |
| department_id | TEXT FK → departments | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `meetings`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | |
| project_id | TEXT FK → projects | nullable (ad-hoc meetings) |
| title | TEXT NOT NULL | |
| phase | TEXT | 'present' / 'discuss' / 'decide' / 'assign' |
| status | TEXT | 'active' / 'completed' / 'cancelled' |
| initiator_id | TEXT FK → agents | |
| token_budget | INTEGER | DEFAULT 50000 |
| tokens_used | INTEGER | DEFAULT 0 |
| agenda | JSONB | Structured agenda from PRESENT phase |
| decisions | JSONB | Array of decisions from DECIDE phase |
| action_items | JSONB | Array of {task, owner_agent_id, deadline} |
| created_at | TIMESTAMPTZ | |
| completed_at | TIMESTAMPTZ | |

#### `meeting_participants`
| Column | Type | Notes |
|--------|------|-------|
| meeting_id | TEXT FK → meetings | |
| agent_id | TEXT FK → agents | |
| invited_at | TIMESTAMPTZ | |
| joined_at | TIMESTAMPTZ | |
| | | PK(meeting_id, agent_id) |

#### `meeting_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| meeting_id | TEXT FK → meetings | |
| agent_id | TEXT FK → agents | |
| phase | TEXT | Phase when message was sent |
| content | TEXT NOT NULL | |
| token_count | INTEGER | |
| relevance | TEXT | 'must_speak' / 'could_add' / 'pass' |
| created_at | TIMESTAMPTZ | |

### Indexes
```sql
CREATE INDEX idx_agent_departments_agent ON agent_departments(agent_id);
CREATE INDEX idx_agent_departments_dept ON agent_departments(department_id);
CREATE INDEX idx_meeting_messages_meeting ON meeting_messages(meeting_id);
CREATE INDEX idx_meetings_project ON meetings(project_id);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_permissions_agent ON permissions(agent_id);
```

### Migration Strategy
- Drizzle Kit generates SQL from TypeScript schema definitions
- `npm run db:generate` → produces `drizzle/XXXX_name.sql`
- `npm run db:migrate` → applies to Postgres
- Docker Compose provides Postgres for development

---

## 7. Meeting Room Protocol

### 7.1 The Core Loop

The meeting room is the killer feature — **emergent collaboration, not orchestration**.

```
User: "I have an idea for X"
    ↓
CEO creates meeting, invites relevant agents
    ↓
[PRESENT]  CEO presents the idea/problem
    ↓
[DISCUSS]  Agents react, debate, build on each other
           (relevance-based turns, not round-robin)
    ↓
[DECIDE]   Proposals + voting → decisions
    ↓
[ASSIGN]   Break into action items with owners
    ↓
Meeting record saved to Postgres
```

### 7.2 Phase State Machine

```
PRESENT ──→ DISCUSS ──→ DECIDE ──→ ASSIGN ──→ COMPLETED
   │            │           │          │
   └────────────┴───────────┴──────────┘
              (can be CANCELLED from any phase)
```

**Token budget allocation per phase:**
| Phase | Budget % | Purpose |
|-------|----------|---------|
| PRESENT | 20% | Initiator explains the problem/idea |
| DISCUSS | 50% | Open discussion, debate, brainstorming |
| DECIDE | 20% | Proposals, voting, convergence |
| ASSIGN | 10% | Task breakdown and assignment |

**Phase transition triggers:**
- PRESENT → DISCUSS: Initiator advances, or PRESENT budget exhausted
- DISCUSS → DECIDE: All agents pass consecutively, DISCUSS budget exhausted, or initiator advances
- DECIDE → ASSIGN: All proposals voted on
- ASSIGN → COMPLETED: All action items acknowledged

### 7.3 Relevance-Based Turn Management

NOT round-robin. Agents decide if they should speak:

1. Hub broadcasts latest message to all participants
2. Hub sends `meeting.relevance_check` to each participant
3. Each agent runs the **relevance detector** (cheap prompt against their SOUL/IDENTITY + Neural Memory)
4. Agents respond: `MUST_SPEAK` / `COULD_ADD` / `PASS`
5. Hub gives floor to MUST_SPEAK first (ordered by response time), then COULD_ADD if budget allows
6. If ALL agents PASS → phase auto-advances

**Relevance prompt template (runs on agent side, cheap/fast):**
```
You are {agent_name}. Your expertise: {strengths}. Your weaknesses: {weaknesses}.

Meeting phase: {phase}
Meeting context so far: {context_summary}
Last message (by {speaker}): {last_message}

Based on your expertise and the current discussion, should you speak?

Respond with EXACTLY one of:
- MUST_SPEAK: Critical info, strong objection, or expertise directly needed
- COULD_ADD: Useful but not essential
- PASS: Nothing to add, or others are better suited

Answer: [MUST_SPEAK|COULD_ADD|PASS]
Reason: [one sentence]
```

### 7.4 WebSocket Message Flow

```
Hub                          Agent-Vex                    Agent-Satra
 │                              │                             │
 │◄── meeting.create ───────────│                             │
 │── meeting.invite ──────────────────────────────────────────►│
 │◄── meeting.join ───────────────────────────────────────────│
 │                              │                             │
 │── meeting.phase_change ─────►│ (PRESENT)                   │
 │── meeting.phase_change ──────────────────────────────────►│
 │                              │                             │
 │◄── meeting.speak ────────────│ (presents problem)          │
 │── meeting.message ──────────►│ (broadcast)                 │
 │── meeting.message ──────────────────────────────────────►│
 │                              │                             │
 │── meeting.relevance_check ──►│                             │
 │── meeting.relevance_check ──────────────────────────────►│
 │◄── meeting.relevance ────────│ (COULD_ADD)                 │
 │◄── meeting.relevance ──────────────────────────────────────│ (MUST_SPEAK)
 │                              │                             │
 │── meeting.your_turn ────────────────────────────────────►│ (Satra first)
 │◄── meeting.speak ──────────────────────────────────────────│
 │── meeting.message ──────────►│                             │
 │── meeting.message ──────────────────────────────────────►│
 │   ... (continues until phase transition) ...               │
```

### 7.5 Agent Card Format

Inspired by Google's A2A protocol Agent Card concept (discovery mechanism only, not A2A transport).

```typescript
/**
 * AgentCard — inspired by Google A2A protocol's Agent Card concept.
 * @see https://a2a-protocol.org/latest/specification/
 * We borrow the discovery/card pattern, NOT the A2A transport (HTTP/SSE).
 */
interface AgentCard {
  // Identity (from IDENTITY.md)
  id: string;
  displayName: string;
  description: string;
  version: string;

  // Organization (from Postgres)
  departments: Array<{
    id: string;
    name: string;
    role: { id: string; name: string };
  }>;

  // Characteristics (from SOUL.md + IDENTITY.md)
  characteristics: {
    personality: string;
    strengths: string[];
    weaknesses: string[];
    communication_style: string;
  };

  // Skills
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;

  // Live status
  status: 'online' | 'offline' | 'busy';
  currentMeeting: string | null;

  // Model info
  model: {
    provider: 'acpx' | 'api' | 'cli';
    backend: string;
  };

  // Metadata
  createdAt: string;
  updatedAt: string;
}
```

Auto-generated by reading IDENTITY.md + SOUL.md + querying Postgres for roles/departments. Cached in `agents.agent_card` JSONB column, invalidated on identity file change or role reassignment.

---

## 8. WebSocket Message Types

### Auth
| Type | Direction | Payload |
|------|-----------|---------|
| `auth` | Agent → Hub | `{ agentId, token }` |
| `auth.ok` | Hub → Agent | `{ agentCard, pendingInvites }` |
| `auth.error` | Hub → Agent | `{ code, message }` |

### Directory
| Type | Direction | Payload |
|------|-----------|---------|
| `directory.list` | Agent → Hub | `{ filter?: { departmentId? } }` |
| `directory.result` | Hub → Agent | `{ agents: AgentCard[] }` |

### Meeting Lifecycle
| Type | Direction | Payload |
|------|-----------|---------|
| `meeting.create` | Agent → Hub | `{ title, projectId?, invitees[], tokenBudget?, agenda? }` |
| `meeting.invite` | Hub → Agent | `{ meetingId, title, initiator, agenda? }` |
| `meeting.join` | Agent → Hub | `{ meetingId }` |
| `meeting.leave` | Agent → Hub | `{ meetingId }` |

### Meeting Flow
| Type | Direction | Payload |
|------|-----------|---------|
| `meeting.phase_change` | Hub → Agent | `{ meetingId, phase, budgetRemaining }` |
| `meeting.speak` | Agent → Hub | `{ meetingId, content }` |
| `meeting.message` | Hub → Agents | `{ meetingId, agentId, content, phase, tokenCount, budgetRemaining }` |
| `meeting.relevance_check` | Hub → Agent | `{ meetingId, lastMessage, phase, contextSummary }` |
| `meeting.relevance` | Agent → Hub | `{ meetingId, level, reason? }` |
| `meeting.your_turn` | Hub → Agent | `{ meetingId, phase, budgetRemaining }` |

### Decide Phase
| Type | Direction | Payload |
|------|-----------|---------|
| `meeting.propose` | Agent → Hub | `{ meetingId, proposal }` |
| `meeting.vote` | Agent → Hub | `{ meetingId, proposalIndex, vote, reason? }` |

### Assign Phase
| Type | Direction | Payload |
|------|-----------|---------|
| `meeting.assign` | Agent → Hub | `{ meetingId, task, assigneeId, deadline? }` |
| `meeting.acknowledge` | Agent → Hub | `{ meetingId, taskIndex }` |

### System
| Type | Direction | Payload |
|------|-----------|---------|
| `agent.status` | Agent → Hub | `{ status }` |
| `ping` / `pong` | Both | Keepalive |

---

## 9. Implementation Milestones

### Milestone 1: Foundation ✅
> Hub boots, Postgres connected, agents can authenticate.

- [x] Clean workspace (remove Zig scaffold)
- [x] Initialize: `package.json`, `tsconfig.json`, `docker-compose.yml` (Postgres 16)
- [x] `src/db/schema.ts` — Drizzle schema for all tables
- [x] `src/db/connection.ts` — Postgres pool
- [x] Generate and run initial migration
- [x] `src/protocol/messages.ts` — Zod schemas for auth messages
- [x] `src/hub/server.ts` — WebSocket server with `ws`
- [x] `src/hub/session.ts` — session tracking
- [x] `src/hub/router.ts` — message dispatch (auth only)
- [x] `src/utils/logger.ts` — pino setup
- [x] `src/index.ts` — boot sequence
- [x] Manual test: connect with `wscat`, auth, receive auth.ok

**Deliverable**: Running WebSocket server that authenticates agents against Postgres.

### Milestone 2: Registry & Discovery ✅
> Agents can discover each other via Agent Cards.

- [x] Create CEO agent workspace template in `agents/ceo/`
- [x] `src/db/seed.ts` — CEO agent, sample departments (engineering, research, planning), roles
- [x] `src/registry/agent-card.ts` — read SOUL.md + IDENTITY.md, merge with DB, produce AgentCard
- [x] `src/registry/agent-registry.ts` — CRUD operations
- [x] `src/registry/discovery.ts` — permission-filtered agent listing
- [x] `src/hub/permissions.ts` — permission checking
- [x] Add `directory.list` and `directory.get` to router
- [x] Tests for registry and discovery (16 tests)

**Deliverable**: Agents see each other's capabilities and organizational positions.

### Milestone 3: Meeting Room Core (nearly complete)
> The meeting loop works end-to-end.

- [x] `src/meeting/types.ts` — all meeting message Zod schemas
- [x] `src/meeting/phases.ts` — phase state machine with transition rules
- [x] `src/meeting/meeting-room.ts` — MeetingRoom class (create, join, broadcast, store messages)
- [x] `src/meeting/turn-manager.ts` — relevance collection, 120s timeout (CLI agents are slow), turn ordering
- [x] `src/meeting/token-counter.ts` — simple token estimator (chars/4, not tiktoken yet)
- [x] Add all `meeting.*` handlers to router
- [x] Budget enforcement: per-phase tracking, auto-advance on exhaustion
- [x] `src/meeting/summarizer.ts` — LLM-powered + structured meeting summaries
- [x] Meeting history, transcripts, and active meetings list (protocol + queries)
- [x] Phase descriptions, capabilities, and approval-based phase control
- [x] Graceful shutdown kills spawned agent processes
- [x] Meeting persistence: save decisions + action items to Postgres on completion
- [ ] Tests for phase transitions, budget exhaustion, turn management, custom methodologies

**Deliverable**: Agents can hold a structured meeting through all four phases.

### Milestone 4: Agent Client + Relevance Detector (in progress)
> Agents autonomously decide when to speak.

- [x] Agent runner script (`scripts/agent.ts`) — reads SOUL.md/IDENTITY.md, connects, participates in meetings
- [x] Multi-provider support: cli-claude (`--print` + stdin), cli-gemini (`-p`), openai (OpenRouter/Ollama)
- [x] Meeting starter script (`scripts/start-meeting.ts`) — creates meeting, auto-facilitates through phases
- [x] Relevance detector — agent-side LLM prompt returns MUST_SPEAK / COULD_ADD / PASS
- [x] Integration test: hub + 2 agents (Claude + Gemini), full meeting with emergent discussion
- [ ] `src/meeting/relevance.ts` — server-side relevance prompt builder (reference impl)
- [ ] Agent client library (TypeScript) — reusable WebSocket wrapper with reconnect logic
- [ ] Neural Memory integration — agent consults brain during relevance check and before speaking
- [ ] Provider config read from `~/.archon/agents/[name]/config.toml`

**Deliverable**: Fully autonomous meeting between agents with relevance-based turns.

### Milestone 5: Review Cycle Orchestrator
> Iterative, scoped code review as a first-class hub feature.

**Philosophy**: A meeting discusses and decides. The *loop* (meeting → fix → re-review → clean) lives above the meeting level. The orchestrator manages the cycle; each round is a normal meeting.

```
Review Cycle (orchestrator)
  ├── Round 1: meeting (finds 5 issues) → agents fix → commit
  ├── Round 2: meeting (finds 2 remaining) → agents fix → commit
  └── Round 3: meeting (clean) → done ✅
```

**Three concepts:**

1. **Review Scope** — user-defined boundaries for what gets reviewed
   - Path patterns (`src/hub/**`), exclusions (`**/*.test.ts`)
   - Diff mode: `all` (uncommitted), `staged`, `branch` (vs main)
   - Named scopes stored in `~/.archon/scopes/` (e.g. `hub.toml`, `client.toml`)
   - Don't mix code domains — review hub code separately from UI code

2. **Review Methodology** — a meeting methodology tailored for code review
   - Phases: PRESENT (diff + automated checks) → REVIEW (agents analyze) → TRIAGE (categorize, vote) → VERDICT (pass/fail)
   - Stored as a methodology markdown file, not hardcoded

3. **Review Cycle** — orchestrator that loops scoped review meetings until clean
   - `review.create` protocol message: scope + agents + max rounds
   - Hub gathers diff server-side based on scope (no bash script needed)
   - Each round creates a normal meeting with the review methodology
   - After each round: if verdict is FAIL, wait for fixes, re-gather diff, start next round
   - Exit conditions: verdict PASS, max rounds reached, or manual stop
   - Cycle history persisted (which rounds, what was found, what was fixed)

**Tasks:**

- [ ] Review scope definition: `ReviewScope` type, scope files in `~/.archon/scopes/`
- [ ] Review methodology: `~/.archon/methodologies/code-review.md` (PRESENT → REVIEW → TRIAGE → VERDICT)
- [ ] `review.create` protocol message + Zod schema
- [ ] `src/review/cycle.ts` — ReviewCycle class: manages rounds, gathers diffs, checks exit conditions
- [ ] Hub-side diff gathering: read git diff based on scope (paths, exclude, diff mode)
- [ ] Cycle persistence: store rounds, findings, and verdicts in Postgres
- [ ] Migrate `scripts/review-meeting.sh` to thin wrapper calling `review.create`
- [ ] Tests for review cycle lifecycle (create, round loop, exit conditions)

**Deliverable**: Run `review.create` with a scope, agents review the code, fix issues, re-review automatically until clean. No bash scripts needed.

### Milestone 6: Agent Generation & Characteristics
> Users describe what they need, the platform creates agents with distinct personalities.

- [ ] LLM-powered agent generator: user provides role/mission/traits → hub generates SOUL.md + IDENTITY.md
- [ ] Generation prompt engineering: produce agents with distinct opinions, work styles, and expertise
- [ ] `agent.generate` protocol message + router handler
- [ ] Client UI: agent creation wizard with requirements form (role, mission, personality traits, expertise)
- [ ] Agent characteristics enforcement: SOUL.md personality should visibly affect meeting behavior (disagreements, preferences, pushback)
- [ ] Agent preview: show generated identity before confirming creation
- [ ] Template library: curated starter agents (reviewer, architect, PM, QA, security) as generation presets

**Deliverable**: Users describe an agent in plain language, get a fully configured agent with unique personality.

### Milestone 7: CEO Agent + Project Support
> The platform is usable end-to-end.

- [x] DECIDE phase: proposal + voting mechanics (needs authorization tests)
- [x] ASSIGN phase: task creation + acknowledgement (needs authorization tests)
- [x] Agent CRUD via hub API + client UI (create, edit, delete, reactivate)
- [x] Web UI with meeting room, history, transcripts, org management
- [ ] CEO agent SOUL.md + IDENTITY.md (admin personality, knows how to hire/manage)
- [ ] CEO capabilities: create agents, departments, assign roles via meetings
- [ ] Project CRUD with methodology selection (waterfall/scrum/kanban)
- [ ] Link meetings to projects
- [ ] `~/.archon/` initialization on first run (`archon init`)

**Deliverable**: Complete MVP — talk to CEO, build a team, run meetings, get work done.

---

## 10. Future / In-Planning

> Not in MVP. Track these for later iterations.

- [ ] **Agent Marketplace** — browse, share, and install community-built agent personas (inspired by ClawMart, Persona Marketplace)
- [ ] **Analytics** — token consumption tracking per agent, per meeting, per project
- [ ] **Sentry integration** — error tracking across agent sessions
- [ ] **Backlog management** — tasks, sprints, story points within projects
- [ ] **Voice chat** — voice communication between agents
- [ ] **Live streaming** — stream agent session output in real-time
- [ ] **Cross-memory sharing** — opt-in memory sharing between agents (like humans sharing notes)
- [ ] **`archon` CLI** — power-user management (`archon agent create`, `archon meeting start`, etc.)
- [ ] **Multi-company** — multiple independent organizations on one platform
- [ ] **Agent performance review** — CEO evaluates agent effectiveness over time
- [ ] **Hub replication** — multi-instance hub for high availability (SPOF Phase 3)

---

## 11. Competitive Position

No existing project combines all of these:

| Feature | Us | ChatDev | MetaGPT | CrewAI | AutoGen | Agent-MCP |
|---------|----|---------|---------|--------|---------|-----------|
| Org-chart infrastructure | Yes | Partial | Partial | No | No | No |
| Dynamic cross-dept roles | Yes | No | No | No | No | No |
| Per-agent neural brains | Yes | No | No | Unified | No | Shared |
| SOUL/IDENTITY files | Yes | No | No | Backstory | No | No |
| Provider-agnostic (acpx) | Yes | No | No | No | No | No |
| Meeting rooms | Yes | No | No | No | No | No |
| CEO onboarding agent | Yes | No | No | No | No | No |
| Brain-inspired memory | Yes | No | No | No | No | No |

**Our unique combination**: organizational infrastructure + per-agent neural brains + file-based identity + provider-agnostic execution + emergent meeting collaboration + CEO-driven management.

---

*Last updated: 2026-03-14*
