# ADR-003: Three-Phase Streaming Protocol for Agent Speech

**Status:** Proposed (not yet implemented)
**Date:** 2026-03-10
**Context:** Claw-Empire's `chat_stream` protocol (`direct-chat-runtime-reply.ts`)

## Decision

Agent speech in meetings should follow a three-phase streaming protocol:
1. `start` — signal that an agent is about to speak
2. `delta` — incremental text chunks as the agent generates them
3. `end` — finalize with complete content

## Rationale

- Current `meeting.speak` is fire-and-forget (full message at once)
- For built-in agent runtime, streaming LLM tokens as deltas provides better UX
- Client creates temporary state on `start`, accumulates on `delta`, promotes to permanent on `end`

## Consequences

Not yet implemented. Current `meeting.message` broadcasts contain the full message. This ADR captures the intended direction for when streaming is added.
