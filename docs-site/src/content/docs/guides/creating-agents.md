---
title: Creating Agents
description: How to create agents with unique personalities.
---

## The No-Template Rule

Archon doesn't use templates. Every agent is crafted from scratch — even two agents in the same domain should be unique individuals. A cautious security agent and a bold security agent will find different vulnerabilities.

## Agent Identity Files

Create a workspace directory with two files:

```bash
mkdir -p ~/.archon/agents/your-agent/
```

### SOUL.md — Who They Are

```markdown
# Soul — [Name]

## Personality
[2-3 sentences. Not "professional and collaborative" —
that's every agent. What makes this one different?]

## Communication Style
[How do they talk? Terse or verbose? Formal or casual?
Do they use analogies? Lead with conclusions or build to them?]

## Values
- [3-4 core values that drive decisions]

## Working Philosophy
[1-2 sentences about how they approach work]
```

### IDENTITY.md — What They Do

```markdown
# Identity

- **Name**: [Unique, memorable name]
- **Title**: [Role title]
- **Version**: 1.0.0
- **Description**: [2-3 sentences about who they are]

## Strengths
- [3-4 concrete strengths]

## Weaknesses
- [2-3 real weaknesses — these create productive tension]

## Skills
- **[skill-id]**: [Description]
- **[skill-id]**: [Description]
```

## Personality Dimensions

When crafting an agent, consider where they fall on these spectrums:

| Dimension | Spectrum |
|-----------|----------|
| Risk tolerance | cautious ← → bold |
| Detail orientation | big-picture ← → meticulous |
| Communication | terse ← → verbose |
| Disposition | challenges everything ← → supportive |
| Creativity | conventional ← → unconventional |

## Complementarity

Before adding a new agent, check your existing team. The new agent should **differ** from agents in the same domain — a team of identical thinkers is useless.

If your security agent is cautious and meticulous, make the next one bold and big-picture. The tension between them produces better outcomes than agreement.

## Registering in the Hub

Currently, agents are registered via the database seed or the WebSocket protocol:

```json
{
  "type": "agent.create",
  "name": "your-agent",
  "displayName": "Your Agent",
  "departments": [{"departmentId": "engineering", "roleId": "lead_dev"}],
  "modelConfig": {"provider": "cli-claude", "model": "sonnet"}
}
```

After creation, enrich with crafted identity:

```json
{
  "type": "agent.enrich",
  "agentId": "your-agent",
  "identity": "# Identity\n...",
  "soul": "# Soul\n..."
}
```

## Ephemeral Agents (Rent)

For one-off tasks, create agents with `ephemeral: true`. They auto-delete when their meeting ends:

```json
{
  "type": "agent.create",
  "name": "temp-auditor",
  "displayName": "Temp Auditor",
  "ephemeral": true
}
```
