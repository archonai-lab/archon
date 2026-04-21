# Input Contracts

This page documents the Slice 2 PR1 input-contract scaffold.

The scope is compiler and fixture compatibility. Input contracts can now be authored and compiled, but they are not yet used for protocol routing or ingress validation.

## What PR1 adds

PR1 adds an optional `[input]` section to contract TOML.

```toml
[input]
type = "object"
required = true
normative = true

[input.binding]
type = "message_type"
message_type = "task.create"

[input.fields.title]
type = "string"
required = true
normative = true
```

The compiler emits:

- `input`: a canonical object field
- `inputBinding`: the compiled binding metadata

Input-only contracts are valid compiler fixtures. They do not need an `[output]` section.

Existing output contracts are unchanged. `validateCompiledOutput()` still validates only compiled `output` schemas and returns an error when the compiled contract does not define output.

## Frozen binding rule

For this lane, task contract input binds by message type:

```toml
[input.binding]
type = "message_type"
message_type = "task.create"
```

The compiled shape is:

```ts
{
  type: "message_type",
  messageType: "task.create"
}
```

Supported message types are deliberately narrow:

- `task.create`
- `task.update`

The compiler rejects other message types, such as `task.delete`.

Keep the binding under `[input.binding]`. The compiler rejects ambiguous authoring shapes such as root `[binding]`, root `[input_binding]`, and `[input.payload]`.

## Fixture coverage

The PR1 fixtures live under `tests/contracts/fixtures/`.

| Fixture | Binding | Required normative input |
| --- | --- | --- |
| `task-create-input.toml` | `task.create` | `title` |
| `task-update-input.toml` | `task.update` | `taskId` |

`task-create-input.toml` also carries optional descriptive fields:

- `description`
- `assignedTo`
- `taskMetadata.taskType`

`task-update-input.toml` also carries optional descriptive fields:

- `status`
- `result`
- `contractResult.contractId`

Optional descriptive fields use `required = false` and `normative = false`. They are compiled as schema metadata, but they do not enforce checker meaning.

## Test coverage

`tests/contracts/compiler.test.ts` covers:

- existing output fixtures still compile without `input` or `inputBinding`
- input fixtures compile with the frozen `message_type` binding rule
- input-only contracts do not compile as output-validation contracts
- unsupported message types are rejected
- ambiguous authoring shapes are rejected as unrecognized keys
- the existing field rule still holds: a field cannot be `required = true` when `normative = false`

## Not in PR1

PR1 does not:

- bind protocol routing from compiled input contracts
- validate incoming task messages at ingress
- expand bindings beyond `message_type`
- support task message types beyond `task.create` and `task.update`
- change output contract behavior
- replace runner checker behavior

Those pieces belong to later Slice 2 work.
