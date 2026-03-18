---
title: Agent System
description: How agents are created, spawned, and participate in meetings.
---

## Agent Identity Files

Every agent has a workspace directory with markdown files that define who they are:

```
~/.archon/agents/sherlock/
├── SOUL.md        # Personality, values, communication style
├── IDENTITY.md    # Name, title, skills, strengths, weaknesses
├── PLAYBOOK.md    # Coordination workflows (optional)
└── config.toml    # Model provider settings
```

### SOUL.md

Defines the agent's personality — how they think, communicate, and what they care about:

```markdown
# Soul — Sherlock

## Personality
Brilliant and he knows it. Carries the quiet confidence
of someone who's always three steps ahead.

## Communication Style
Speaks in deductions: "The auth token is passed via query
string. Query strings are logged. Therefore, every access
log is a credential dump."

## Values
- The truth, above all
- Elegance in defense
- Intellectual honesty
```

### IDENTITY.md

Defines the agent's role and capabilities:

```markdown
# Identity

- **Name**: Sherlock
- **Title**: Security Engineer
- **Description**: Applies deductive reasoning to security...

## Strengths
- Extraordinary deductive reasoning
- Observation of minute details

## Weaknesses
- Can be insufferably arrogant
- Dismissive of "boring" security work

## Skills
- **threat-modeling**: Maps attack surfaces with precision
- **vuln-analysis**: Reads code like a crime scene
```

### PLAYBOOK.md (Optional)

Only the CEO has one currently. Defines coordination workflows — how to analyze missions, check team coverage, hire agents, and orchestrate meetings.

## Agent Lifecycle

### Creation

Agents can be created via the WebSocket protocol:

```json
{
  "type": "agent.create",
  "name": "sherlock",
  "displayName": "Sherlock",
  "departments": [{"departmentId": "engineering", "roleId": "lead_dev"}],
  "modelConfig": {"provider": "cli-claude", "model": "sonnet"}
}
```

This creates the workspace directory with template IDENTITY.md and SOUL.md files.

### Enrichment

After creation, the CEO can overwrite templates with crafted content:

```json
{
  "type": "agent.enrich",
  "agentId": "sherlock",
  "identity": "# Identity\n\n- **Name**: Sherlock...",
  "soul": "# Soul\n\n## Personality\nBrilliant and he knows it..."
}
```

### Spawning

When a meeting is created, the `AgentSpawner` automatically spawns processes for invited agents not already connected:

```
AgentSpawner.spawnForMeeting()
  → npx tsx scripts/agent.ts --id sherlock --provider cli-claude
  → Agent loads SOUL.md + IDENTITY.md → system prompt
  → Connects to hub → authenticates → joins meeting
```

Agents excluded from auto-spawn: `["ceo"]` — the CEO is always human-controlled.

### Meeting Participation

Once spawned, the agent is reactive — it responds to hub events:

| Hub Event | Agent Action |
|-----------|-------------|
| `meeting.invite` | Auto-join |
| `meeting.relevance_check` | LLM evaluates relevance → responds MUST_SPEAK/COULD_ADD/PASS |
| `meeting.your_turn` | LLM generates response → speaks |
| `meeting.proposal` | LLM evaluates → votes |
| `meeting.action_item` | Auto-acknowledges if assigned |
| `meeting.completed` | Process exits |

### Ephemeral Agents

Created with `ephemeral: true` for one-off tasks. Auto-deleted (DB + workspace) when their meeting ends.

## Agent Card

Each agent has a generated **Agent Card** (JSON) cached in the DB. Contains parsed identity data for quick lookups without reading files:

```json
{
  "id": "sherlock",
  "displayName": "Sherlock",
  "description": "Security Engineer...",
  "skills": ["threat-modeling", "vuln-analysis"],
  "characteristics": { "personality": "...", "communication": "..." },
  "departments": ["engineering"],
  "status": "active"
}
```

Cards are regenerated when identity files are updated via `agent.enrich`.
