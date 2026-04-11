import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const CEO_AGENT = "task-test-ceo";
const LEVIA_AGENT = "levia";
const REGULAR_AGENT = "task-test-agent";
const OTHER_AGENT = "task-test-other";

beforeAll(async () => {
  await db.insert(agents).values([
    { id: CEO_AGENT, displayName: "Task Test CEO", workspacePath: "/tmp/task-test-ceo" },
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
      title: "Plan with metadata",
      assignedTo: REGULAR_AGENT,
      taskMetadata: {
        taskType: "plan",
        completionContract: {
          taskType: "plan",
          artifactRequired: true,
          requiredArtifacts: ["plan.md"],
        },
        attempt: {
          number: 2,
          kind: "retry",
          previousTaskId: "task-prev-1",
        },
        repoScope: {
          targetRepo: "/tmp/archon-plan",
          relatedRepos: ["/tmp/archon-agent"],
          crossRepoPolicy: "explicit_related_only",
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.taskType).toBe("plan");
    expect(result.data.completionContract).toMatchObject({
      taskType: "plan",
      artifactRequired: true,
      requiredArtifacts: ["plan.md"],
    });
    expect(result.data.attempt).toMatchObject({
      number: 2,
      kind: "retry",
      previousTaskId: "task-prev-1",
    });
    expect(result.data.repoScope).toMatchObject({
      targetRepo: "/tmp/archon-plan",
      relatedRepos: ["/tmp/archon-agent"],
      crossRepoPolicy: "explicit_related_only",
    });

    const fetched = await getTask(REGULAR_AGENT, result.data.id);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.taskType).toBe("plan");
    expect(fetched.data.completionContract?.requiredArtifacts).toEqual(["plan.md"]);

    const listed = await listTasks(REGULAR_AGENT);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const listedTask = listed.data.tasks.find((task) => task.id === result.data.id);
    expect(listedTask).toBeTruthy();
    expect(listedTask?.attempt).toMatchObject({ number: 2, kind: "retry" });
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
    const result = await listTasks(LEVIA_AGENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const titles = result.data.tasks.map((t) => t.title);
    expect(titles).toContain("For regular");
    expect(titles).toContain("For other");
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
