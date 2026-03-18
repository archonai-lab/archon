---
title: Writing Methodologies
description: Define custom meeting formats with markdown.
---

## What is a Methodology?

A methodology defines how a meeting runs — its phases, time allocation, and capabilities. Archon ships with a default 4-phase methodology, plus specialized ones for review, brainstorm, triage, and hiring.

You can write your own.

## File Location

Place methodology files in `~/.archon/methodologies/`:

```bash
~/.archon/methodologies/
├── review.md
├── brainstorm.md
├── triage.md
└── your-custom-one.md
```

Use them when creating meetings:

```json
{
  "type": "meeting.create",
  "methodology": "your-custom-one",
  "title": "...",
  "invitees": ["..."]
}
```

## Format

```markdown
# Meeting Name

## Phases
- PHASE_NAME [capability1, capability2]: NN% — Description

## Rules
- Rule text here
```

### Phase Line Syntax

```
- PHASE_NAME [capabilities]: BUDGET% — Description
```

- **PHASE_NAME**: Lowercase identifier (becomes the phase name in the protocol)
- **Capabilities**: Comma-separated list from the valid set
- **BUDGET**: Percentage of total token budget (all phases must sum to ~100%)
- **Description**: Human-readable purpose

### Valid Capabilities

| Capability | Meaning |
|-----------|---------|
| `initiator_only` | Only the initiator can speak |
| `open_discussion` | All participants can speak (via relevance rounds) |
| `proposals` | Participants can make proposals and vote |
| `assignments` | Participants can assign and acknowledge tasks |

## Examples

### Code Review

```markdown
# Code & Design Review

## Phases
- PRESENT [initiator_only]: 20% — Present the artifact under review
- ANALYZE [open_discussion]: 50% — Each reviewer examines their domain
- REPORT [open_discussion, proposals]: 30% — Consolidate findings and vote

## Rules
- Focus on your area of expertise
- Classify findings as: blocker, concern, suggestion, or praise
- Proposals should be actionable
```

### Brainstorm

```markdown
# Brainstorming Session

## Phases
- SEED [initiator_only]: 10% — Present the problem space
- DIVERGE [open_discussion]: 45% — Generate ideas freely, no criticism
- CONVERGE [open_discussion, proposals]: 35% — Evaluate and vote
- PLAN [initiator_only, assignments]: 10% — Assign next steps

## Rules
- During DIVERGE: no criticism, no "yes but"
- Build on others' ideas with "yes and"
- Quantity over quality in DIVERGE, filter in CONVERGE
```

## Validation

The parser enforces:
- At least one phase defined
- All capabilities are from the valid set
- Phase budgets sum to approximately 100% (within 5% tolerance)
- Each phase has a name, capabilities, budget, and description

Invalid methodologies throw `MethodologyParseError` at load time.

## Default Methodology

If no methodology is specified (or `methodology: "general"`), the built-in default is used:

| Phase | Budget | Capabilities |
|-------|--------|-------------|
| present | 20% | initiator_only |
| discuss | 50% | open_discussion |
| decide | 20% | open_discussion, proposals |
| assign | 10% | open_discussion, assignments |
