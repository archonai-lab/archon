import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { tasks, agents } from "../db/schema.js";
import { hasPermission } from "../hub/permissions.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "node:crypto";

// --- Types ---

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";
export type Task = typeof tasks.$inferSelect;

export interface CreateTaskOpts {
  title: string;
  description?: string;
  assignedTo?: string;
  meetingId?: string;
}

export interface UpdateTaskOpts {
  status?: TaskStatus;
  result?: string;
}

// --- Auth helpers ---

export async function canManageTasks(agentId: string): Promise<boolean> {
  return hasPermission(agentId, "task:*", "admin");
}

// --- Status transition enforcement ---

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress"],
  in_progress: ["done", "failed"],
  done: [],
  failed: [],
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// --- CRUD ---

export async function createTask(
  requesterId: string,
  opts: CreateTaskOpts
): Promise<{ ok: true; task: Task } | { ok: false; error: string }> {
  const allowed = await canManageTasks(requesterId);
  if (!allowed) {
    return { ok: false, error: "Permission denied: only CEO/admin can create tasks" };
  }

  if (opts.assignedTo) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, opts.assignedTo),
    });
    if (!agent) {
      return { ok: false, error: `Agent "${opts.assignedTo}" not found` };
    }
  }

  const id = randomUUID();
  const now = new Date();

  await db.insert(tasks).values({
    id,
    title: opts.title,
    description: opts.description,
    assignedTo: opts.assignedTo,
    assignedBy: requesterId,
    meetingId: opts.meetingId,
    changedBy: requesterId,
    createdAt: now,
    updatedAt: now,
  });

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!task) {
    return { ok: false, error: "Failed to retrieve created task" };
  }

  logger.info({ taskId: id, requesterId }, "Task created");
  return { ok: true, task };
}

export async function listTasks(
  requesterId: string
): Promise<{ ok: true; tasks: Task[] } | { ok: false; error: string }> {
  const isCeo = await canManageTasks(requesterId);

  let result: Task[];
  if (isCeo) {
    result = await db.query.tasks.findMany();
  } else {
    result = await db.query.tasks.findMany({
      where: eq(tasks.assignedTo, requesterId),
    });
  }

  return { ok: true, tasks: result };
}

export async function getTask(
  requesterId: string,
  taskId: string
): Promise<{ ok: true; task: Task } | { ok: false; error: string }> {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    return { ok: false, error: `Task "${taskId}" not found` };
  }

  const isCeo = await canManageTasks(requesterId);
  if (!isCeo && task.assignedTo !== requesterId) {
    return { ok: false, error: "Permission denied: task is not assigned to you" };
  }

  return { ok: true, task };
}

export async function updateTask(
  requesterId: string,
  taskId: string,
  opts: UpdateTaskOpts
): Promise<{ ok: true; task: Task } | { ok: false; error: string }> {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    return { ok: false, error: `Task "${taskId}" not found` };
  }

  const isCeo = await canManageTasks(requesterId);

  // Zero-trust: agents can only update their own tasks
  if (!isCeo && task.assignedTo !== requesterId) {
    return { ok: false, error: "Permission denied: you can only update tasks assigned to you" };
  }

  if (opts.status !== undefined) {
    const currentStatus = task.status as TaskStatus;
    if (!isValidTransition(currentStatus, opts.status)) {
      return {
        ok: false,
        error: `Invalid status transition: ${currentStatus} → ${opts.status}`,
      };
    }
  }

  const now = new Date();
  await db
    .update(tasks)
    .set({
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      ...(opts.result !== undefined ? { result: opts.result } : {}),
      version: task.version + 1,
      changedBy: requesterId,
      updatedAt: now,
    })
    .where(eq(tasks.id, taskId));

  const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!updated) {
    return { ok: false, error: "Failed to retrieve updated task" };
  }

  logger.info({ taskId, requesterId, newStatus: opts.status }, "Task updated");
  return { ok: true, task: updated };
}
