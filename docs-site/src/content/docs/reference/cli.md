---
title: CLI Reference
description: Archon command-line interface for agent management.
---

The Archon CLI manages agents directly from the command line, without needing the hub running.

```bash
npm run archon -- <command>
# or
npx tsx scripts/cli.ts <command>
```

## agent add

Register an agent from a workspace directory.

```bash
npm run archon -- agent add <path> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<path>` | Yes | Path to agent workspace directory (must contain IDENTITY.md or SOUL.md) |

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--provider <provider>` | `cli-claude` | LLM provider (`cli-claude`, `cli-gemini`, `openai`) |
| `--model <model>` | — | LLM model name |
| `--department <id>` | — | Department ID to assign |
| `--role <id>` | — | Role ID for department assignment (requires `--department`) |

### Behavior

1. Validates the path exists and contains IDENTITY.md or SOUL.md
2. Parses agent name from IDENTITY.md (`**Name**` field, lowercased)
3. Rejects if an agent with that ID already exists (use `agent update` instead)
4. Inserts the agent record into the database
5. Generates the agent card from identity files

### Examples

```bash
# Register with defaults
npm run archon -- agent add ~/.archon/agents/sherlock

# Register with specific provider
npm run archon -- agent add ~/.archon/agents/sable --provider cli-claude --model sonnet

# Register with department assignment
npm run archon -- agent add ~/.archon/agents/tech-lead --department engineering --role lead_dev
```

### Error cases

| Error | Cause |
|-------|-------|
| `Path not found` | Workspace directory doesn't exist |
| `No IDENTITY.md or SOUL.md found` | Directory exists but has no identity files |
| `Could not parse agent name` | IDENTITY.md missing `**Name**` field or H1 heading |
| `Agent already exists` | An agent with that ID is already registered |

## agent list

List all registered agents with their status and department assignments.

```bash
npm run archon -- agent list
```

### Output

```
ID                  Display Name        Status        Departments
────────────────────────────────────────────────────────────────────
sherlock            Sherlock            active        Engineering (Lead Developer)
sable               Sable               active        Engineering (Lead Developer)
ceo                 CEO                 active        Executive (Chief Executive Officer)
```

### Columns

| Column | Description |
|--------|-------------|
| ID | Agent's unique identifier |
| Display Name | Human-readable name |
| Status | `active`, `deactivated`, or `ephemeral` |
| Departments | Assigned departments and roles |
