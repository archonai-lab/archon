import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { tasks, agents } from "../db/schema.js";
import { hasPermission } from "../hub/permissions.js";
import { logger } from "../utils/logger.js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { validateCompiledOutput } from "../contracts/compiler.js";
import { loadContracts } from "../contracts/loader.js";
import type { ValidationIssue } from "../contracts/types.js";
import * as taskFinalize from "./task-finalize.js";
import type {
  TaskCompletionContract,
  TaskContractResult,
  TaskMetadata,
  TaskOutputFieldContract,
  TaskResultMeta,
} from "./task-metadata.js";
import { normalizeTaskMetadata, taskMetadataSchema, taskResultMetaSchema } from "./task-metadata.js";
import { toTaskView, type Task } from "./task-view.js";

// --- Types ---

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";
type TaskRecord = typeof tasks.$inferSelect;
export type TaskErrorCode = "CLIENT" | "SERVER";
export type TaskRejectionCode = "STALE_ATTEMPT";

export interface TaskOk<T> {
  ok: true;
  data: T;
}

export interface TaskErr {
  ok: false;
  code: TaskErrorCode;
  error: string;
}

export interface TaskRejected {
  ok: false;
  code: TaskRejectionCode;
  taskId: string;
  attemptId?: string;
  currentStatus: TaskStatus;
  currentVersion: number;
  attemptClosed: true;
}

export type TaskResult<T> = TaskOk<T> | TaskErr;
export type TaskUpdateResult = TaskResult<Task> | TaskRejected;

export interface CreateTaskOpts {
  title: string;
  description?: string;
  assignedTo?: string;
  meetingId?: string;
  taskMetadata?: TaskMetadata;
}

export interface UpdateTaskOpts {
  // CALIBRATION: PR1 treats attemptId as a correlation token only; PR2 should decide whether the hub owns attempt identity validation.
  attemptId?: string;
  expectedTaskVersion?: number;
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

function staleAttempt(task: TaskRecord, attemptId?: string): TaskRejected {
  const rejected: TaskRejected = {
    ok: false,
    code: "STALE_ATTEMPT",
    taskId: task.id,
    currentStatus: task.status as TaskStatus,
    currentVersion: task.version,
    attemptClosed: true,
  };
  if (attemptId) rejected.attemptId = attemptId;
  return rejected;
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function normalizeOutputPath(
  path: string,
  baseDir?: string | null,
): { normalizedPath: string; scopeError?: string } {
  const normalizedPath = isAbsolute(path) ? resolve(path) : resolve(baseDir ?? process.cwd(), path);
  if (!baseDir) return { normalizedPath };

  const normalizedBase = resolve(baseDir);
  const relativePath = relative(normalizedBase, normalizedPath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return { normalizedPath };
  }

  return { normalizedPath, scopeError: "path escapes repo scope" };
}

function isValidInlineOutputType(value: unknown, expectedType: TaskOutputFieldContract["type"]): boolean {
  if (expectedType === undefined) return true;
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "string_array":
      return isStringArray(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return true;
  }
}

function hasNonEmptyInlineOutputValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return value !== null && value !== undefined;
}

function isNegativeEvidenceEntry(entry: string): boolean {
  return [
    /\bno verification\b/i,
    /\bnot run\b/i,
    /\bnot completed\b/i,
    /\boutstanding\b/i,
    /\bdeferred\b/i,
    /\bnot yet\b/i,
  ].some((pattern) => pattern.test(entry));
}

function getInputString(input: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function validateInlineOutputField(
  output: Record<string, unknown>,
  field: string,
  rule: TaskOutputFieldContract,
  contract: TaskCompletionContract,
  baseDir?: string | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = output[field];
  const required = rule.required === true || contract.output?.requiredFields?.includes(field) === true;
  const path = `output.${field}`;

  if (value === undefined || value === null) {
    if (required) issues.push({ path, message: "required field is missing" });
    return issues;
  }

  if (!isValidInlineOutputType(value, rule.type)) {
    issues.push({ path, message: `expected ${rule.type}` });
    return issues;
  }

  if (rule.nonEmpty && !hasNonEmptyInlineOutputValue(value)) {
    issues.push({ path, message: "must not be empty" });
  }

  if (rule.equalsInput) {
    const expected = getInputString(contract.input, rule.equalsInput);
    if (!expected) {
      issues.push({ path: `input.${rule.equalsInput}`, message: "required input field is missing" });
    } else if (value !== expected) {
      issues.push({ path, message: `must equal input.${rule.equalsInput}` });
    }
  }

  if (rule.includesInput) {
    const expected = getInputString(contract.input, rule.includesInput);
    if (!expected) {
      issues.push({ path: `input.${rule.includesInput}`, message: "required input field is missing" });
    } else if (!isStringArray(value) || !value.includes(expected)) {
      issues.push({ path, message: `must include input.${rule.includesInput}` });
    }
  }

  if (rule.pathExists && typeof value === "string") {
    const outputPath = normalizeOutputPath(value, baseDir);
    if (outputPath.scopeError) {
      issues.push({ path, message: outputPath.scopeError });
    } else if (!existsSync(outputPath.normalizedPath)) {
      issues.push({ path, message: "path does not exist" });
    }
  }

  if (typeof value === "string" && typeof rule.minBytes === "number" && Number.isFinite(rule.minBytes)) {
    const outputPath = normalizeOutputPath(value, baseDir);
    try {
      if (outputPath.scopeError) throw new Error(outputPath.scopeError);
      const bytes = statSync(outputPath.normalizedPath).size;
      if (bytes < rule.minBytes) {
        issues.push({ path, message: `file must be at least ${rule.minBytes} bytes` });
      }
    } catch (error) {
      issues.push({
        path,
        message: error instanceof Error && error.message === outputPath.scopeError
          ? outputPath.scopeError
          : "path is not readable",
      });
    }
  }

  if (typeof value === "string" && isStringArray(rule.fileIncludes) && rule.fileIncludes.length > 0) {
    const outputPath = normalizeOutputPath(value, baseDir);
    try {
      if (outputPath.scopeError) throw new Error(outputPath.scopeError);
      const content = readFileSync(outputPath.normalizedPath, "utf8");
      for (const requiredText of rule.fileIncludes) {
        if (!content.includes(requiredText)) {
          issues.push({ path, message: `file must include ${JSON.stringify(requiredText)}` });
        }
      }
    } catch (error) {
      issues.push({
        path,
        message: error instanceof Error && error.message === outputPath.scopeError
          ? outputPath.scopeError
          : "path is not readable",
      });
    }
  }

  if (rule.rejectNegative && isStringArray(value) && value.some(isNegativeEvidenceEntry)) {
    issues.push({ path, message: "must contain completed evidence, not a missing-evidence note" });
  }

  return issues;
}

function validateInlineCompletionOutput(
  contract: TaskCompletionContract,
  output: Record<string, unknown>,
  baseDir?: string | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const outputContract = contract.output;
  if (!outputContract) return issues;

  for (const field of outputContract.requiredFields ?? []) {
    if (!field.trim() || outputContract.fields?.[field]) continue;
    if (output[field] === undefined || output[field] === null) {
      issues.push({ path: `output.${field}`, message: "required field is missing" });
    }
  }

  for (const [field, rule] of Object.entries(outputContract.fields ?? {})) {
    issues.push(...validateInlineOutputField(output, field, rule, contract, baseDir));
  }

  return issues;
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

  if (task.completionContract?.output) {
    const issues = validateInlineCompletionOutput(
      task.completionContract,
      opts.contractResult.output,
      task.repoScope?.targetRepo,
    );
    if (issues.length > 0) {
      return clientErr(`Task result failed output contract "${requestedContractId}": ${formatValidationIssues(issues)}`);
    }
    return null;
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
): Promise<TaskUpdateResult | null> {
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
    const updated = await db.transaction(async (tx) => {
      const whereClause = opts.expectedTaskVersion !== undefined
        ? and(eq(tasks.id, task.id), eq(tasks.version, opts.expectedTaskVersion))
        : eq(tasks.id, task.id);

      return tx
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
        .where(whereClause)
        .returning();
    });

    if (updated.length === 0) {
      await Promise.all(createdArtifacts.map((artifactPath) =>
        taskFinalize.removeArtifact(repoRoot ?? "", artifactPath).catch((cleanupError) => {
          logger.warn(
            {
              taskId: task.id,
              cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            },
            "Failed to clean up finalized artifact after stale update rejection",
          );
        })
      ));
      const current = await db.query.tasks.findFirst({ where: eq(tasks.id, task.id) });
      return current
        ? staleAttempt(current, opts.attemptId)
        : serverErr("Failed to retrieve current task after stale finalize rejection");
    }
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
): Promise<TaskUpdateResult> {
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
  const isConditionalWrite = opts.expectedTaskVersion !== undefined;

  if (isConditionalWrite && opts.expectedTaskVersion !== task.version) {
    return staleAttempt(task, opts.attemptId);
  }

  if (isConditionalWrite && (currentStatus === "done" || currentStatus === "failed")) {
    return staleAttempt(task, opts.attemptId);
  }

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
  const whereClause = opts.expectedTaskVersion !== undefined
    ? and(eq(tasks.id, taskId), eq(tasks.version, opts.expectedTaskVersion))
    : eq(tasks.id, taskId);

  const [updated] = await db
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
    .where(whereClause)
    .returning();

  if (!updated) {
    if (isConditionalWrite) {
      const current = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
      return current
        ? staleAttempt(current, opts.attemptId)
        : serverErr("Failed to retrieve current task after stale update rejection");
    }
    return serverErr("Failed to update task");
  }

  logger.info({ taskId, requesterId, newStatus: opts.status }, "Task updated");
  return { ok: true, data: toTaskView(updated) };
}
