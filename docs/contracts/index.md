# Contracts

Contracts define what an agent result must prove before Archon treats it as valid.

Tracking issue: [#68](https://github.com/archonai-lab/archon/issues/68)

## Why this exists

Some current task and review results look strict but are weak underneath.

Example:

```text
No findings: no merge blockers found.
Verdict: safe to merge with normal caution.
Verification: reviewed the branch diff and targeted tests.
```

That looks useful, but it does not prove:

- which repo was reviewed
- which files were checked
- whether tests actually ran
- whether `No findings` is structured data or just prose

Contracts exist so green means:

> The proof you asked for exists in a structure the checker understands.

Not:

> The agent wrote the right-looking headings.

Descriptions in contracts can guide humans and agents, but they are not enforcement by themselves.

## Current status

Slice 1A introduced the output-contract scaffold.

It introduces:

- a default contract fixture: `codebase_review_task`
- first-run seeding into `~/.archon/contracts`
- runtime loading from `~/.archon/contracts`
- a compiler from TOML authoring data to canonical control schema
- an inline Output Contract under `[output]`
- structured output validation for the first review result shape
- parity tests showing the old false-green review case

Slice 2 PR1 adds input-contract compiler scaffolding:

- `[input]` sections compile into the canonical schema
- `[input.binding]` binds task inputs by `message_type`
- the frozen covered message types are `task.create` and `task.update`
- fixture contracts cover those two task input families

This is compiler and fixture compatibility only. It does not yet connect input contracts to protocol routing or ingress validation.

The contract system does not yet replace the current runner checker.

## Main idea

The intended path is:

```text
TOML authoring file -> compiler -> canonical control schema -> checker
```

Raw TOML is not runtime law.

The compiled canonical control schema is the runtime truth.

## Why this is structured instead of Markdown-only

This system is solving two different problems:

1. **Checker enforcement**
2. **Agent/human guidance**

Those two problems need different representations.

### Why not use Markdown alone

Markdown is good for:

- human readability
- rich explanation
- examples
- instructional guidance for agents

But Markdown is weak for the checker because the checker needs:

- exact fields
- exact requiredness
- exact enum values
- exact machine-readable validation
- exact compatibility and parity behavior

If raw Markdown becomes the enforcement source, we end up back in the old failure mode:

- prose looks strict
- checker interprets it through heuristics
- green results overstate what was actually enforced

### Why this Slice 1A uses structured contracts

Slice 1A keeps the normative layer structured so the checker can validate exact meaning.

That is why the source contract is TOML/compiled schema rather than free-form Markdown.

### The intended long-term shape

The clean architecture is:

```text
structured contract -> checker
structured contract -> guidance / prompt / docs
```

In other words:

- the structured contract is the source of truth for enforcement
- a richer guidance layer can exist for humans and agents
- but guidance must not create enforcement by itself

### What this means today

Today:

- the structured contract is normative
- descriptions are guidance only
- docs explain the feature

Later:

- we may add a dedicated guidance layer (possibly Markdown-backed)
- that guidance can help agents and humans understand the contract
- but it should stay downstream of the structured contract, not replace it

## Read next

- [Write a first contract](./write-a-first-contract.md)
- [TOML format](./toml-format.md)
- [Compiled schema](./compiled-schema.md)
- [Input contracts](./input-contracts.md)

## Where contracts live

Default contracts ship with Archon under:

```text
defaults/contracts/
```

On first run, Archon copies missing default contracts into:

```text
~/.archon/contracts/
```

At runtime, Archon loads contracts from:

```text
~/.archon/contracts/
```

Use that directory for private team, project, and company contracts.

Duplicate contract IDs are rejected.

Default contract files are seeded once. If package defaults change later, compare them manually before copying updates into `~/.archon/contracts`.

## Current limits

This scaffold does not yet:

- replace the current task runner checker
- generate prompts from contracts
- validate incoming task messages from input contracts
- route protocol messages from input contract bindings
- bind meetings to workspaces
- expose a UI for contract authors
- migrate all review/task types

Those are future slices.
