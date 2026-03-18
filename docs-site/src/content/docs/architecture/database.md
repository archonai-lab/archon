---
title: Database Schema
description: Postgres tables and relationships.
---

Archon uses Drizzle ORM with Postgres 16. Schema defined in `src/db/schema.ts`, migrations in `drizzle/`.

## Entity Relationship

```
departments ◄──── roles
     │               │
     └───► agent_departments ◄──── agents ◄──── permissions
                                    │
                              ┌─────┼─────┐
                              │           │
                    meeting_participants  meeting_messages
                              │           │
                              └─────┬─────┘
                                    │
                                 meetings ◄──── projects
```

## Tables

### agents

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Semantic ID (e.g., `sherlock`, `ceo`) |
| `display_name` | text | Human-readable name |
| `workspace_path` | text | Path to identity files |
| `status` | enum | `active` or `deactivated` |
| `ephemeral` | boolean | Auto-delete after meeting (default: false) |
| `agent_card` | jsonb | Cached parsed identity |
| `model_config` | jsonb | LLM provider settings |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### departments

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | e.g., `engineering`, `executive` |
| `name` | text | |
| `description` | text | |

### roles

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | e.g., `ceo`, `lead_dev` |
| `department_id` | text FK | |
| `name` | text | |
| `permissions` | jsonb | Array of permission strings |

### agent_departments

Join table. Composite PK on `(agent_id, department_id)`.

| Column | Type |
|--------|------|
| `agent_id` | text FK |
| `department_id` | text FK |
| `role_id` | text FK |

### permissions

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial PK | |
| `agent_id` | text FK | |
| `resource` | text | e.g., `agent:*`, `meeting:*` |
| `action` | text | e.g., `manage`, `admin` |

### meetings

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | nanoid |
| `project_id` | text FK | Optional |
| `title` | text | |
| `phase` | text | Current phase name |
| `methodology` | text | Methodology ID (default: `general`) |
| `status` | enum | `active`, `completed`, `cancelled` |
| `initiator_id` | text FK | Who created the meeting |
| `token_budget` | integer | Max tokens for the meeting |
| `tokens_used` | integer | Tokens consumed so far |
| `agenda` | jsonb | |
| `decisions` | jsonb | Array of approved proposals |
| `action_items` | jsonb | Array of assigned tasks |
| `summary` | text | Generated summary |

### meeting_participants

| Column | Type |
|--------|------|
| `meeting_id` | text FK |
| `agent_id` | text FK |
| `invited_at` | timestamptz |
| `joined_at` | timestamptz |

### meeting_messages

| Column | Type |
|--------|------|
| `id` | serial PK |
| `meeting_id` | text FK |
| `agent_id` | text FK |
| `phase` | text |
| `content` | text |
| `token_count` | integer |
| `relevance` | enum |

## Commands

```bash
npm run db:generate   # Generate migrations from schema
npm run db:migrate    # Apply migrations
npm run db:seed       # Seed CEO + sample data
```
