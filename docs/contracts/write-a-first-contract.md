# Write a First Contract

This page is for contract authors and operators.

You do not need to be a developer to understand the contract idea.

## What a contract is

A contract says what must be true before an agent result is accepted.

For a code review, that might mean:

- the agent gives a verdict
- the agent proves which repo and branch it reviewed
- the agent lists findings or explicitly returns no findings
- the agent includes verification evidence
- the agent states remaining risks

The contract is not just a prompt.

The contract should become enforceable checker logic.

## Start with the proof you need

Do not start by writing fields.

Start with the decision you want to trust.

Example:

> I want to trust a code review that says no findings.

Then ask what proof that needs:

- which repo was reviewed?
- which branch was reviewed?
- which files were in the diff?
- did the agent inspect the diff?
- did tests run?
- are findings machine-readable?

Those answers become the contract shape.

## Create the contracts directory

User contracts live in:

```text
~/.archon/contracts/
```

Create it if needed:

```bash
mkdir -p ~/.archon/contracts
```

Archon also seeds default contracts into this directory on first run.
You can copy or edit those defaults locally.
If package defaults change later, compare them manually before copying updates into your local contract directory.

Save one contract per `.toml` file:

```text
~/.archon/contracts/my_team_code_review.toml
```

## Start your TOML file

For a review task, start with:

```toml
[info]
id = "my_team_code_review"
version = "1.0"
contract_type = "task"
```

Rules:

- `id` must be unique inside `~/.archon/contracts`
- `contract_type` must be `task` or `meeting`

## Define the Output Contract

```toml
[output]
type = "object"
required = true
normative = true
```

This tells Archon the result should be a structured object.
For Slice 1A, the Output Contract is defined inline with `[output]`.

## Add required fields

Add a verdict:

```toml
[output.fields.verdict]
type = "enum"
required = true
normative = true
values = ["pass", "pass_with_notes", "needs_changes", "invalid_surface"]
```

Add a repo self-check:

```toml
[output.fields.self_check]
type = "object"
required = true
normative = true

[output.fields.self_check.fields.repo_root]
type = "string"
required = true
normative = true

[output.fields.self_check.fields.branch]
type = "string"
required = true
normative = true
```

Add findings:

```toml
[output.fields.findings]
type = "array"
required = true
normative = true
allow_empty = true
```

`allow_empty = true` means no findings is allowed, but it must be an empty array, not just prose.

Add verification:

```toml
[output.fields.verification]
type = "array"
required = true
normative = true
allow_empty = false
```

This prevents vague verification text from being accepted as proof.

## Example: codebase review

The first shipped fixture is:

- `codebase_review_task`

It expects a structured review result with:

- `verdict`
- `self_check`
- `findings`
- `verification`
- `risks`

Example result:

```json
{
  "verdict": "pass_with_notes",
  "self_check": {
    "repo_root": "/tmp/archon-contract-slice-1a",
    "branch": "feat/contract-slice-1a",
    "diff_files": ["src/contracts/compiler.ts"]
  },
  "findings": [],
  "verification": [
    {
      "kind": "repo_scope_check",
      "evidence": "reviewed only current execution repo"
    },
    {
      "kind": "diff_review",
      "evidence": "reviewed current branch diff"
    }
  ],
  "risks": []
}
```

## What green means

For Slice 1A tests, green means:

- the contract fixture compiles
- structured review output validates
- the known heading-only false-green case is rejected
- the structured no-findings case is accepted

## What green does not mean yet

Green does not mean:

- every Archon task now uses this contract system
- prompts are generated from contracts
- meetings are workspace-bound
- all checker logic has been replaced

Slice 1A is a first scaffold.

## What authors can define

Authors can define:

- purpose
- required evidence
- required output fields
- allowed verdict values
- allowed finding severity values
- whether empty findings are allowed

## What authors cannot define

Authors cannot invent runtime behavior.

Do not define:

- new execution surfaces
- arbitrary checker functions
- dynamic validator names
- shell execution rules
- prompt generation behavior
- custom contract types outside the supported enum

Control semantics are strict.

For Slice 1A:

- `contract_type` can only be `task` or `meeting`
- the first fixture is `codebase_review_task`
- a field cannot be both required and non-normative
