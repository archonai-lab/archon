---
title: Quick Start
description: Get Archon running in 5 minutes.
---

## Prerequisites

- Node.js 20+
- Docker (for Postgres)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/LeviathanST/archon.git
cd archon
npm install
```

### 2. Start Postgres

```bash
docker compose up -d
```

### 3. Run migrations and seed

```bash
npm run db:migrate
npm run db:seed
```

### 4. Start the hub

```bash
npm run dev
```

The hub starts on `ws://localhost:9500`.

## Your First Meeting

Use the start-meeting script to create a meeting:

```bash
npx tsx scripts/start-meeting.ts \
  --initiator ceo \
  --agents code-reviewer,tech-lead \
  --title "Quick Test Meeting" \
  --agenda "Testing the platform"
```

The hub will auto-spawn agent processes for each invitee. You'll see agents join, discuss, and complete the meeting in your terminal.

## Run a Code Review

Review your uncommitted changes with AI agents:

```bash
# Review all uncommitted changes
npm run review

# Review only staged changes
npm run review:staged

# Review full branch vs main
npm run review:branch

# Multi-agent review meeting
npm run review:meeting
```

## Run Tests

```bash
npm test              # Watch mode
npx vitest run        # Single run
```
