import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { tasks, agents } from "../db/schema.js";
import { hasPermission } from "../hub/permissions.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "node:crypto";
import { validateCompiledOutput } from "../contracts/compiler.js";
import { loadContracts } from "../contracts/loader.js";
import type { ValidationIssue } from "../contracts/types.js";
import * as taskFinalize from "./task-finalize.js";
import type {
  TaskAttempt,
  TaskCompletionContract,
  TaskContractResult,
  TaskMetadata,
  TaskResultMeta,
  TaskRepoScope,
} from "./task-metadata.js";
import { normalizeTaskMetadata, taskMetadataSchema, taskResultMetaSchema } from "./task-metadata.js";

// --- Types ---

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";
type TaskRecord = typeof tasks.$inferSelect;
export type TaskErrorCode = "CLIENT" | "SERVER";

export interface Task extends Omit<TaskRecord, "taskMetadata"> {
  taskType?: string | null;
  completionContract?: TaskCompletionContract | null;
  attempt?: TaskAttempt | null;
  repoScope?: TaskRepoScope | null;
  contractResult: TaskContractResult | null;
  resultMeta: TaskResultMeta | null;
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
  contractResult?: TaskContractResult;
  resultMeta?: TaskResultMeta;
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
  const parsedResultMeta = taskResultMetaSchema.safeParse(task.resultMeta);
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
    contractResult: task.contractResult ?? null,
    resultMeta: parsedResultMeta.success ? parsedResultMeta.data : null,
    taskType: metadata?.taskType ?? null,
    completionContract: metadata?.completionContract ?? null,
    attempt: metadata?.attempt ?? null,
    repoScope: metadata?.repoScope ?? null,
  };
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function validateTaskContractResult(task: Task, opts: UpdateTaskOpts): TaskErr | null {
  const requestedContractId = task.completionContract?.contractId?.trim();
  if (!requestedContractId || opts.status !== "done") return null;
  if (!opts.contractResult) {
    return clientErr(`Task result failed output contract "${requestedContractId}": completion contract requires contractResult`);
  }
  if (opts.contractResult.contractId !== requestedContractId) {
    return clientErr(`Task result failed output contract "${requestedContractId}": contractResult.contractId must match requested contractId`);
  }

  const loadResult = loadContracts();
  const loaded = loadResult.contracts.find((entry) =>
    entry.contract.id === requestedContractId && entry.contract.contractType === "task"
  );

  if (!loaded) {
    const diagnostics = loadResult.diagnostics.map((diagnostic) => diagnostic.message).join("; ");
    return serverErr(
      diagnostics
        ? `Output contract "${requestedContractId}" is not available: ${diagnostics}`
        : `Output contract "${requestedContractId}" is not available`
    );
  }

  const validation = validateCompiledOutput(loaded.contract, opts.contractResult.output);
  if (!validation.ok) {
    return clientErr(`Task result failed output contract "${requestedContractId}": ${formatValidationIssues(validation.issues)}`);
  }

  return null;
}

function getFinalizeRepoRoot(task: Task): string | null {
  return task.repoScope?.targetRepo?.trim() || null;
}

async function finalizeTaskUpdate(
  requesterId: string,
  task: Task,
  opts: UpdateTaskOpts,
): Promise<TaskResult<Task> | null> {
  const requestedContractId = task.completionContract?.contractId?.trim();
  const handler = requestedContractId ? taskFinalize.getFinalizeHandler(requestedContractId) : null;
  if (opts.status !== "done" || !handler || !opts.contractResult) {
    return null;
  }

  const repoRoot = getFinalizeRepoRoot(task);
  if (handler.requiresRepoScope && !repoRoot) {
    return clientErr("Task finalize requires repoScope.targetRepo");
  }

  let finalized: taskFinalize.TaskFinalizeResult;
  try {
    finalized = handler.finalize({
      taskId: task.id,
      repoRoot,
      contractResult: opts.contractResult,
      resultMeta: opts.resultMeta,
    });
  } catch (error) {
    return clientErr(error instanceof Error ? error.message : String(error));
  }

  let createdArtifacts: string[];
  try {
    createdArtifacts = await taskFinalize.persistArtifacts(repoRoot ?? "", finalized.artifacts);
  } catch (error) {
    return serverErr(`Failed to persist finalized artifact: ${error instanceof Error ? error.message : String(error)}`);
  }

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          status: "done",
          contractResult: opts.contractResult,
          resultMeta: finalized.resultMeta,
          result: finalized.result,
          version: task.version + 1,
          changedBy: requesterId,
          updatedAt: now,
        })
        .where(eq(tasks.id, task.id));
    });
  } catch (error) {
    await Promise.all(createdArtifacts.map((artifactPath) =>
      taskFinalize.removeArtifact(repoRoot ?? "", artifactPath).catch((cleanupError) => {
        logger.warn(
          {
            taskId: task.id,
            cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          },
          "Failed to clean up finalized artifact after database error",
        );
      })
    ));
    return serverErr(`Failed to persist finalized task result: ${error instanceof Error ? error.message : String(error)}`);
  }

  const updated = await db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
  if (!updated) {
    return serverErr("Failed to retrieve finalized task");
  }

  logger.info({ taskId: task.id, requesterId }, "Task finalized");
  return { ok: true, data: toTaskView(updated) };
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

  const canSeeTask = await canViewAllTasks(requesterId);
  if (!canSeeTask && task.assignedTo !== requesterId) {
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

  const contractValidationFailure = validateTaskContractResult(toTaskView(task), opts);
  if (contractValidationFailure) {
    return contractValidationFailure;
  }

  if (opts.resultMeta !== undefined) {
    const parsedResultMeta = taskResultMetaSchema.safeParse(opts.resultMeta);
    if (!parsedResultMeta.success) {
      return clientErr(`Invalid task result metadata: ${parsedResultMeta.error.issues[0]?.message ?? "unknown error"}`);
    }
    opts = { ...opts, resultMeta: parsedResultMeta.data };
  }

  const finalizeResult = await finalizeTaskUpdate(requesterId, toTaskView(task), opts);
  if (finalizeResult) {
    return finalizeResult;
  }

  const now = new Date();
  await db
    .update(tasks)
    .set({
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      ...(opts.contractResult !== undefined ? { contractResult: opts.contractResult } : {}),
      ...(opts.resultMeta !== undefined ? { resultMeta: opts.resultMeta } : {}),
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
