import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toTaskView } from "../../src/tasks/task-view.js";

const runtimePlanArtifactContract = `
[info]
id = "plan_artifact_v1"
version = "1.0"
contract_type = "task"

[output]
type = "object"
required = true
normative = true

[output.fields.scope]
type = "string"
required = true
normative = true
description = "Short statement of the task scope covered by the plan artifact."

[output.fields.steps]
type = "array"
required = true
normative = true
allow_empty = false
description = "Ordered implementation steps required to complete the plan."

[output.fields.steps.items]
type = "string"
required = true
normative = true
description = "One concrete implementation step in the plan."

[output.fields.risks]
type = "array"
required = true
normative = true
allow_empty = true
description = "Known risks, tradeoffs, or uncertainties that remain after planning."

[output.fields.risks.items]
type = "string"
required = true
normative = true
description = "One specific risk, tradeoff, or uncertainty."

[output.fields.verification]
type = "array"
required = true
normative = true
allow_empty = false
description = "Checks that will confirm the planned work is complete or correct."

[output.fields.verification.items]
type = "string"
required = true
normative = true
description = "One concrete verification step for the planned work."
`;

const brokenPlanArtifactContract = `
[info]
id = "plan_artifact_v1"
version = "1.0"
contract_type = "task"

[output]
type = "object"
required = true
normative = true

[output.fields.scope]
type = "string"
required = true
normative = true
`;

const nonTaskPlanArtifactContract = `
[info]
id = "plan_artifact_v1"
version = "1.0"
contract_type = "meeting"

[output]
type = "object"
required = true
normative = true

[output.fields.scope]
type = "string"
required = true
normative = true
description = "Meeting-only field."
`;

const unrelatedRuntimeContract = `
[info]
id = "private_review"
version = "1.0"
contract_type = "task"

[output]
type = "object"
required = true
normative = true

[output.fields.verdict]
type = "enum"
required = true
normative = true
description = "Review verdict."
values = ["pass", "needs_changes"]
`;

function withRuntimeContracts(files: Record<string, string>): () => void {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), "archon-home-"));
  process.env.HOME = home;
  const contractsDir = join(home, ".archon", "contracts");
  mkdirSync(contractsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(contractsDir, name), content);
  }
  return () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  };
}

function makeTaskRecord(contractId?: string) {
  return {
    id: "task-1",
    title: "Task title",
    description: "Task description",
    status: "pending",
    assignedTo: "agent-1",
    assignedBy: "ceo",
    meetingId: null,
    result: null,
    version: 1,
    changedBy: "ceo",
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    taskMetadata: contractId ? { completionContract: { contractId } } : null,
    contractResult: null,
    resultMeta: null,
  } as const;
}

describe("task view projection", () => {
  it("includes completionSurface on the task read path for plan_artifact_v1", () => {
    const restoreHome = withRuntimeContracts({
      "plan_artifact_v1.toml": runtimePlanArtifactContract,
    });
    try {
      const view = toTaskView(makeTaskRecord("plan_artifact_v1"));
      expect(view.completionSurface).toEqual({
        contractId: "plan_artifact_v1",
        fields: {
          scope: {
            type: "string",
            required: true,
            description: "Short statement of the task scope covered by the plan artifact.",
          },
          steps: {
            type: "array",
            required: true,
            description: "Ordered implementation steps required to complete the plan.",
            items: {
              type: "string",
              required: true,
              description: "One concrete implementation step in the plan.",
            },
          },
          risks: {
            type: "array",
            required: true,
            description: "Known risks, tradeoffs, or uncertainties that remain after planning.",
            items: {
              type: "string",
              required: true,
              description: "One specific risk, tradeoff, or uncertainty.",
            },
          },
          verification: {
            type: "array",
            required: true,
            description: "Checks that will confirm the planned work is complete or correct.",
            items: {
              type: "string",
              required: true,
              description: "One concrete verification step for the planned work.",
            },
          },
        },
      });
    } finally {
      restoreHome();
    }
  });

  it("keeps the built-in completionSurface when runtime contracts do not define plan_artifact_v1", () => {
    const restoreHome = withRuntimeContracts({
      "private_review.toml": unrelatedRuntimeContract,
    });
    try {
      const view = toTaskView(makeTaskRecord("plan_artifact_v1"));
      expect(view.completionSurface).not.toBeNull();
      expect(view.completionSurface?.contractId).toBe("plan_artifact_v1");
      expect(view.completionSurface?.fields.scope.type).toBe("string");
    } finally {
      restoreHome();
    }
  });

  it("does not include completionSurface for unknown contract ids", () => {
    const view = toTaskView(makeTaskRecord("unknown_contract"));
    expect(view.completionSurface).toBeNull();
  });

  it("does not include completionSurface for non-task plan_artifact_v1 contracts", () => {
    const restoreHome = withRuntimeContracts({
      "plan_artifact_v1.toml": nonTaskPlanArtifactContract,
    });
    try {
      const view = toTaskView(makeTaskRecord("plan_artifact_v1"));
      expect(view.completionSurface).toBeNull();
    } finally {
      restoreHome();
    }
  });

  it("does not include a partial completionSurface when plan_artifact_v1 loading is broken", () => {
    const restoreHome = withRuntimeContracts({
      "plan_artifact_v1.toml": brokenPlanArtifactContract,
    });
    try {
      const view = toTaskView(makeTaskRecord("plan_artifact_v1"));
      expect(view.completionSurface).toBeNull();
    } finally {
      restoreHome();
    }
  });
});
