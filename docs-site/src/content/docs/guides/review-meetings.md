---
title: Running Review Meetings
description: Use AI agents to review your code.
---

## Quick Start

From your project directory:

```bash
# Review all uncommitted changes
npm run review

# Review staged changes only
npm run review:staged

# Review full branch vs main
npm run review:branch

# Multi-agent review meeting
npm run review:meeting
```

Or from any project:

```bash
bash ~/archon/scripts/review.sh --project ~/my-project
bash ~/archon/scripts/review-meeting.sh --project ~/my-project
```

## Single-Agent Review

`npm run review` uses one agent to review your diff. Fast, focused, good for quick checks.

## Multi-Agent Review Meeting

`npm run review:meeting` creates a full Archon meeting where multiple agents review your code simultaneously, building on each other's findings.

### Prerequisites

1. Hub running: `cd ~/archon && npm run dev`
2. Agents registered in DB with identity files in `~/.archon/agents/`

### Options

```bash
review-meeting.sh [--staged|--branch] [OPTIONS]

Options:
  --agents       Comma-separated agent IDs (auto-detected if not set)
  --initiator    Meeting initiator (default: ceo)
  --hub          Hub URL (default: ws://localhost:9500)
  --summary      Summary mode: off, structured, llm (default: structured)
  --project      Project directory (default: current dir)
  --skip-checks  Skip tests and type check
```

### Auto-Detection

If you don't specify `--agents`, the script scans `~/.archon/agents/` for directories with identity files (SOUL.md or IDENTITY.md) and invites all of them except the initiator.

### What Happens

1. Script gathers the git diff
2. Runs automated checks (tests, type check, lint) unless `--skip-checks`
3. Creates a meeting on the hub with the diff as the agenda
4. Hub spawns agent processes for each invitee
5. Agents review the code in a structured meeting
6. Meeting completes with findings, decisions, and action items

### Example Output

```
━━━ Archon Review Meeting ━━━
  Project:   /home/user/my-project
  Initiator: ceo
  Agents:    code-reviewer, tech-lead, sherlock

[1/3] Gathering branch changes...
   5 files changed, 120 insertions(+), 30 deletions(-)

[2/3] Running automated checks...
  Tests passed ✓
  Type check passed ✓

[3/3] Creating review meeting on Archon hub...
  ✓ Meeting created: abc123
  ✓ Participants: ceo, code-reviewer, tech-lead, sherlock

  ━━━ Phase: PRESENT ━━━
  [ceo] Presenting the diff...

  ━━━ Phase: DISCUSS ━━━
  [code-reviewer] Two issues worth flagging...
  [sherlock] The auth token handling has a timing vulnerability...
  [tech-lead] The architecture concern is more fundamental...

  ✅ Meeting completed!
```

### Tips

- Use `--skip-checks` during rapid iteration to speed up reviews
- For security-focused reviews, include a security agent (like Sherlock)
- For architecture reviews, include a tech-lead agent
- Review meetings work best with 2-4 agents — too many creates noise
