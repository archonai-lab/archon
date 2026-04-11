import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { tasks, agents } from "../db/schema.js";
import { hasPermission } from "../hub/permissions.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "node:crypto";
import type {
  TaskAttempt,
  TaskCompletionContract,
  TaskMetadata,
  TaskRepoScope,
} from "./task-metadata.js";
import { normalizeTaskMetadata, taskMetadataSchema } from "./task-metadata.js";

// --- Types ---

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";
type TaskRecord = typeof tasks.$inferSelect;
export type TaskErrorCode = "CLIENT" | "SERVER";

export interface Task extends Omit<TaskRecord, "taskMetadata"> {
  taskType?: string | null;
  completionContract?: TaskCompletionContract | null;
  attempt?: TaskAttempt | null;
  repoScope?: TaskRepoScope | null;
}

export interface TaskOk<T> {
  ok: true;
  data: T;
}

export interface TaskErr {
  ok: false;
  code: TaskErrorCode;
  error: string;
}

export type TaskResult<T> = TaskOk<T> | TaskErr;

export interface CreateTaskOpts {
  title: string;
  description?: string;
  assignedTo?: string;
  meetingId?: string;
  taskMetadata?: TaskMetadata;
}

export interface UpdateTaskOpts {
  status?: TaskStatus;
  result?: string;
}

export interface ListTaskOpts {
  // CALIBRATION: 50 default covers typical team workload without unbounded growth.
  // CEO sees ~5 agents × ~10 active tasks each = ~50. Increase if team scales beyond 10 agents.
  limit?: number;
  offset?: number;
}

// --- Helpers ---

function clientErr(error: string): TaskErr {
  return { ok: false, code: "CLIENT", error };
}

function serverErr(error: string): TaskErr {
  return { ok: false, code: "SERVER", error };
}

function toTaskView(task: TaskRecord): Task {
  const metadata = normalizeTaskMetadata(task.taskMetadata);
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    assignedTo: task.assignedTo,
    assignedBy: task.assignedBy,
    meetingId: task.meetingId,
    result: task.result,
    version: task.version,
    changedBy: task.changedBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    taskType: metadata?.taskType ?? null,
    completionContract: metadata?.completionContract ?? null,
    attempt: metadata?.attempt ?? null,
    repoScope: metadata?.repoScope ?? null,
  };
}

// --- Auth helpers ---

export async function canManageTasks(agentId: string): Promise<boolean> {
  return hasPermission(agentId, "task:*", "admin");
}

const GLOBAL_TASK_BOARD_ALLOWLIST = new Set(["ceo", "levia"]);

export async function canViewAllTasks(agentId: string): Promise<boolean> {
  if (await canManageTasks(agentId)) return true;
  // Temporary bridge until real role-based task board visibility exists.
  // Keep this allowlist narrow and remove it once human/admin board access is modeled explicitly.
  return GLOBAL_TASK_BOARD_ALLOWLIST.has(agentId);
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

// CALIBRATION: 50 default page size — see ListTaskOpts comment for reasoning
const DEFAULT_PAGE_LIMIT = 50;

export async function createTask(
  requesterId: string,
  opts: CreateTaskOpts
): Promise<TaskResult<Task>> {
  const allowed = await canManageTasks(requesterId);
  if (!allowed) {
    return clientErr("Permission denied: only CEO/admin can create tasks");
  }

  if (opts.assignedTo) {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, opts.assignedTo),
    });
    if (!agent) {
      return clientErr(`Agent "${opts.assignedTo}" not found`);
    }
  }

  let taskMetadata: TaskMetadata | null = null;
  if (opts.taskMetadata !== undefined) {
    const parsed = taskMetadataSchema.safeParse(opts.taskMetadata);
    if (!parsed.success) {
      return clientErr(`Invalid task metadata: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
    }
    taskMetadata = parsed.data;
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
    taskMetadata,
    changedBy: requesterId,
    createdAt: now,
    updatedAt: now,
  });

  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!task) {
    return serverErr("Failed to retrieve created task");
  }

  logger.info({ taskId: id, requesterId }, "Task created");
  return { ok: true, data: toTaskView(task) };
}

export async function listTasks(
  requesterId: string,
  opts: ListTaskOpts = {}
): Promise<TaskResult<{ tasks: Task[]; total: number }>> {
  const limit = opts.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = opts.offset ?? 0;
  const canSeeAll = await canViewAllTasks(requesterId);

  const whereClause = canSeeAll ? undefined : eq(tasks.assignedTo, requesterId);

  const [result, countResult] = await Promise.all([
    db.query.tasks.findMany({
      where: whereClause,
      limit,
      offset,
      orderBy: (tasks, { desc }) => [desc(tasks.updatedAt)],
    }),
    db.query.tasks.findMany({ where: whereClause }),
  ]);

  return { ok: true, data: { tasks: result.map(toTaskView), total: countResult.length } };
}

export async function getTask(
  requesterId: string,
  taskId: string
): Promise<TaskResult<Task>> {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    return clientErr(`Task "${taskId}" not found`);
  }

  const isCeo = await canManageTasks(requesterId);
  if (!isCeo && task.assignedTo !== requesterId) {
    return clientErr("Permission denied: task is not assigned to you");
  }

  return { ok: true, data: toTaskView(task) };
}

export async function updateTask(
  requesterId: string,
  taskId: string,
  opts: UpdateTaskOpts
): Promise<TaskResult<Task>> {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    return clientErr(`Task "${taskId}" not found`);
  }

  const isCeo = await canManageTasks(requesterId);

  // Zero-trust: agents can only update their own tasks
  if (!isCeo && task.assignedTo !== requesterId) {
    return clientErr("Permission denied: you can only update tasks assigned to you");
  }

  const currentStatus = task.status as TaskStatus;

  // Terminal states are immutable — no status changes, no result overwrites
  if (currentStatus === "done" || currentStatus === "failed") {
    return clientErr(`Task is in terminal state "${currentStatus}" and cannot be modified`);
  }

  if (opts.status !== undefined) {
    if (!isValidTransition(currentStatus, opts.status)) {
      return clientErr(`Invalid status transition: ${currentStatus} → ${opts.status}`);
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
    return serverErr("Failed to retrieve updated task");
  }

  logger.info({ taskId, requesterId, newStatus: opts.status }, "Task updated");
  return { ok: true, data: toTaskView(updated) };
}
