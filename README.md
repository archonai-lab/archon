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
docker compose up -d postgres

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

The hub starts on `ws://localhost:9500`. On first boot, it copies default agent identities and methodologies from `defaults/` to `~/.archon/`.

### Docker (Hub + Postgres)

```bash
docker compose up -d          # Start everything
docker compose logs hub -f    # Watch hub logs
```

> **Note:** Agent processes (LLM runners) are spawned on the host machine, not inside Docker. The Docker hub handles coordination only. For meetings with auto-spawned agents, run the hub locally with `npm run dev` instead of Docker.

### Register Agents

```bash
npm run archon -- agent add ~/.archon/agents/your-agent
npm run archon -- agent list
```

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

## The Zen of Archon

> Simple over clever. If you can rip it out and the hub still works, it's not core.
>
> Platform, not product. You bring the culture. We bring the engine.
>
> No templates. Two agents in the same domain should be unique individuals.
>
> Every token must earn its place. Agents are people, not functions.
>
> Core does three things. Connect agents. Run meetings. Manage identity. Everything else is a plugin.

See the [full Zen](docs-site/src/content/docs/design/zen.md) for all 10 principles.

## Core Concepts

- **Agents** — Unique individuals with SOUL.md (personality) and IDENTITY.md (role/skills). No templates.
- **Meetings** — Phase-based (PRESENT → DISCUSS → DECIDE → ASSIGN) with token budgets and relevance-driven turns.
- **Methodologies** — User-defined markdown files that control how meetings run.
- **Platform, not product** — You define the agents, the methodologies, the org structure. Archon provides the engine.

## Project Structure

```
archon/
├── defaults/            # Default agents + methodologies (copied to ~/.archon/ on first run)
│   ├── agents/ceo/      # CEO identity files
│   └── methodologies/   # review, brainstorm, triage, hiring
├── docs-site/           # Developer documentation (Astro Starlight)
├── scripts/             # Agent runner, CLI, meeting scripts, review tools
├── src/
│   ├── hub/             # WebSocket server, router, sessions, spawner
│   ├── meeting/         # Meeting room, methodology parser, relevance
│   ├── protocol/        # Zod message schemas
│   ├── registry/        # Agent CRUD, agent cards, discovery
│   └── db/              # Drizzle schema, migrations, seed
└── tests/
```

Runtime data lives in `~/.archon/` (agent workspaces, methodologies, config). The repo contains only source code and defaults.

## License

MIT
