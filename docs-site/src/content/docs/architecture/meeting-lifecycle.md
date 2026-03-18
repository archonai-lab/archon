---
title: Meeting Lifecycle
description: How meetings work from creation to completion.
---

## Phase State Machine

Every meeting follows a methodology that defines its phases. The default methodology:

```
PRESENT ──→ DISCUSS ──→ DECIDE ──→ ASSIGN ──→ COMPLETED
   │            │           │          │
   │            │           │          └── all items acknowledged
   │            │           └── all proposals voted
   │            └── all agents passed 2x, or budget exhausted
   └── initiator speaks (auto-advance)
```

### Phase Details

| Phase | Budget | Capabilities | Purpose |
|-------|--------|-------------|---------|
| PRESENT | 20% | `initiator_only` | Initiator presents the topic |
| DISCUSS | 50% | `open_discussion` | Relevance-based debate |
| DECIDE | 20% | `open_discussion`, `proposals` | Propose solutions, vote |
| ASSIGN | 10% | `open_discussion`, `assignments` | Assign tasks, acknowledge |

### Phase Transitions

- **PRESENT → DISCUSS**: Initiator speaks, phase auto-advances
- **DISCUSS → DECIDE**: 2 consecutive all-pass rounds, budget exhausted, or initiator advances
- **DECIDE → ASSIGN**: All proposals voted on, or initiator advances (only if no pending votes)
- **ASSIGN → COMPLETED**: All action items acknowledged, or budget exhausted

## The Relevance Loop

This is Archon's key innovation. After every message in an open phase:

```
Agent speaks
    │
    ▼
Hub broadcasts message to all participants
    │
    ▼
Hub sends relevance_check to all (except initiator and last speaker)
  "How relevant is this discussion to you?"
    │
    ▼
Each agent responds: MUST_SPEAK / COULD_ADD / PASS
    │
    ▼
TurnManager ranks by relevance, picks the most relevant agent
    │
    ▼
Hub sends your_turn to selected agent
    │
    ▼
Agent speaks → loop back to top
```

If all agents pass once, the hub starts another round. If all agents pass **twice consecutively**, the phase auto-advances.

## Meeting Creation Flow

```
CEO sends meeting.create
    │
    ▼
Router creates MeetingRoom instance
    │
    ▼
MeetingRoom persists to DB (meetings + meeting_participants tables)
    │
    ▼
Hub sends meeting.invite to all invitees
    │
    ▼
AgentSpawner spawns processes for invitees not already connected
    │
    ▼
Agents authenticate → join meeting → PRESENT phase begins
```

## Proposals and Voting (DECIDE Phase)

1. Any joined participant can propose: `meeting.propose`
2. Hub broadcasts the proposal to all participants
3. Participants vote: `approve`, `reject`, or `abstain`
4. When all joined participants have voted on all proposals, phase auto-advances
5. Approved proposals (majority approve) become decisions

## Task Assignment (ASSIGN Phase)

1. Initiator (or any participant) assigns tasks: `meeting.assign`
2. Hub broadcasts action item to all
3. Assignee acknowledges: `meeting.acknowledge`
4. When all tasks are acknowledged, meeting completes

## Ephemeral Agents

Agents created with `ephemeral: true` are automatically hard-deleted when their meeting ends — DB records removed, workspace directory deleted. Used for one-off tasks where a persistent agent isn't needed.
