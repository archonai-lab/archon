# Archon — Agent Company Platform

## What is this?
A platform that organizes AI agents like a company. Agents have identities, roles, memories, and hold meetings where they collaborate like humans.

## Key docs
- `PLAN.md` — Full architecture, schema, protocol, milestones
- `docs/CHANGELOG.md` — Running log of what was done
- `docs/milestones/` — Detailed per-milestone task tracking

## Tech stack
- TypeScript, ws (WebSocket), drizzle-orm, postgres, zod, tiktoken, pino, vitest
- Runtime data: `~/.archon/` (not hardcoded)
- Agent memory: Neural Memory MCP (per-agent, brain-inspired)
- Agent model layer: acpx (provider-agnostic — Claude Code, Codex, Gemini, etc.)

## Conventions
- Document A2A protocol origins in comments wherever Agent Card patterns are used
- Each agent gets its own Neural Memory instance (brains are NOT shared)
- CEO is the only pre-built agent — it manages hiring, roles, and meetings
- No hardcoded paths — everything reads from `~/.archon/config.toml`

## Current status
Planning complete. Ready for Milestone 1 (Foundation).
