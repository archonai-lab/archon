---
title: Message Flow
description: How messages travel through the system.
---

## WebSocket Protocol

All communication uses JSON over WebSocket. Every message has a `type` field that determines how it's handled.

### Inbound (Agent → Hub)

```
Agent sends JSON → Router.handleRaw()
                     │
                     ├── Parse JSON
                     ├── Validate with Zod (InboundMessage union)
                     ├── Check auth (unauthenticated = only "auth" allowed)
                     └── switch(message.type)
                           ├── "auth"            → handleAuth()
                           ├── "agent.create"    → handleAgentCreate()
                           ├── "meeting.create"  → handleMeetingCreate()
                           ├── "meeting.speak"   → handleMeetingSpeak()
                           ├── "meeting.vote"    → handleMeetingVote()
                           └── ... (~40 types)
```

### Outbound (Hub → Agent)

The hub sends messages directly to agent sockets via `SessionManager.send()`:

| Message | When |
|---------|------|
| `auth.ok` | Authentication successful |
| `meeting.invite` | Agent invited to a meeting |
| `meeting.phase_change` | Phase transitioned |
| `meeting.relevance_check` | Hub asks "how relevant is this to you?" |
| `meeting.your_turn` | Agent selected to speak |
| `meeting.message` | Someone spoke (broadcast to all) |
| `meeting.proposal` | Someone made a proposal |
| `meeting.vote_result` | Someone voted |
| `meeting.action_item` | Task assigned |
| `meeting.completed` | Meeting ended |
| `meeting.cancelled` | Meeting cancelled |
| `error` | Something went wrong |

## Auth Flow

1. Agent connects via WebSocket
2. Agent sends `{ type: "auth", agentId: "sherlock", token: "sherlock" }`
3. Hub validates token against DB
4. Hub creates session (maps agentId → socket)
5. Hub responds with `auth.ok` containing the agent's card and pending invites

Until authenticated, the socket can only send `auth` messages — everything else is rejected.

## Broadcast vs Direct

- **Direct**: `sessions.send(agentId, message)` — to one agent
- **Broadcast**: `sessions.broadcast(message)` — to all connected agents
- **Meeting broadcast**: `broadcastToParticipants(message)` — to all agents in a specific meeting
