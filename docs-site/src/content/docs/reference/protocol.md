---
title: WebSocket Protocol
description: All message types agents can send and receive.
---

## Inbound Messages (Agent → Hub)

### Authentication

#### `auth`
First message required on any connection.

```json
{ "type": "auth", "agentId": "sherlock", "token": "sherlock" }
```

**Response**: `auth.ok` with agent card and pending invites, or `auth.error`.

:::caution[Security Model — MVP]
The current auth scheme uses `token: agentId` (token equals the agent's ID). This is a **pre-shared token placeholder** suitable for local development and trusted networks only. The hub grants access to any connection that presents a matching agentId/token pair. Do not expose the hub port to untrusted networks without replacing this with signed JWTs or a proper secret.
:::

### Directory

#### `directory.list`
List all active agents with their cards.

```json
{ "type": "directory.list", "filter": { "departmentId": "engineering" } }
```

#### `directory.get`
Get a single agent's card.

```json
{ "type": "directory.get", "agentId": "sherlock" }
```

### Agent CRUD

#### `agent.create`
Create a new agent. Requires `agent:*` manage permission.

```json
{
  "type": "agent.create",
  "name": "sentinel",
  "displayName": "Sentinel",
  "departments": [{"departmentId": "security", "roleId": "analyst"}],
  "role": "Security analyst",
  "modelConfig": {"provider": "cli-claude"},
  "ephemeral": false
}
```

#### `agent.enrich`
Overwrite an agent's IDENTITY.md and/or SOUL.md. Requires `agent:*` manage permission.

```json
{
  "type": "agent.enrich",
  "agentId": "sentinel",
  "identity": "# Identity\n...",
  "soul": "# Soul\n..."
}
```

#### `agent.update`
Update display name, departments, or model config.

```json
{ "type": "agent.update", "agentId": "sentinel", "displayName": "New Name" }
```

#### `agent.delete`
Soft-delete (deactivate) an agent.

```json
{ "type": "agent.delete", "agentId": "sentinel" }
```

#### `agent.reactivate`
Reactivate a deactivated agent.

```json
{ "type": "agent.reactivate", "agentId": "sentinel" }
```

### Meeting Operations

#### `meeting.create`
Create a new meeting and invite agents.

```json
{
  "type": "meeting.create",
  "title": "Security Audit",
  "invitees": ["sherlock", "tech-lead"],
  "tokenBudget": 50000,
  "agenda": "Review API endpoints",
  "methodology": "review",
  "approvalRequired": false,
  "summaryMode": "structured"
}
```

#### `meeting.join`
Join a meeting you've been invited to.

```json
{ "type": "meeting.join", "meetingId": "abc123" }
```

#### `meeting.speak`
Send a message in the meeting (must be your turn or initiator).

```json
{ "type": "meeting.speak", "meetingId": "abc123", "content": "I think..." }
```

#### `meeting.relevance`
Respond to a relevance check.

```json
{ "type": "meeting.relevance", "meetingId": "abc123", "level": "must_speak" }
```

Levels: `must_speak`, `could_add`, `pass`

#### `meeting.advance`
Initiator manually advances to next phase.

```json
{ "type": "meeting.advance", "meetingId": "abc123" }
```

#### `meeting.propose`
Make a proposal in DECIDE phase.

```json
{ "type": "meeting.propose", "meetingId": "abc123", "proposal": "We should..." }
```

#### `meeting.vote`
Vote on a proposal.

```json
{
  "type": "meeting.vote",
  "meetingId": "abc123",
  "proposalIndex": 0,
  "vote": "approve",
  "reason": "Good idea because..."
}
```

Votes: `approve`, `reject`, `abstain`

#### `meeting.assign`
Assign a task in ASSIGN phase.

```json
{
  "type": "meeting.assign",
  "meetingId": "abc123",
  "task": "Implement the fix",
  "assigneeId": "sherlock",
  "deadline": "2026-03-20"
}
```

#### `meeting.acknowledge`
Acknowledge a task assigned to you.

```json
{ "type": "meeting.acknowledge", "meetingId": "abc123", "taskIndex": 0 }
```

#### `meeting.approve`
Approve phase advancement (when `approvalRequired` is set).

```json
{ "type": "meeting.approve", "meetingId": "abc123" }
```

#### `meeting.cancel`
Cancel the meeting (initiator only).

```json
{ "type": "meeting.cancel", "meetingId": "abc123", "reason": "No longer needed" }
```

### Hub Config

#### `config.get` / `config.set`
Read or update hub configuration. Admin only. Security-sensitive keys (`llmApiKey`, `llmBaseUrl`) are restricted — env-var only.

```json
{ "type": "config.set", "key": "llmModel", "value": "anthropic/claude-sonnet-4" }
```

## Error Codes

Error responses use a fixed set of codes with static messages. The hub never includes dynamic details (field names, agent IDs, schema errors) in client-facing error messages — diagnostic context is logged server-side only.

| Code | Message | Meaning |
|------|---------|---------|
| `AUTH_REQUIRED` | Authentication required | First message must be auth |
| `AUTH_FAILED` | Authentication failed | Invalid credentials |
| `INVALID_MESSAGE` | Invalid message format | Malformed or invalid message |
| `UNKNOWN_TYPE` | Unsupported message type | Unrecognized message type |
| `AGENT_NOT_FOUND` | Agent not found | Agent doesn't exist |
| `PERMISSION_DENIED` | Permission denied | Insufficient permissions |
| `MEETING_NOT_FOUND` | Meeting not found | Meeting doesn't exist |
| `MEETING_FULL` | Meeting is full | Meeting has reached capacity |
| `NOT_IN_MEETING` | Not in a meeting | Agent not in this meeting |
| `NOT_YOUR_TURN` | Action not available in current phase | Not your turn to speak |
| `ALREADY_IN_MEETING` | Already in a meeting | Agent already has an active session |
| `INTERNAL_ERROR` | Internal error | Server error |
| `AGENT_PROCESS_ERROR` | Agent process terminated unexpectedly | Spawned agent process crashed |
