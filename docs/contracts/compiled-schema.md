# Compiled Contract Schema

This page is for developers maintaining the contract compiler and checker.

## Runtime boundary

Raw TOML is not runtime law.

The runtime path is:

```text
TOML authoring file -> compiler -> canonical control schema -> checker
```

Only the compiled canonical control schema is normative.

Field descriptions can be preserved as guidance for humans, agents, and future prompt/UI surfaces. They do not create checker behavior unless the same requirement is represented by normative fields.

Current compiler rule:

- a field cannot be `required = true` when `normative = false`

## File map

| File | Purpose |
| --- | --- |
| `src/contracts/types.ts` | Canonical contract schema types and strict enum definitions. |
| `src/contracts/toml.ts` | Minimal TOML reader for the supported Slice 1A authoring shape. |
| `src/contracts/compiler.ts` | Compiler from authoring data/TOML to canonical schema, plus Output Contract validation. |
| `src/contracts/loader.ts` | Loads runtime contracts from `~/.archon/contracts`. |
| `defaults/contracts/codebase_review_task.toml` | Default contract seeded into `~/.archon/contracts`. |
| `tests/contracts/compiler.test.ts` | Compiler and structured-output tests. |
| `tests/contracts/loader.test.ts` | Contract loader tests. |
| `tests/contracts/parity-review-result.test.ts` | False-green parity tests for review results. |

## Compile a contract

Use `compileContractToml()`.

```ts
import { readFileSync } from "fs";
import { compileContractToml } from "../src/contracts/compiler.js";

const schema = compileContractToml(
  readFileSync("defaults/contracts/codebase_review_task.toml", "utf-8"),
);
```

## Load runtime contracts

Use `loadContracts()`.

```ts
import { loadContracts } from "../src/contracts/loader.js";

const result = loadContracts();
```

By default, it reads:

```text
~/.archon/contracts/*.toml
```

Missing user contract directory is not an error.
Duplicate IDs and invalid TOML are returned as diagnostics.

## Validate output

Use `validateCompiledOutput()`.

```ts
import { validateCompiledOutput } from "../src/contracts/compiler.js";

const result = validateCompiledOutput(schema, output);

if (!result.ok) {
  console.log(result.issues);
}
```

Validation issues include:

- `path`
- `message`

Example:

```json
{
  "path": "output.self_check",
  "message": "required field is missing"
}
```

## False-green parity case

The parity test compares legacy heading/prose validation with compiled structured validation.

Legacy accepts:

```text
No findings: no merge blockers found.
Verdict: safe to merge with normal caution.
Verification: reviewed the branch diff and targeted tests.
```

Compiled validation rejects that because it is missing machine-readable fields.

See:

- `tests/contracts/parity-review-result.test.ts`

## Add a new contract fixture

For now, keep this rare and deliberate.

Steps:

1. Add a TOML file under `~/.archon/contracts/`.
2. Use only supported `contract_type` and field `type` enum values.
3. Add compiler tests proving the fixture compiles.
4. Add validation tests for one passing output and at least one failing output.
5. Add parity tests if the contract replaces or challenges current checker behavior.

Do not add new control enum values without explicit tests.

## What not to do

Do not:

- treat raw TOML as checker law
- add dynamic `contract_type` values
- add arbitrary custom validator names
- put prompt-generation behavior in contracts
- use descriptive fields as if they were enforced
- replace the existing runner checker wholesale in this slice

## Verification

Run focused tests:

```bash
npx vitest run tests/contracts/compiler.test.ts tests/contracts/parity-review-result.test.ts
```

Run build:

```bash
npm run build
```

## Known limits

Slice 1A does not yet:

- replace the current task runner checker
- generate prompts
- bind meetings to workspaces
- migrate all existing task families
- expose UI for normative/descriptive field separation

Those are future slices.
