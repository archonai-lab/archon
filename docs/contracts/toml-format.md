# Contract TOML Format

This page documents the Slice 1A contract authoring format.

## Required `[info]`

Every contract starts with `[info]`.

```toml
[info]
id = "codebase_review_task"
version = "1.0"
contract_type = "task"
```

| Field | Meaning |
| --- | --- |
| `id` | Stable contract identifier. |
| `version` | Contract version string. |
| `contract_type` | Execution surface where the contract is valid. |

## Contract locations

Default contracts ship in the repo under:

```text
defaults/contracts/*.toml
```

On first run, Archon copies missing defaults into:

```text
~/.archon/contracts/
```

Runtime contract loading reads:

```text
~/.archon/contracts/*.toml
```

Rules:

- missing `~/.archon/contracts/` is allowed before setup
- invalid contracts are reported as diagnostics
- duplicate contract IDs are rejected
- default files are seeded once; updates require manual comparison/copy until an explicit update command exists

## Strict enums

Supported `contract_type` values:

- `task`
- `meeting`

Supported field `type` values:

- `string`
- `number`
- `boolean`
- `enum`
- `array`
- `object`

If a future feature needs a new control value, add it deliberately with tests.

Do not use free-form strings for control behavior.

## Output Contract

The current fixture defines its Output Contract inline with `[output]`:

```toml
[output]
type = "object"
required = true
normative = true
```

The `output` section compiles into the canonical output schema.

Future slices may split this into a referenced output contract, but Slice 1A keeps it inline.

## Field attributes

| Attribute | Applies to | Meaning |
| --- | --- | --- |
| `type` | all fields | Field type enum. |
| `required` | all fields | Missing value is a validation error. |
| `normative` | all fields | Field participates in checker meaning. |
| `description` | all fields | Human/agent guidance for understanding the field. It does not create validation behavior by itself. |
| `values` | enum fields | Allowed enum values. |
| `allow_empty` | array fields | Whether an array can be empty. |

## Enum field

```toml
[output.fields.verdict]
type = "enum"
required = true
normative = true
values = ["pass", "pass_with_notes", "needs_changes", "invalid_surface"]
```

## Object field

Nested object fields use nested `fields`.

```toml
[output.fields.self_check]
type = "object"
required = true
normative = true

[output.fields.self_check.fields.repo_root]
type = "string"
required = true
normative = true
```

## Array field

Array fields must define `items`.

```toml
[output.fields.diff_files]
type = "array"
required = true
normative = true
allow_empty = false

[output.fields.diff_files.items]
type = "string"
required = true
normative = true
```

## Normative vs descriptive fields

`normative = true` means the field is part of the checker contract.

`normative = false` means the field can be carried for explanation or display, but should not decide pass/fail.

Rule:

- if a field affects checker outcome, it must be compiled as normative
- if a field is not compiled as normative, do not describe it as enforced
- descriptions may guide humans and agents, but enforcement must still be represented by normative fields or checker rules
- a field cannot be both `required = true` and `normative = false`

## Invalid patterns

Do not use dynamic contract types:

```toml
contract_type = "whatever_user_wants"
```

Do not invent custom validator names:

```toml
validator = "run_shell_and_decide"
```

Do not use descriptive prose as enforcement:

```toml
description = "Must pass all security checks"
```

That sentence is not enforceable unless it compiles into normative fields.
