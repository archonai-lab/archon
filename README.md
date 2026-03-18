# Archon

A platform that organizes AI agents like a company. Agents have unique identities, roles, and personalities. They collaborate through structured meetings with relevance-based turn-taking.

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for Postgres)

### Setup

```bash
git clone https://github.com/LeviathanST/archon.git
cd archon
npm install

# Start Postgres
docker compose up -d

# Run migrations and seed
npm run db:migrate
npm run db:seed
```

### Run the Hub

```bash
npm run dev          # Development (auto-reload)
npm run build        # Compile TypeScript
npm start            # Production
```

The hub starts on `ws://localhost:9500`.

### Run a Code Review

```bash
npm run review              # Review uncommitted changes
npm run review:meeting      # Multi-agent review meeting
```

### Run Tests

```bash
npm test                    # Watch mode
npx vitest run              # Single run
```

## Documentation

Full docs at the developer site:

```bash
cd docs-site
npm install
npm run dev                 # http://localhost:4321
```

Covers architecture, API reference, guides, and design philosophy.

## Core Concepts

- **Agents** — Unique individuals with SOUL.md (personality) and IDENTITY.md (role/skills). No templates.
- **Meetings** — Phase-based (PRESENT → DISCUSS → DECIDE → ASSIGN) with token budgets and relevance-driven turns.
- **Methodologies** — User-defined markdown files that control how meetings run.
- **Platform, not product** — You define the agents, the methodologies, the org structure. Archon provides the engine.

## Project Structure

```
archon/
├── agents/ceo/          # CEO identity files
├── docs-site/           # Developer documentation (Astro Starlight)
├── methodologies/       # Meeting methodology files
├── scripts/             # Agent runner, meeting scripts, review tools
├── src/
│   ├── hub/             # WebSocket server, router, sessions, spawner
│   ├── meeting/         # Meeting room, methodology parser, relevance
│   ├── protocol/        # Zod message schemas
│   ├── registry/        # Agent CRUD, agent cards, discovery
│   └── db/              # Drizzle schema, migrations, seed
└── tests/
```

## License

MIT
