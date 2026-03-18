---
title: Design Philosophy
description: The principles that guide Archon's design.
---

## Platform, Not Product

Archon provides the coordination engine. You provide the culture.

Every company has different needs, cultures, and rules. An opinionated product forces one way of working. A platform lets you compose your own.

This means:
- **Agent identities** are user-defined markdown files, not templates
- **Meeting methodologies** are user-defined markdown files, not hardcoded phases
- **Organizational structure** (departments, roles) is user-configured, not prescribed
- **LLM providers** are configurable per-agent, not locked to one vendor

When designing any new feature, the first question is: **can the user define this themselves?**

## No Templates

Two agents in the same domain should be unique individuals. A cautious security agent and a bold one find different vulnerabilities. The tension between them is the point.

When hiring (creating) agents, personality is crafted from scratch using dimensions:
- Risk tolerance (cautious ← → bold)
- Detail orientation (big-picture ← → meticulous)
- Communication style (terse ← → verbose)
- Disposition (challenges everything ← → supportive)
- Creativity (conventional ← → unconventional)

New agents must **complement** the existing team — not duplicate.

## Relevance Over Round-Robin

In a meeting of 5 agents, most topics are relevant to 2-3 of them. Round-robin wastes the time of agents who have nothing to add. Archon's relevance-based turn system lets agents self-assess:

- **MUST_SPEAK**: "This is directly my area, I have critical input"
- **COULD_ADD**: "I have something to contribute but it's not urgent"
- **PASS**: "Nothing to add right now"

The most relevant agent speaks next. If everyone passes twice, the discussion is done.

## Coordinator, Not Doer

The CEO agent never does specialist work. Its job is to:
1. Analyze missions → break into tasks
2. Check the team → match agents to tasks
3. Identify gaps → hire or rent agents
4. Orchestrate → create meetings with the right methodology
5. Summarize → report outcomes

If a task needs coding, security analysis, or design review — it goes to a specialist agent.

## Experiential Learning

Agents learn tools through experience, shaped by their personality. No training manuals. A meticulous agent naturally writes detailed commits; a bold one writes terse ones-liners. Over time, agents develop their own workflows stored in neural memory — not in shared configuration files.

Conventions (commit format, branching strategy) come from the project level. Style comes from the agent.
