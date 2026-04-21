# Minimal Structured Completion Slice

Status: draft plan artifact

Decision: the current framing is slightly too broad if it implies a general structured-completion platform redesign. The smallest useful proof is narrower: one task family, one compiled contract, one hub-delivered completion surface, one runner submission path, and one explicit checker gate beyond schema validation.

Verdict: the existing plan direction was mostly correct, but it was not yet precise enough about the concrete runtime attachment point, the exact prompt payload the runner consumes, and the one-way derivation rule from filled structure -> artifact plus `contractResult`. Those mechanics are now specified for `plan_artifact_v1` only.

## Scope

This plan covers the first narrow proof for contract-driven structured task completion in Archon.

Chosen first slice: `plan_artifact`.

Why this slice:

1. `codebase_review_task`
Advantage: existing contract already exists.
Disadvantage: review-specific semantics add noise around diff scope, findings shape, and repo inspection.
Fails when: a structured-completion bug is indistinguishable from review workflow noise.
Cost: medium.

2. `code_fixing`
Advantage: changed files and verification evidence are concrete.
Disadvantage: code edits and test execution bury the completion-surface question under implementation variance.
Fails when: completion-shape debugging turns into execution-task debugging.
Cost: medium-high.

3. `plan_artifact`
Advantage: smallest artifact-bearing task with low domain complexity and no diff-analysis burden.
Disadvantage: proves less about execution-heavy tasks.
Fails when: we expect it to validate implementation-task semantics too early.
Cost: low.

Decision: start with `plan_artifact` because it proves the workflow with the least semantic noise.

Minimal contract family for the slice:

- task family: `plan_artifact`
- contract: `plan_artifact_v1`
- required output fields:
  - `scope: string`
  - `steps: string[]`
  - `risks: string[]`
  - `verification: string[]`

Free-form narrative still exists, but only inside these structured fields. There is no separate checker-relevant prose blob. The human-readable report is a deterministic hub-side projection from the structured fields into Markdown sections named `Scope`, `Steps`, `Risks`, and `Verification`.

Field semantics must not rely on names alone in this slice. Every field exposed in the runtime completion surface requires a `description` so the runner can tell the agent what the field means, not just what type it has.

Responsibility split for the slice:

- hub
  - stores task metadata and repo scope
  - resolves the compiled contract by `contractId`
  - exposes a normalized completion surface in task reads
  - validates `contractResult` on completion
  - renders the human-readable artifact/report from validated structured fields
  - enforces repo-root artifact existence for this task family
- runner
  - reads the completion surface from the hub
  - fills only structured fields
  - submits `contractResult`
- checker
  - treats compiled schema as normative truth
  - enforces required fields and array non-emptiness where declared
  - enforces one explicit semantic gate: `artifact_path` must resolve inside repo scope and exist on disk when the task is marked `done`

Normalized runtime surface for `plan_artifact_v1`:

The current plan is not sufficient on its own because Step 2 leaves an unresolved branch: "compiled output schema or a hub-normalized projection of it." For this slice, that ambiguity is the bug. The runner needs one stable payload, not a choice.

Chosen runtime shape:

```json
{
  "completionSurface": {
    "kind": "structured_completion_v1",
    "taskFamily": "plan_artifact",
    "contractId": "plan_artifact_v1",
    "repoRoot": "/absolute/repo/root",
    "artifactPolicy": {
      "pathField": "_derived",
      "mustBeUnderRepoRoot": true,
      "mustExistOnDone": true
    },
    "fields": {
      "scope": {
        "type": "string",
        "required": true,
        "normative": true,
        "description": "What the artifact covers and what is intentionally excluded."
      },
      "steps": {
        "type": "array",
        "required": true,
        "normative": true,
        "allowEmpty": false,
        "description": "Ordered plan steps needed to complete the requested work.",
        "items": { "type": "string" }
      },
      "risks": {
        "type": "array",
        "required": true,
        "normative": true,
        "allowEmpty": true,
        "description": "Known risks or follow-up concerns that remain after the plan is written.",
        "items": { "type": "string" }
      },
      "verification": {
        "type": "array",
        "required": true,
        "normative": true,
        "allowEmpty": false,
        "description": "Concrete checks or evidence used to justify the plan.",
        "items": { "type": "string" }
      }
    },
    "artifactFormat": "markdown"
  }
}
```

Normalization rules:

- This surface is derived from the compiled contract plus task metadata. Raw TOML never crosses the runtime boundary.
- `fields` contains only the output fields the agent must fill. It does not expose compiler-only internals, prose guidance blobs, or authoring syntax.
- Every field descriptor requires `description` so the runner can explain field meaning directly from the completion surface instead of relying on hand-maintained prompt lore.
- `repoRoot` comes from `task.repoScope.targetRepo`. If repo scope is absent, the hub can still expose the surface, but the artifact gate must fail closed when the task is marked `done`.
- `artifactPolicy` is explicit because artifact location is hub-owned in this slice; the agent never authors the destination path.
- `artifactFormat` is the only rendering hint needed in this slice. Section names are fixed by task family and rendered by the hub from the structured fields.

Where the surface travels:

1. Contract authoring stays in TOML.
2. Hub loads and compiles `plan_artifact_v1`.
3. On `task.get` and `task.list`, if the task requests `completionContract.contractId = "plan_artifact_v1"`, the hub attaches `completionSurface` as a sibling on the task payload rather than burying it inside raw metadata or compiler output.
4. Runner reads `task.completionSurface` from the hub response and treats it as the only completion-shape input.
5. Runner injects the field list and artifact rules into the agent prompt.
6. Agent returns one filled structure matching the `fields` shape.
7. Runner turns that filled structure into `contractResult` only.
8. Runner sends `task.update` with `status = "done"` and the derived `contractResult`.
9. Hub validates `contractResult.output` against the compiled contract, then runs the artifact-path semantic gate.
10. On success, hub renders the human-readable artifact/report from the validated structured fields.

Minimal task payload delta for this slice:

```json
{
  "id": "task_123",
  "title": "Clarify structured completion surface mechanics",
  "description": "Planning only.",
  "status": "in_progress",
  "taskType": "plan",
  "completionContract": {
    "contractId": "plan_artifact_v1"
  },
  "repoScope": {
    "targetRepo": "/absolute/repo/root"
  },
  "completionSurface": {
    "kind": "structured_completion_v1",
    "taskFamily": "plan_artifact",
    "contractId": "plan_artifact_v1",
    "repoRoot": "/absolute/repo/root",
    "artifactPolicy": {
      "pathField": "_derived",
      "mustBeUnderRepoRoot": true,
      "mustExistOnDone": true
    },
    "fields": {
      "scope": {
        "type": "string",
        "required": true,
        "normative": true,
        "description": "What the artifact covers and what is intentionally excluded."
      },
      "steps": {
        "type": "array",
        "required": true,
        "normative": true,
        "allowEmpty": false,
        "description": "Ordered plan steps needed to complete the requested work.",
        "items": { "type": "string" }
      },
      "risks": {
        "type": "array",
        "required": true,
        "normative": true,
        "allowEmpty": true,
        "description": "Known risks or follow-up concerns that remain after the plan is written.",
        "items": { "type": "string" }
      },
      "verification": {
        "type": "array",
        "required": true,
        "normative": true,
        "allowEmpty": false,
        "description": "Concrete checks or evidence used to justify the plan.",
        "items": { "type": "string" }
      }
    },
    "artifactFormat": "markdown"
  }
}
```

The runner does not need raw TOML, compiled-schema internals, or task-metadata hint synthesis once this payload exists. That is the point of the normalization boundary.

What the runner injects into the prompt:

The runner should inject a narrow block, not the whole task metadata blob. Smallest acceptable shape:

```text
Structured completion required.
Contract ID: plan_artifact_v1
Repo root: /absolute/repo/root
Fill exactly these fields:
- scope: string. Required. Meaning: what the artifact covers and what is intentionally excluded.
- steps: string[]. Required. At least 1 item. Meaning: ordered plan steps needed to complete the requested work.
- risks: string[]. Required. Empty allowed. Meaning: known risks or follow-up concerns that remain after the plan is written.
- verification: string[]. Required. At least 1 item. Meaning: concrete checks or evidence used to justify the plan.
Derived artifact:
- Hub derives the artifact path from task identity and contract family, then writes markdown with sections: Scope, Steps, Risks, Verification.
- Section content is projected from the validated structured fields, not authored separately.
Return one filled structured object only.
```

This is intentionally not generic contract-driven prompt generation. It is one hard-bounded projection for one contract family.

Prompt injection rule:

- The runner copies this block from `task.completionSurface`, not from hand-maintained prompt text or parallel metadata hints.
- If `completionSurface` is present for `plan_artifact_v1`, the runner should prefer it over legacy hints such as `requiredSections` so one runtime surface stays authoritative.
- If `completionSurface` is absent, the runner should fail this structured path explicitly rather than reconstructing the shape heuristically.

Runner-side conversion rules:

Agent-filled structure:

```json
{
  "scope": "Clarifies the minimal runtime surface for plan task completion.",
  "steps": [
    "Define the normalized completion surface attached to plan tasks.",
    "Inject that surface into the runner prompt.",
    "Submit one filled structured result and let the hub render the final artifact."
  ],
  "risks": [
    "If repo scope is missing, artifact validation must fail explicitly."
  ],
  "verification": [
    "Checked the existing task metadata, task update, and contract validation path."
  ]
}
```

Runner-derived `contractResult`:

```json
{
  "contractId": "plan_artifact_v1",
  "output": {
    "scope": "Clarifies the minimal runtime surface for plan task completion.",
    "steps": [
      "Define the normalized completion surface attached to plan tasks.",
      "Inject that surface into the runner prompt.",
    "Submit one filled structured result and let the hub render the final artifact."
    ],
    "risks": [
      "If repo scope is missing, artifact validation must fail explicitly."
    ],
    "verification": [
      "Checked the existing task metadata, task update, and contract validation path."
    ]
  }
}
```

Hub-derived artifact:

```md
# Scope

Clarifies the minimal runtime surface for plan task completion.

# Steps

1. Define the normalized completion surface attached to plan tasks.
2. Inject that surface into the runner prompt.
3. Derive artifact markdown and contractResult from the same filled structure.

# Risks

- If repo scope is missing, artifact validation must fail explicitly.

# Verification

- Checked the existing task metadata, task update, and contract validation path.
```

Deterministic projection rules:

- `contractResult.output` is a direct copy of the filled structure with no added prose fields.
- The artifact is derived from validated structured fields, never the other way around.
- `result`, if still stored for compatibility, is hub-derived from the same rendered markdown artifact and is not independently authored by the agent.
- The runner must not let the agent submit a free-form markdown report plus a separate structured object for this slice. One structure in, hub-rendered outputs out.
- There is no second derivation path from prompt prose, heading parsing, or task metadata hints. The filled object is the only authored payload.

Deferred on purpose:

- generic UI rendering for arbitrary contracts
- migration of all existing task families
- prompt-generation logic from contracts
- semantic scoring of plan quality
- multi-artifact tasks
- human approval workflow changes
- checker heuristics that parse prose or headings

## Steps

1. Add a default contract fixture for `plan_artifact_v1`.
Keep it flat. One artifact path. Four report sections. Arrays only where order matters. No nested guidance objects beyond what the checker needs.

2. Expose a normalized completion surface from the hub.
When a task has `completionContract.contractId = "plan_artifact_v1"`, `task.get` and `task.list` should return the exact `completionSurface` payload defined above. Raw TOML is authoring input, not runtime law.

Field descriptions are mandatory in that runtime surface; without them, agents only see names and types, which is not enough to fill fields reliably.

3. Keep `contractResult` as the only checker-facing agent submission.
The runner fills structured fields once and submits them once. If `result` remains for compatibility, it should be hub-derived from the same structured data rather than authored independently.

4. Render the artifact as a deterministic hub-side projection.
The hub writes a Markdown file with exactly four sections: `Scope`, `Steps`, `Risks`, and `Verification`. Those sections come directly from the validated structured fields so the artifact is not a second source of truth.

5. Add one semantic checker gate only.
When the task family is `plan_artifact` and artifact gating is enabled, completion should fail unless the hub-derived artifact path resolves under the declared repo root and the rendered artifact exists. Do not validate plan quality in this slice.

6. Add focused tests for the narrow workflow.
Required coverage:
- contract fixture compiles
- task read exposes the completion surface for a `plan_artifact` task
- valid `contractResult` plus a hub-rendered artifact can transition the task to `done`
- missing `scope` fails
- empty `steps` fails
- missing `verification` fails
- hub-derived artifact path outside repo scope fails
- artifact render/persist failure does not reach `done`

7. Prove the workflow with one smoke path.
Create one repo-scoped `plan_artifact` task, render the artifact from structured fields, submit `contractResult`, and confirm the stored task preserves explicit structured truth instead of requiring heading parsing.

## Risks

- The current task metadata already carries completion hints such as `artifactRequired`, `verificationRequired`, and `requiredSections`. If those hints are treated as hidden runtime law instead of exposing a hub-delivered completion surface, checker truth stays implicit and the slice fails its purpose.
- If the hub exposes the raw compiled contract shape instead of the normalized surface above, runners will couple to compiler internals and the slice will not actually stabilize the runtime boundary.
- If field descriptions are optional or omitted, agents are forced to infer semantics from names alone and the completion surface stops being self-explanatory.
- Keeping both `result` and `contractResult` as independently authored outputs will drift. One must be derivative or ignored for contracted tasks.
- Returning raw compiler internals over protocol can couple runners to implementation details. The hub should expose a stable runtime surface, not the compiler's full internal shape.
- Repo-root artifact truth depends on explicit repo scope. If repo scope is absent, the artifact gate must fail by explicit policy or stay disabled by explicit policy. Inference is where this goes feral.
- This slice proves structured completion for planning tasks only. If the team reads it as proof that review and code-fixing semantics are solved, the verdict will be overstated.

## Verification

This plan is grounded in the current repo surface, not a blank-sheet redesign.

- `src/tasks/task-metadata.ts` already models completion-contract metadata including `artifactRequired`, `verificationRequired`, `requiredSections`, and `semanticGateRequired`.
- `src/tasks/task-crud.ts` already validates compiled `contractResult` output when a task is moved to `done`.
- `src/hub/router.ts` already carries `contractResult` through task update handling.
- `src/protocol/messages.ts` already shows the runner-to-hub completion envelope shape: `task.update` carries `contractResult = { contractId, output }`.
- `src/contracts/types.ts` and `docs/contracts/compiled-schema.md` already establish compiled schema as runtime truth rather than raw TOML.
- `defaults/contracts/codebase_review_task.toml` and `defaults/contracts/code_fixing.toml` show the current contract style and give concrete baseline shapes.
- `tests/tasks/task-crud.test.ts` already proves valid structured output is accepted and missing contract evidence is rejected for current task contracts.

Acceptance evidence for the slice:

1. A `plan_artifact` task exposes a machine-readable completion surface before the runner writes anything.
2. Every completion-surface field includes a human-meaningful `description`.
3. The runner can fill only structured fields and complete the task without separate checker-facing prose.
4. The checker rejects malformed structured output and rejects a hub-derived artifact that is outside repo scope or missing on disk.
5. The stored task preserves explicit structured truth that downstream code can inspect without parsing headings from a report blob.
