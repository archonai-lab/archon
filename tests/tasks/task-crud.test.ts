import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, permissions, tasks } from "../../src/db/schema.js";
import {
  createTask,
  listTasks,
  getTask,
  updateTask,
  isValidTransition,
} from "../../src/tasks/task-crud.js";
import type { TaskErr } from "../../src/tasks/task-crud.js";
import { grantPermission } from "../../src/hub/permissions.js";
import { ensureArchonHome } from "../../src/setup.js";
import * as taskFinalize from "../../src/tasks/task-finalize.js";

const CEO_AGENT = "task-test-ceo";
const LEVIA_AGENT = "levia";
const REGULAR_AGENT = "task-test-agent";
const OTHER_AGENT = "task-test-other";

beforeAll(async () => {
  await db.execute('ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "task_metadata" jsonb');
  await db.execute('ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "contract_result" jsonb');
  await db.execute('ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "result_meta" jsonb');
  await db.insert(agents).values([
    { id: CEO_AGENT, displayName: "Task Test CEO", workspacePath: "/tmp/task-test-ceo" },
    { id: LEVIA_AGENT, displayName: "Levia", workspacePath: "~/.archon/agents/levia" },
    { id: REGULAR_AGENT, displayName: "Task Test Agent", workspacePath: "/tmp/task-test-agent" },
    { id: OTHER_AGENT, displayName: "Task Test Other", workspacePath: "/tmp/task-test-other" },
  ]).onConflictDoNothing();

  await grantPermission(CEO_AGENT, "task:*", "admin");
});

afterAll(async () => {
  // Clean up in FK-safe order
  await db.delete(tasks).where(eq(tasks.assignedBy, CEO_AGENT));
  await db.delete(permissions).where(eq(permissions.agentId, CEO_AGENT));
  await db.delete(agents).where(eq(agents.id, CEO_AGENT));
  await db.delete(agents).where(eq(agents.id, REGULAR_AGENT));
  await db.delete(agents).where(eq(agents.id, OTHER_AGENT));
  await closeConnection();
});

function withSeededArchonHome(): () => void {
  const previousHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), "archon-home-"));
  ensureArchonHome();
  return () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  };
}

function writeSummaryContract(contractId: string): void {
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is required for runtime contract tests");

  const contractsDir = join(home, ".archon", "contracts");
  mkdirSync(contractsDir, { recursive: true });
  writeFileSync(join(contractsDir, `${contractId}.toml`), [
    "[info]",
    `id = "${contractId}"`,
    'version = "1.0"',
    'contract_type = "task"',
    "",
    "[output]",
    'type = "object"',
    "required = true",
    "normative = true",
    "",
    "[output.fields.summary]",
    'type = "string"',
    "required = true",
    "normative = true",
    "",
  ].join("\n"));
}

// --- Status transition validation ---

describe("isValidTransition", () => {
  it("allows pending → in_progress", () => {
    expect(isValidTransition("pending", "in_progress")).toBe(true);
  });

  it("allows in_progress → done", () => {
    expect(isValidTransition("in_progress", "done")).toBe(true);
  });

  it("allows in_progress → failed", () => {
    expect(isValidTransition("in_progress", "failed")).toBe(true);
  });

  it("rejects pending → done (skip in_progress)", () => {
    expect(isValidTransition("pending", "done")).toBe(false);
  });

  it("rejects pending → failed (skip in_progress)", () => {
    expect(isValidTransition("pending", "failed")).toBe(false);
  });

  it("rejects done → in_progress (backwards)", () => {
    expect(isValidTransition("done", "in_progress")).toBe(false);
  });

  it("rejects failed → in_progress (backwards)", () => {
    expect(isValidTransition("failed", "in_progress")).toBe(false);
  });

  it("rejects in_progress → pending (backwards)", () => {
    expect(isValidTransition("in_progress", "pending")).toBe(false);
  });
});

// --- Schema: task creation ---

describe("createTask", () => {
  it("CEO can create a task with all fields", async () => {
    const result = await createTask(CEO_AGENT, {
      title: "Write tests",
      description: "Cover all edge cases",
      assignedTo: REGULAR_AGENT,
      meetingId: "meeting-42",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.title).toBe("Write tests");
    expect(result.data.description).toBe("Cover all edge cases");
    expect(result.data.assignedTo).toBe(REGULAR_AGENT);
    expect(result.data.assignedBy).toBe(CEO_AGENT);
    expect(result.data.meetingId).toBe("meeting-42");
    expect(result.data.status).toBe("pending");
    expect(result.data.version).toBe(1);
    expect(result.data.id).toBeTruthy();
    expect(result.data.createdAt).toBeInstanceOf(Date);
  });

  it("persists task metadata and returns the canonical outbound shape", async () => {
    const result = await createTask(CEO_AGENT, {
      title: "Review with metadata",
      assignedTo: REGULAR_AGENT,
      taskMetadata: {
        taskType: "review",
        completionContract: {
          contractId: "codebase_review_task",
        },
        repoScope: {
          targetRepo: "/tmp/archon-output-contract-main",
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.taskType).toBe("review");
    expect(result.data.completionContract?.contractId).toBe("codebase_review_task");
    expect(result.data.repoScope?.targetRepo).toBe("/tmp/archon-output-contract-main");

    const fetched = await getTask(REGULAR_AGENT, result.data.id);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.completionContract?.contractId).toBe("codebase_review_task");
  });

  it("returns projected completionSurface through task CRUD read paths", async () => {
    const result = await createTask(CEO_AGENT, {
      title: "Plan artifact with projected surface",
      assignedTo: REGULAR_AGENT,
      taskMetadata: {
        taskType: "plan",
        completionContract: {
          contractId: "plan_artifact_v1",
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completionSurface?.contractId).toBe("plan_artifact_v1");
    expect(Object.keys(result.data.completionSurface?.fields ?? {}).length).toBeGreaterThan(0);

    const fetched = await getTask(REGULAR_AGENT, result.data.id);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.completionSurface?.contractId).toBe("plan_artifact_v1");

    const listed = await listTasks(CEO_AGENT);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const listedTask = listed.data.tasks.find((task) => task.id === result.data.id);
    expect(listedTask?.completionSurface?.contractId).toBe("plan_artifact_v1");
  });

  it("rejects invalid task metadata", async () => {
    const result = await createTask(CEO_AGENT, {
      title: "Bad metadata task",
      taskMetadata: {
        attempt: {
          number: 0,
        },
      } as never,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/invalid task metadata/i);
  });

  it("non-CEO agent cannot create a task", async () => {
    const result = await createTask(REGULAR_AGENT, { title: "Sneak task" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/permission denied/i);
  });

  it("returns error when assignedTo agent does not exist", async () => {
    const result = await createTask(CEO_AGENT, {
      title: "Ghost task",
      assignedTo: "nonexistent-agent",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/not found/i);
  });
});

// --- Auth: task visibility ---

describe("listTasks", () => {
  it("CEO sees all tasks", async () => {
    // Create two tasks: one for REGULAR_AGENT, one for OTHER_AGENT
    await createTask(CEO_AGENT, { title: "For regular", assignedTo: REGULAR_AGENT });
    await createTask(CEO_AGENT, { title: "For other", assignedTo: OTHER_AGENT });

    const result = await listTasks(CEO_AGENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const titles = result.data.tasks.map((t) => t.title);
    expect(titles).toContain("For regular");
    expect(titles).toContain("For other");
  });

  it("levia sees all tasks via temporary global board allowlist", async () => {
    await createTask(CEO_AGENT, { title: "Levia regular visibility", assignedTo: REGULAR_AGENT });
    await createTask(CEO_AGENT, { title: "Levia other visibility", assignedTo: OTHER_AGENT });

    const result = await listTasks(LEVIA_AGENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const titles = result.data.tasks.map((t) => t.title);
    expect(titles).toContain("Levia regular visibility");
    expect(titles).toContain("Levia other visibility");
    expect(result.data.tasks.some((task) => task.assignedTo === OTHER_AGENT)).toBe(true);
  });

  it("keeps board-viewer task listing broader than non-viewer listing without widening task access", async () => {
    const viewerVisibleTitle = "Viewer-visible task";
    const hiddenTitle = "Observer-hidden task";

    await createTask(CEO_AGENT, { title: viewerVisibleTitle, assignedTo: OTHER_AGENT });
    await createTask(CEO_AGENT, { title: hiddenTitle, assignedTo: REGULAR_AGENT });

    const viewerResult = await listTasks(LEVIA_AGENT);
    const regularResult = await listTasks(REGULAR_AGENT);

    expect(viewerResult.ok).toBe(true);
    expect(regularResult.ok).toBe(true);
    if (!viewerResult.ok || !regularResult.ok) return;

    expect(viewerResult.data.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: viewerVisibleTitle, assignedTo: OTHER_AGENT }),
      expect.objectContaining({ title: hiddenTitle, assignedTo: REGULAR_AGENT }),
    ]));
    expect(regularResult.data.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: hiddenTitle, assignedTo: REGULAR_AGENT }),
    ]));
    expect(regularResult.data.tasks).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: viewerVisibleTitle }),
    ]));
  });

  it("agent sees only their own tasks", async () => {
    const result = await listTasks(REGULAR_AGENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const task of result.data.tasks) {
      expect(task.assignedTo).toBe(REGULAR_AGENT);
    }
  });

  it("returns total count for pagination", async () => {
    const result = await listTasks(CEO_AGENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(typeof result.data.total).toBe("number");
    expect(result.data.total).toBeGreaterThanOrEqual(result.data.tasks.length);
  });

  it("respects limit parameter", async () => {
    const result = await listTasks(CEO_AGENT, { limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.tasks.length).toBeLessThanOrEqual(1);
    // total should still reflect all tasks, not just the page
    expect(result.data.total).toBeGreaterThanOrEqual(1);
  });

  it("respects offset parameter", async () => {
    const allResult = await listTasks(CEO_AGENT);
    if (!allResult.ok) return;

    const offsetResult = await listTasks(CEO_AGENT, { offset: 1 });
    expect(offsetResult.ok).toBe(true);
    if (!offsetResult.ok) return;

    // Offset by 1 should return one fewer task (or same if new tasks were created)
    expect(offsetResult.data.tasks.length).toBeLessThanOrEqual(allResult.data.total);
  });
});

// --- Auth: get ---

describe("getTask", () => {
  it("agent can get their own task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Agent's task",
      assignedTo: REGULAR_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await getTask(REGULAR_AGENT, created.data.id);
    expect(result.ok).toBe(true);
  });

  it("agent cannot get another agent's task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Other agent's task",
      assignedTo: OTHER_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await getTask(REGULAR_AGENT, created.data.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/permission denied/i);
  });

  it("CEO can get any task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Any task",
      assignedTo: OTHER_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await getTask(CEO_AGENT, created.data.id);
    expect(result.ok).toBe(true);
  });

  it("allowlisted global task-board viewers can get any task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Board-visible task",
      assignedTo: OTHER_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await getTask(LEVIA_AGENT, created.data.id);
    expect(result.ok).toBe(true);
  });
});

// --- Auth: update ---

describe("updateTask", () => {
  it("agent can update status on their own task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Task for agent to update",
      assignedTo: REGULAR_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "in_progress",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("in_progress");
    expect(result.data.version).toBe(2);
    expect(result.data.changedBy).toBe(REGULAR_AGENT);
  });

  it("agent cannot update another agent's task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Other agent's task — no touch",
      assignedTo: OTHER_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "in_progress",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/permission denied/i);
  });

  it("CEO can update any task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "CEO override task",
      assignedTo: OTHER_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await updateTask(CEO_AGENT, created.data.id, {
      status: "in_progress",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("in_progress");
  });

  it("rejects invalid status transition", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Invalid transition task",
      assignedTo: REGULAR_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // pending → done is invalid (must go through in_progress)
    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "done",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/invalid status transition/i);
  });

  it("agent can set result when marking done", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Task with result",
      assignedTo: REGULAR_AGENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // First move to in_progress
    const inProgress = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "in_progress",
    });
    expect(inProgress.ok).toBe(true);

    // Then mark done with result
    const done = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "done",
      result: "Analysis complete. Found 3 issues.",
    });

    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.data.status).toBe("done");
    expect(done.data.result).toBe("Analysis complete. Found 3 issues.");
    expect(done.data.version).toBe(3);
  });

  it("accepts a valid contractResult when the completion contract requests one", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Structured review task",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "review",
          completionContract: {
            contractId: "codebase_review_task",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const done = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "No findings: no merge blockers found.\nVerdict: safe to merge.\nVerification: reviewed the current repo diff.",
        contractResult: {
          contractId: "codebase_review_task",
          output: {
            verdict: "pass_with_notes",
            self_check: {
              repo_root: "/tmp/archon-output-contract-main",
              branch: "feat/output-contract-validation-main",
              diff_files: ["src/tasks/task-crud.ts"],
            },
            findings: [],
            verification: [
              { kind: "repo_scope_check", evidence: "reviewed only current execution repo" },
              { kind: "diff_review", evidence: "reviewed the requested diff" },
            ],
            risks: [],
          },
        },
      });

      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.data.status).toBe("done");
      expect(done.data.contractResult).toEqual({
        contractId: "codebase_review_task",
        output: {
          verdict: "pass_with_notes",
          self_check: {
            repo_root: "/tmp/archon-output-contract-main",
            branch: "feat/output-contract-validation-main",
            diff_files: ["src/tasks/task-crud.ts"],
          },
          findings: [],
          verification: [
            { kind: "repo_scope_check", evidence: "reviewed only current execution repo" },
            { kind: "diff_review", evidence: "reviewed the requested diff" },
          ],
          risks: [],
        },
      });

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.contractResult).toEqual(done.data.contractResult);
    } finally {
      restoreHome();
    }
  });

  it("persists resultMeta alongside contractResult and returns it from get/list", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Structured result meta task",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "review",
          completionContract: {
            contractId: "codebase_review_task",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const done = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "Stored structured output and completion summary.",
        contractResult: {
          contractId: "codebase_review_task",
          output: {
            verdict: "pass_with_notes",
            self_check: {
              repo_root: "/tmp/archon-resultmeta-hub-fix",
              branch: "task/resultmeta-hub-fix",
              diff_files: ["src/hub/router.ts"],
            },
            findings: [],
            verification: [
              { kind: "repo_scope_check", evidence: "reviewed only current execution repo" },
            ],
            risks: [],
          },
        },
        resultMeta: {
          completion: {
            classifierState: "terminal_valid",
            salvageCount: 0,
            salvageBudget: 2,
            finalDisposition: "native_valid",
          },
          summaryPath: "artifacts/issue34-smoke-ae52f195/summary.json",
        },
      });

      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.data.resultMeta).toEqual({
        completion: {
          classifierState: "terminal_valid",
          salvageCount: 0,
          salvageBudget: 2,
          finalDisposition: "native_valid",
        },
        summaryPath: "artifacts/issue34-smoke-ae52f195/summary.json",
      });
      expect(done.data.contractResult?.output).toMatchObject({
        verdict: "pass_with_notes",
      });

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.resultMeta).toEqual(done.data.resultMeta);
      expect(fetched.data.contractResult).toEqual(done.data.contractResult);

      const listed = await listTasks(CEO_AGENT);
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.data.tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: created.data.id,
          resultMeta: done.data.resultMeta,
          contractResult: done.data.contractResult,
        }),
      ]));
    } finally {
      restoreHome();
    }
  });

  it("rejects done when a requested contractResult is missing", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Missing contract result",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "review",
          completionContract: {
            contractId: "codebase_review_task",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "No findings: no merge blockers found.",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/requires contractResult/i);
    } finally {
      restoreHome();
    }
  });

  it("rejects prose-only done for plan_artifact_v1 and leaves the task in_progress", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Plan artifact requires structured output",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId: "plan_artifact_v1",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "Plan drafted in prose only.",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/requires contractResult/i);

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      restoreHome();
    }
  });

  it("rejects done for plan_artifact_v1 when contractResult.contractId does not match", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Plan artifact contract id mismatch",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId: "plan_artifact_v1",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "Structured plan attached.",
        contractResult: {
          contractId: "codebase_review_task",
          output: {
            scope: "Phase 2 validation",
            steps: ["Add task validation tests"],
            risks: [],
            verification: ["Run task validation tests"],
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/contractResult\.contractId must match requested contractId/i);
    } finally {
      restoreHome();
    }
  });

  it("rejects malformed plan_artifact_v1 output and does not partially mark the task done", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Malformed plan artifact output",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId: "plan_artifact_v1",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "Attempted structured plan.",
        contractResult: {
          contractId: "plan_artifact_v1",
          output: {
            scope: "Phase 2 validation",
            steps: "Add regression coverage",
            risks: [],
          } as never,
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/output\.steps: expected array/i);
      expect(result.error).toMatch(/output\.verification: required field is missing/i);

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      restoreHome();
    }
  });

  it("rejects wrong field types for plan_artifact_v1 and leaves the task in_progress", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Plan artifact wrong field type",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId: "plan_artifact_v1",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "Attempted structured plan with wrong scalar types.",
        contractResult: {
          contractId: "plan_artifact_v1",
          output: {
            scope: 76,
            steps: ["Add validation"],
            risks: [],
            verification: ["Run task CRUD tests"],
          } as never,
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/output\.scope: expected string/i);

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      restoreHome();
    }
  });

  it("rejects contract output when required repo-scope proof is missing", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const created = await createTask(CEO_AGENT, {
        title: "Missing self check",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "review",
          completionContract: {
            contractId: "codebase_review_task",
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "Needs changes.",
        contractResult: {
          contractId: "codebase_review_task",
          output: {
            verdict: "needs_changes",
            findings: [],
            verification: [
              { kind: "diff_review", evidence: "reviewed the requested diff" },
            ],
            risks: [],
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/output\.self_check/i);
    } finally {
      restoreHome();
    }
  });

  it("dispatches done through a registered finalize handler for any contract id", async () => {
    const restoreHome = withSeededArchonHome();
    const contractId = "generic_finalize_test";
    writeSummaryContract(contractId);
    const finalizeSpy = vi.fn((context: taskFinalize.TaskFinalizeContext): taskFinalize.TaskFinalizeResult => ({
      result: `finalized:${String(context.contractResult.output.summary)}`,
      resultMeta: {
        ...(context.resultMeta ?? {}),
        finalizedBy: "generic-handler",
      },
      artifacts: [],
    }));
    const unregister = taskFinalize.registerFinalizeHandler({
      contractId,
      finalize: finalizeSpy,
    });

    try {
      const created = await createTask(CEO_AGENT, {
        title: "Generic finalize dispatch",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId,
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const done = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "agent prose should not win",
        contractResult: {
          contractId,
          output: {
            summary: "from handler",
          },
        },
        resultMeta: {
          source: "agent-meta",
        },
      });

      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      expect(done.data.status).toBe("done");
      expect(done.data.result).toBe("finalized:from handler");
      expect(done.data.resultMeta).toMatchObject({
        source: "agent-meta",
        finalizedBy: "generic-handler",
      });
      expect(done.data.contractResult).toEqual({
        contractId,
        output: {
          summary: "from handler",
        },
      });
    } finally {
      unregister();
      restoreHome();
    }
  });

  it("rejects duplicate finalize handler registration and keeps the original handler", () => {
    const contractId = "generic_finalize_duplicate_guard";
    const originalHandler = {
      contractId,
      finalize: vi.fn((): taskFinalize.TaskFinalizeResult => ({
        result: "original",
        resultMeta: {},
        artifacts: [],
      })),
    };
    const duplicateHandler = {
      contractId,
      finalize: vi.fn((): taskFinalize.TaskFinalizeResult => ({
        result: "duplicate",
        resultMeta: {},
        artifacts: [],
      })),
    };
    const unregister = taskFinalize.registerFinalizeHandler(originalHandler);

    try {
      expect(() => taskFinalize.registerFinalizeHandler(duplicateHandler)).toThrow(/already registered/i);
      expect(taskFinalize.getFinalizeHandler(contractId)?.finalize).toBe(originalHandler.finalize);
    } finally {
      unregister();
    }
  });

  it("rejects done for a registered finalize handler when contractResult is missing", async () => {
    const restoreHome = withSeededArchonHome();
    const contractId = "generic_finalize_missing_guard";
    writeSummaryContract(contractId);
    const finalizeSpy = vi.fn((): taskFinalize.TaskFinalizeResult => ({
      result: "should not run",
      resultMeta: {},
      artifacts: [],
    }));
    const unregister = taskFinalize.registerFinalizeHandler({
      contractId,
      finalize: finalizeSpy,
    });

    try {
      const created = await createTask(CEO_AGENT, {
        title: "Generic finalize missing result",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId,
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "should not finalize",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/requires contractResult/i);
      expect(finalizeSpy).not.toHaveBeenCalled();

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      unregister();
      restoreHome();
    }
  });

  it("rejects done for a registered finalize handler when contractResult.contractId does not match", async () => {
    const restoreHome = withSeededArchonHome();
    const contractId = "generic_finalize_mismatch_guard";
    writeSummaryContract(contractId);
    const finalizeSpy = vi.fn((): taskFinalize.TaskFinalizeResult => ({
      result: "should not run",
      resultMeta: {},
      artifacts: [],
    }));
    const unregister = taskFinalize.registerFinalizeHandler({
      contractId,
      finalize: finalizeSpy,
    });

    try {
      const created = await createTask(CEO_AGENT, {
        title: "Generic finalize mismatch",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId,
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        contractResult: {
          contractId: "other_contract",
          output: {
            summary: "wrong id",
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/contractResult\.contractId must match requested contractId/i);
      expect(finalizeSpy).not.toHaveBeenCalled();

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      unregister();
      restoreHome();
    }
  });

  it("rejects invalid compiled output before a registered finalize handler runs", async () => {
    const restoreHome = withSeededArchonHome();
    const targetRepo = mkdtempSync(join(tmpdir(), "archon-generic-finalize-invalid-"));
    const contractId = "generic_finalize_invalid_output";
    writeSummaryContract(contractId);
    const artifactPath = "artifacts/generic/invalid.md";
    const finalizeSpy = vi.fn((): taskFinalize.TaskFinalizeResult => ({
      result: "should not run",
      resultMeta: {},
      artifacts: [
        {
          path: artifactPath,
          content: "should not write",
        },
      ],
    }));
    const unregister = taskFinalize.registerFinalizeHandler({
      contractId,
      finalize: finalizeSpy,
    });

    try {
      const created = await createTask(CEO_AGENT, {
        title: "Generic finalize invalid output",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId,
          },
          repoScope: {
            targetRepo,
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        contractResult: {
          contractId,
          output: {
            notSummary: "invalid",
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/output\.summary/i);
      expect(finalizeSpy).not.toHaveBeenCalled();
      expect(existsSync(join(targetRepo, artifactPath))).toBe(false);

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      unregister();
      restoreHome();
    }
  });

  it("rolls back only newly created generic artifacts when a later artifact write fails", async () => {
    const restoreHome = withSeededArchonHome();
    const targetRepo = mkdtempSync(join(tmpdir(), "archon-generic-finalize-partial-"));
    const contractId = "generic_finalize_partial_artifact_failure";
    writeSummaryContract(contractId);
    const createdArtifact = "artifacts/generic/new.md";
    const existingArtifact = "artifacts/generic/existing.md";
    mkdirSync(join(targetRepo, "artifacts", "generic"), { recursive: true });
    writeFileSync(join(targetRepo, existingArtifact), "prior bytes");
    const unregister = taskFinalize.registerFinalizeHandler({
      contractId,
      requiresRepoScope: true,
      finalize: (): taskFinalize.TaskFinalizeResult => ({
        result: "should not persist",
        resultMeta: {},
        artifacts: [
          {
            path: createdArtifact,
            content: "created in this attempt",
          },
          {
            path: existingArtifact,
            content: "must not overwrite",
          },
        ],
      }),
    });

    try {
      const created = await createTask(CEO_AGENT, {
        title: "Generic finalize partial artifact failure",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId,
          },
          repoScope: {
            targetRepo,
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        contractResult: {
          contractId,
          output: {
            summary: "valid",
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/failed to persist finalized artifact/i);
      expect(existsSync(join(targetRepo, createdArtifact))).toBe(false);
      expect(readFileSync(join(targetRepo, existingArtifact), "utf-8")).toBe("prior bytes");

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      unregister();
      restoreHome();
    }
  });

  it("rejects an existing generic artifact path without overwrite and keeps the task non-terminal", async () => {
    const restoreHome = withSeededArchonHome();
    const targetRepo = mkdtempSync(join(tmpdir(), "archon-generic-finalize-existing-"));
    const contractId = "generic_finalize_existing_artifact";
    writeSummaryContract(contractId);
    const artifactPath = "artifacts/generic/existing.md";
    mkdirSync(join(targetRepo, "artifacts", "generic"), { recursive: true });
    writeFileSync(join(targetRepo, artifactPath), "prior bytes");
    const unregister = taskFinalize.registerFinalizeHandler({
      contractId,
      requiresRepoScope: true,
      finalize: (): taskFinalize.TaskFinalizeResult => ({
        result: "should not persist",
        resultMeta: {},
        artifacts: [
          {
            path: artifactPath,
            content: "new bytes",
          },
        ],
      }),
    });

    try {
      const created = await createTask(CEO_AGENT, {
        title: "Generic finalize existing artifact",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId,
          },
          repoScope: {
            targetRepo,
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        contractResult: {
          contractId,
          output: {
            summary: "valid",
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/failed to persist finalized artifact/i);
      expect(readFileSync(join(targetRepo, artifactPath), "utf-8")).toBe("prior bytes");

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.contractResult).toBeNull();
    } finally {
      unregister();
      restoreHome();
    }
  });

  it("finalizes plan_artifact_v1 by rendering and persisting a hub-derived artifact before done", async () => {
    const restoreHome = withSeededArchonHome();
    try {
      const targetRepo = mkdtempSync(join(tmpdir(), "archon-plan-artifact-"));
      const created = await createTask(CEO_AGENT, {
        title: "Plan artifact finalize",
        assignedTo: REGULAR_AGENT,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            contractId: "plan_artifact_v1",
          },
          repoScope: {
            targetRepo,
          },
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
      const done = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        result: "agent-authored prose should not win",
        contractResult: {
          contractId: "plan_artifact_v1",
          output: {
            scope: "Implement finalize slice for plan artifact tasks.",
            steps: [
              "Validate structured output.",
              "Render the artifact from structured fields.",
              "Persist artifact and task state before done.",
            ],
            risks: ["Database/file persistence is not cross-resource atomic."],
            verification: [
              "Run targeted task finalize tests.",
              "Confirm the artifact path stays inside repo scope.",
            ],
          },
        },
        resultMeta: {
          completion: {
            classifierState: "terminal_valid",
            finalDisposition: "native_valid",
          },
          source: "agent-supplied-meta",
        },
      });

      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.data.status).toBe("done");
      expect(done.data.result).toContain("# Plan Artifact");
      expect(done.data.result).toContain("## Scope");
      expect(done.data.result).toContain("Implement finalize slice for plan artifact tasks.");
      expect(done.data.result).not.toContain("agent-authored prose should not win");
      expect(done.data.resultMeta).toMatchObject({
        source: "agent-supplied-meta",
        artifactPath: join(targetRepo, "artifacts", "tasks", created.data.id, "plan.md"),
      });

      const artifactPath = done.data.resultMeta?.artifactPath;
      expect(typeof artifactPath).toBe("string");
      expect(readFileSync(String(artifactPath), "utf-8")).toBe(done.data.result);

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.contractResult).toEqual(done.data.contractResult);
      expect(fetched.data.result).toBe(done.data.result);
    } finally {
      restoreHome();
    }
  });

  it("rejects done for plan_artifact_v1 when contractResult is missing and keeps the task non-terminal", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "archon-plan-artifact-"));
    const created = await createTask(CEO_AGENT, {
      title: "Plan artifact missing contract result",
      assignedTo: REGULAR_AGENT,
      taskMetadata: {
        taskType: "implementation",
        completionContract: {
          contractId: "plan_artifact_v1",
        },
        repoScope: {
          targetRepo,
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "done",
      result: "should not reach generic done path",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/requires contractResult/i);

    const fetched = await getTask(REGULAR_AGENT, created.data.id);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.status).toBe("in_progress");
    expect(fetched.data.result).toBeNull();
    expect(fetched.data.contractResult).toBeNull();
    expect(fetched.data.resultMeta).toBeNull();
  });

  it("rejects done for plan_artifact_v1 when contractResult.contractId does not match and keeps the task non-terminal", async () => {
    const targetRepo = mkdtempSync(join(tmpdir(), "archon-plan-artifact-"));
    const created = await createTask(CEO_AGENT, {
      title: "Plan artifact contract id mismatch",
      assignedTo: REGULAR_AGENT,
      taskMetadata: {
        taskType: "implementation",
        completionContract: {
          contractId: "plan_artifact_v1",
        },
        repoScope: {
          targetRepo,
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "done",
      contractResult: {
        contractId: "codebase_review_task",
        output: {
          scope: "Wrong contract id",
          steps: ["Should not finalize."],
          risks: [],
          verification: ["Reject finalize contract mismatch."],
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/contractResult\.contractId must match requested contractId/i);

    const fetched = await getTask(REGULAR_AGENT, created.data.id);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.status).toBe("in_progress");
    expect(fetched.data.result).toBeNull();
    expect(fetched.data.contractResult).toBeNull();
    expect(fetched.data.resultMeta).toBeNull();
    expect(existsSync(join(targetRepo, "artifacts", "tasks", created.data.id, "plan.md"))).toBe(false);
  });

  it("keeps the task non-done when the hub-derived artifact path escapes repo scope", async () => {
    const restoreHome = withSeededArchonHome();
    const created = await createTask(CEO_AGENT, {
      title: "Plan artifact repo escape",
      assignedTo: REGULAR_AGENT,
      taskMetadata: {
        taskType: "implementation",
        completionContract: {
          contractId: "plan_artifact_v1",
        },
        repoScope: {
          targetRepo: mkdtempSync(join(tmpdir(), "archon-plan-artifact-")),
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      restoreHome();
      return;
    }

    await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
    const resolveSpy = vi.spyOn(taskFinalize.taskFinalizeOps, "resolveArtifactPath").mockImplementation(() => {
      throw new Error("Derived artifact path escapes repo scope: /tmp/escape.md");
    });
    try {
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        contractResult: {
          contractId: "plan_artifact_v1",
          output: {
            scope: "Escape repo scope",
            steps: ["Derive plan path."],
            risks: [],
            verification: ["Reject outside-repo paths."],
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/escapes repo scope/i);

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.resultMeta).toBeNull();
    } finally {
      resolveSpy.mockRestore();
      restoreHome();
    }
  });

  it("keeps the task non-done when artifact persistence fails", async () => {
    const restoreHome = withSeededArchonHome();
    const targetRepo = mkdtempSync(join(tmpdir(), "archon-plan-artifact-"));
    const created = await createTask(CEO_AGENT, {
      title: "Plan artifact write failure",
      assignedTo: REGULAR_AGENT,
      taskMetadata: {
        taskType: "implementation",
        completionContract: {
          contractId: "plan_artifact_v1",
        },
        repoScope: {
          targetRepo,
        },
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      restoreHome();
      return;
    }

    await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
    const persistSpy = vi.spyOn(taskFinalize, "persistArtifacts").mockRejectedValue(new Error("disk full"));
    try {
      const result = await updateTask(REGULAR_AGENT, created.data.id, {
        status: "done",
        contractResult: {
          contractId: "plan_artifact_v1",
          output: {
            scope: "Write failure path",
            steps: ["Render artifact."],
            risks: [],
            verification: ["Simulate persistence failure."],
          },
        },
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe("SERVER");
      expect(result.error).toMatch(/failed to persist finalized artifact: disk full/i);

      const fetched = await getTask(REGULAR_AGENT, created.data.id);
      expect(fetched.ok).toBe(true);
      if (!fetched.ok) return;
      expect(fetched.data.status).toBe("in_progress");
      expect(fetched.data.result).toBeNull();
      expect(fetched.data.resultMeta).toBeNull();
      expect(existsSync(join(targetRepo, "artifacts", "tasks", created.data.id, "plan.md"))).toBe(false);
    } finally {
      persistSpy.mockRestore();
      restoreHome();
    }
  });
});

// --- Regression: terminal-state immutability ---

describe("terminal-state immutability", () => {
  it("rejects status change on a done task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Terminal done task",
      assignedTo: REGULAR_AGENT,
    });
    if (!created.ok) return;

    await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
    await updateTask(REGULAR_AGENT, created.data.id, { status: "done", result: "finished" });

    // Try to change status back — should fail
    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      status: "in_progress",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/terminal state/i);
  });

  it("rejects result mutation on a done task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Terminal result mutation",
      assignedTo: REGULAR_AGENT,
    });
    if (!created.ok) return;

    await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
    await updateTask(REGULAR_AGENT, created.data.id, { status: "done", result: "original" });

    // Try to overwrite result — should fail
    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      result: "tampered",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/terminal state/i);
  });

  it("rejects any mutation on a failed task", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Terminal failed task",
      assignedTo: REGULAR_AGENT,
    });
    if (!created.ok) return;

    await updateTask(REGULAR_AGENT, created.data.id, { status: "in_progress" });
    await updateTask(REGULAR_AGENT, created.data.id, { status: "failed", result: "crashed" });

    const result = await updateTask(REGULAR_AGENT, created.data.id, {
      result: "actually it worked",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
    expect(result.error).toMatch(/terminal state/i);
  });

  it("CEO also cannot mutate terminal tasks", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "CEO terminal override attempt",
      assignedTo: REGULAR_AGENT,
    });
    if (!created.ok) return;

    await updateTask(CEO_AGENT, created.data.id, { status: "in_progress" });
    await updateTask(CEO_AGENT, created.data.id, { status: "done", result: "sealed" });

    // Even CEO can't modify terminal tasks
    const result = await updateTask(CEO_AGENT, created.data.id, {
      result: "ceo override",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/terminal state/i);
  });
});

// --- Regression: error codes ---

describe("error codes", () => {
  it("returns CLIENT code for permission errors", async () => {
    const result = await createTask(REGULAR_AGENT, { title: "no permission" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
  });

  it("returns CLIENT code for not-found errors", async () => {
    const result = await getTask(CEO_AGENT, "nonexistent-id-12345");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
  });

  it("returns CLIENT code for invalid transitions", async () => {
    const created = await createTask(CEO_AGENT, {
      title: "Transition error code test",
      assignedTo: REGULAR_AGENT,
    });
    if (!created.ok) return;

    const result = await updateTask(REGULAR_AGENT, created.data.id, { status: "done" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CLIENT");
  });
});
