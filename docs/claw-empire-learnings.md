# Claw-Empire Learnings for Archon

> Analysis of production patterns from [claw-empire v2.0.3](https://github.com/GreenSheep01201/claw-empire)
> that are worth adapting for Archon's architecture.
>
> Created: 2026-03-10

---

## Overview

Claw-Empire is a mature AI agent office simulator (React + Express + SQLite).
It spawns and controls agents directly. Archon is a **coordination hub** —
agents bring their own brains, we provide the company infrastructure.

We take the **barebone production patterns**, not the product surface.

---

## 1. WebSocket Hub & Broadcasting

**Source**: `server/ws/hub.ts`

### Pattern: Batched broadcast with queue cap

```typescript
// High-frequency events are batched to reduce network overhead
const BATCH_INTERVAL = {
  cli_output: 250,      // 4 msgs/sec max
  subtask_update: 150,  // 6.67 msgs/sec max
};
const MAX_QUEUE = 60;

function broadcast(type: string, payload: unknown) {
  const interval = BATCH_INTERVAL[type];

  if (!interval) {
    sendRaw(type, payload); // immediate for low-frequency events
    return;
  }

  // First event: send immediately, then batch subsequent
  if (!batches.has(type)) {
    sendRaw(type, payload);
    const queue: unknown[] = [];
    const timer = setTimeout(() => {
      for (const p of queue) sendRaw(type, p);
      batches.delete(type);
    }, interval);
    batches.set(type, { queue, timer });
  } else {
    const batch = batches.get(type)!;
    if (batch.queue.length < MAX_QUEUE) {
      batch.queue.push(payload);
    } else {
      batch.queue.shift(); // drop oldest
      batch.queue.push(payload);
    }
  }
}
```

### Archon adaptation
- Batch `meeting.message` broadcasts during heated discussions
- Batch `agent.status` updates when many agents change state simultaneously
- Keep `meeting.phase_change` and `auth.*` unbatched (must be immediate)

### Pattern: Message format

Every WS message includes server timestamp for ordering:
```typescript
{ type: string, payload: unknown, ts: number }
```

---

## 2. Three-Phase Streaming Protocol

**Source**: `server/modules/routes/collab/direct-chat-runtime-reply.ts`

### Pattern

```typescript
// Phase 1: signal message start
broadcast("chat_stream", { phase: "start", message_id, agent_id, agent_name });

// Phase 2: incremental text deltas
broadcast("chat_stream", { phase: "delta", message_id, agent_id, text: chunk });

// Phase 3: finalize with complete content
broadcast("chat_stream", { phase: "end", message_id, agent_id, content: fullText });
```

### Archon adaptation
- Maps to `meeting.speak` — agent starts speaking, streams thought, finalizes
- Client creates temporary state on `start`, accumulates on `delta`, promotes to permanent on `end`
- For built-in agent runtime: stream LLM response tokens as deltas

---

## 3. Graceful Shutdown

**Source**: `server/modules/lifecycle/register-graceful-shutdown.ts`

### Pattern

```typescript
function gracefulShutdown(signal: string) {
  // 1. Stop accepting new connections
  // 2. Kill in-flight processes
  for (const [taskId, child] of activeProcesses) {
    killPidTree(child.pid);
  }
  // 3. Notify all WS clients
  for (const ws of wsClients) {
    ws.close(1001, "Server shutting down");
  }
  wsClients.clear();
  // 4. Drain with timeout
  wss.close(() => server.close(() => db.close()));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
```

### Archon adaptation
- Close all agent WebSocket sessions with 1001
- Persist any in-flight meeting state to Postgres before exit
- 5s drain timeout is reasonable

---

## 4. Connection Lifecycle

**Source**: `src/hooks/useWebSocket.ts`

### Pattern: Client reconnection

```typescript
ws.onclose = (event) => {
  setConnected(false);
  if (event.code === 1008) {
    forceSessionBootstrap = true; // re-auth on next connect
  }
  reconnectTimer = setTimeout(() => connect(), 2000);
};
```

### Pattern: Memory-bounded collections

```typescript
const MAX_LIVE_MESSAGES = 500;
const appendCapped = (prev, item, max) => {
  const next = [...prev, item];
  return next.length > max ? next.slice(next.length - max) : next;
};
```

### Archon adaptation
- Agent SDK should auto-reconnect with 2s interval
- Hub should re-authenticate on reconnect (verify agent still registered)
- Meeting message history capped per room (prevent memory bloat in long meetings)

---

## 5. Task State Machine

**Source**: `server/modules/bootstrap/schema/base-schema.ts`, `server/modules/routes/core/tasks/`

### Their full lifecycle

```
INBOX → PLANNED → COLLABORATING → IN_PROGRESS → REVIEW → DONE
                                       ↓
                                    failure → INBOX (retry)
                                    pause → PENDING → resume
                                    cancel → CANCELLED
```

### Key patterns

1. **Orphan recovery** — watchdog on startup + every 30s checks `in_progress` tasks:
   - Is PID still alive? → keep
   - Recent log activity? → keep
   - Log file recently modified? → keep
   - Otherwise → move to INBOX, notify CEO

2. **Cross-department delegation** — subtask with `target_department_id` creates
   a new root task in target dept. Parent enters `collaborating` until all delegated
   tasks complete. Sequential queue prevents race conditions (one dept at a time).

3. **Progress notifications** — 5-minute timer sends status updates during long tasks

4. **Execution sessions** — `Map<taskId, { sessionId, agentId, provider }>` tracks
   which agent is working on what. Cleared on completion/cancel.

### Archon adaptation (simplified)

For our ASSIGN phase output:
```
CREATED → ASSIGNED → IN_PROGRESS → REVIEW → DONE
                         ↓
                      failure → CREATED (re-assignable)
```

- Skip COLLABORATING for MVP (single-agent tasks)
- Skip PENDING/CANCELLED until we have execution control
- Orphan recovery is essential from day one
- Cross-department delegation maps to our multi-department meetings

---

## 6. Git Worktree Isolation

**Source**: `server/modules/workflow/core/worktree/`

### Creation pattern

```typescript
// Branch naming with collision fallback
const candidates = [
  `archon/${taskId.slice(0, 8)}`,
  `archon/${taskId.slice(0, 8)}-1`,
  `archon/${taskId.slice(0, 8)}-2`,
  `archon/${taskId.slice(0, 8)}-3`,
];

for (const branch of candidates) {
  // Check if branch exists
  const exists = execSync(`git show-ref --verify refs/heads/${branch}`);
  if (!exists) {
    execSync(`git worktree add ${worktreePath} -b ${branch} ${baseRef}`);
    break;
  }
}
```

### Auto-bootstrap

If project path isn't a git repo:
```bash
git init -b main
git config user.name "Archon Bot"
git config user.email "archon@local"
# Set up .git/info/exclude
git add -A
git commit -m "chore: initialize project for Archon worktrees"
```

### Restricted file detection (security)

**Blocked patterns** (regex):
```
/(^|\/)(\.env($|[./])|id_rsa|id_ed25519|known_hosts|authorized_keys|
  .*\.(pem|key|p12|pfx|crt|cer|der|kdbx|sqlite|db|log|zip|tar|gz|tgz|rar|7z))$/i
```

**Blocked directories**: `.git`, `node_modules`, `dist`, `build`, `coverage`, `logs`, `tmp`

**Allowed extensions**: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.sql`,
`.json`, `.yml`, `.yaml`, `.toml`, `.ini`, `.md`, `.html`, `.css`, `.scss`, etc.

### Verify-commit verdict system

```typescript
type Verdict =
  | "no_worktree"          // worktree doesn't exist
  | "no_commit"            // worktree exists, 0 commits
  | "dirty_without_commit" // uncommitted changes, no commits
  | "commit_but_no_code"   // only non-code files changed
  | "ok";                  // commits + real code changes
```

### Merge flow

- `--no-ff` merge to preserve history
- CEO/system approval required before merge
- Conflict detection → abort → report conflicting files
- GitHub integration: merge to `dev` branch + auto-create PR

### Archon adaptation
- Use after ASSIGN phase when agents need to execute code tasks
- Each action item gets isolated worktree
- Merge only after review/approval (CEO or meeting consensus)
- Restricted file detection is copy-paste ready

---

## 7. Agent Registry Patterns

**Source**: `server/modules/routes/core/agents/crud.ts`

### Provider validation matrix

They validate provider-specific fields on create/update:
- Switching providers auto-clears irrelevant fields (e.g., oauth_account_id when switching away from copilot)
- Provider capabilities defined as a matrix (which fields each provider supports)

### Cascading deletion

When deleting an agent, all FK references are nulled in a transaction:
```sql
UPDATE tasks SET assigned_agent_id = NULL WHERE assigned_agent_id = ?
UPDATE subtasks SET assigned_agent_id = NULL WHERE assigned_agent_id = ?
UPDATE meeting_minute_entries SET speaker_agent_id = NULL WHERE speaker_agent_id = ?
-- etc.
```

### Protected resources

Core departments (`planning`, `dev`, `design`, `qa`, `devsecops`, `operations`) cannot be deleted.
Agents with status `working` cannot be deleted.

### Archon adaptation
- Our agent registry already uses Postgres — add cascading cleanup on agent deletion
- Protect CEO agent from deletion (our only pre-built agent)
- Agent connection model is different (MCP/WebSocket, not spawned) but cleanup patterns apply

---

## 8. Hybrid Sync Strategy (Client Pattern)

**Source**: `src/app/useLiveSyncScheduler.ts`, `src/app/useRealtimeSync.ts`

### Pattern: WS events + periodic API sync

- **Real-time**: WS events update UI immediately (agent status, chat streams)
- **Batch sync**: Multiple WS events within 80ms window trigger single API refresh
- **Safety net**: Poll every 5s even without WS events
- **Dedup**: Only update React state if data actually changed

### Archon adaptation
- For future web UI / dashboard
- Agent SDK clients should use WS for real-time + periodic state reconciliation
- Prevents drift between hub state and client state

---

## Priority Implementation Order

| Phase | Pattern | Archon Milestone |
|-------|---------|-----------------|
| 1 | WS batching + message format | Milestone 1 (Foundation) |
| 2 | Graceful shutdown | Milestone 1 (Foundation) |
| 3 | Three-phase streaming | Milestone 3 (Meeting Room) |
| 4 | Connection lifecycle (reconnect, auth) | Milestone 4 (Agent Connection) |
| 5 | Task state machine (simplified) | Milestone 5 (CEO + Projects) |
| 6 | Git worktree isolation | Milestone 5 (CEO + Projects) |
| 7 | Orphan recovery watchdog | Milestone 5 (CEO + Projects) |
| 8 | Restricted file detection | Milestone 5 (CEO + Projects) |
| 9 | Cross-dept delegation | Post-MVP |
| 10 | Hybrid sync (client) | Post-MVP (Web UI) |

---

## What NOT to copy

- **Pixel-art office / rich GUI** — we want minimal UI
- **SQLite** — we're on Postgres for JSONB, concurrency, and scale
- **Direct agent spawning** — our MCP model is fundamentally better
- **Flat skill/memory model** — Neural Memory is the right approach
- **Multi-language name fields** — unnecessary complexity for MVP
- **Office pack profiles** — over-engineered for our needs
- **Sprite system** — irrelevant

---

## 9. Agent Spawning Model

**Source**: `server/modules/routes/core/agents/spawn.ts`, `server/modules/workflow/agents/`

### Three provider types, unified interface

All providers converge into `activeProcesses: Map<taskId, ChildProcess>`.
HTTP/API agents use a mock process with `kill()` → `AbortController.abort()`.

```
CLI Agents (claude, codex, gemini, opencode)
  → child_process.spawn() → stdin prompt → stdout/stderr streaming

HTTP Agents (copilot, antigravity)
  → OAuth token → HTTP/SSE request → stream parsing → mock ChildProcess

API Agents (anthropic, openai, google, ollama, openrouter, etc.)
  → API key → HTTP request → SSE stream → mock ChildProcess
```

### CLI command building per provider

```typescript
// Claude Code
["claude", "--dangerously-skip-permissions", "--print", "--verbose",
 "--output-format=stream-json", "--include-partial-messages", "--max-turns", "200"]
// + --model <model> if specified

// Codex
["codex", "--enable", "multi_agent", "--yolo", "exec", "--json"]
// + -m <model>, -c model_reasoning_effort="<level>"

// Gemini CLI
["gemini", "--yolo", "--output-format=stream-json"]
// + -m <model>

// OpenCode
["opencode", "run", "--format", "json"]
// + -m <model>
```

### Prompt injection via stdin

```typescript
child.stdin?.write(prompt)
child.stdin?.end()
```

No temp files. The CLI reads the full task prompt from stdin.

### Prompt building chain

```typescript
const prompt = buildTaskExecutionPrompt([
  availableSkillsBlock,           // installed custom skills
  `[Task Session] id=${sessionId} owner=${agentId}`,
  `[Task] ${taskData.title}`,
  taskData.description,
  workflowPackGuidance,           // pack-specific rules
  continuationCtx,                // previous work if resuming
  conversationCtx,                // recent chat history
  `Agent: ${agent.name} (${roleLabel}, ${deptName})`,
  agent.personality,
  deptConstraint,                 // role restrictions
  deptPromptBlock,                // shared department instructions
  interruptPromptBlock,           // injected mid-task instructions
  runInstruction,                 // "Complete the task above"
])
```

### Output streaming + normalization

```typescript
child.stdout.on("data", (chunk) => {
  const text = normalizeStreamChunk(chunk, { dropCliNoise: true })
  // Strip ANSI codes, spinner noise, collapse newlines
  safeWrite(text)  // write to log file
  broadcast("cli_output", { task_id: taskId, stream: "stdout", data: text })
  parseAndCreateSubtasks(taskId, text)  // detect sub-agent spawns
})
```

### Dual timeout system

```typescript
// Idle timeout: reset on each output chunk (default 30min)
const touchIdleTimer = () => {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => killProcess("idle"), IDLE_TIMEOUT_MS)
}

// Hard timeout: max total runtime (default 2hrs)
hardTimer = setTimeout(() => killProcess("hard"), HARD_TIMEOUT_MS)
```

### Process kill strategy

```typescript
// SIGTERM first, then SIGKILL after 1.2s
process.kill(-pid, "SIGTERM")  // process group kill
setTimeout(() => {
  if (isPidAlive(pid)) process.kill(-pid, "SIGKILL")
}, 1200)
```

### Subtask detection from agent output

```typescript
// Claude: {"type":"tool_use", "tool":"Task", "input":{...}}
// Codex:  {"type":"item.started", "item":{"type":"collab_tool_call", "tool":"spawn_agent"}}
// Gemini: {"subtasks":[{"title":"..."}]}
```

### Archon adaptation

We don't spawn CLIs — agents connect via MCP/WebSocket. But:

| Their pattern | Our equivalent |
|---------------|---------------|
| CLI/HTTP/API → unified `ChildProcess` | MCP/WebSocket/built-in → unified `AgentSession` |
| Prompt via stdin | Meeting context via `meeting.your_turn` message |
| Output streaming + normalization | Meeting speech streaming through hub |
| Idle/hard timeouts | 10s relevance check timeout, meeting token budget |
| Process group kill | Session cleanup on disconnect |
| Mock process for HTTP agents | Could support HTTP-based agents alongside WS/MCP |
| Subtask detection from output | Action items from ASSIGN phase |

---

## Key Source Files Reference

| Pattern | Claw-Empire File |
|---------|-----------------|
| WS Hub & Batching | `server/ws/hub.ts` |
| Graceful Shutdown | `server/modules/lifecycle/register-graceful-shutdown.ts` |
| Chat Streaming | `server/modules/routes/collab/direct-chat-runtime-reply.ts` |
| Task Schema | `server/modules/bootstrap/schema/base-schema.ts` |
| Task CRUD | `server/modules/routes/core/tasks/crud.ts` |
| Task Execution | `server/modules/routes/core/tasks/execution-run.ts` |
| Task Control | `server/modules/routes/core/tasks/execution-control.ts` |
| Review Finalize | `server/modules/workflow/orchestration/review-finalize-tools.ts` |
| Orphan Recovery | `server/modules/lifecycle.ts` |
| Worktree Lifecycle | `server/modules/workflow/core/worktree/lifecycle.ts` |
| Worktree Merge | `server/modules/workflow/core/worktree/merge.ts` |
| Restricted Files | `server/modules/workflow/core/worktree/shared.ts` |
| Verify Commit | `server/modules/routes/ops/worktrees-and-usage.ts` |
| Agent CRUD | `server/modules/routes/core/agents/crud.ts` |
| Client WS Hook | `src/hooks/useWebSocket.ts` |
| Real-Time Sync | `src/app/useRealtimeSync.ts` |
| Live Sync Scheduler | `src/app/useLiveSyncScheduler.ts` |
