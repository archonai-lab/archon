import { loadContracts } from "../contracts/loader.js";
import { projectCompletionSurface } from "../contracts/completion-surface.js";
import { logger } from "../utils/logger.js";
import { tasks } from "../db/schema.js";
import type {
  TaskAttempt,
  TaskCompletionContract,
  TaskContractResult,
  TaskMetadata,
  TaskResultMeta,
  TaskRepoScope,
} from "./task-metadata.js";
import { normalizeTaskMetadata, taskResultMetaSchema } from "./task-metadata.js";

type TaskRecord = typeof tasks.$inferSelect;

export interface Task extends Omit<TaskRecord, "taskMetadata"> {
  taskType?: string | null;
  completionContract?: TaskCompletionContract | null;
  completionSurface?: ReturnType<typeof projectCompletionSurface> | null;
  attempt?: TaskAttempt | null;
  repoScope?: TaskRepoScope | null;
  contractResult: TaskContractResult | null;
  resultMeta: TaskResultMeta | null;
}

function resolveCompletionSurface(task: TaskMetadata | null): ReturnType<typeof projectCompletionSurface> | null {
  const requestedContractId = task?.completionContract?.contractId?.trim();
  if (requestedContractId !== "plan_artifact_v1") {
    return null;
  }

  const loadResult = loadContracts();
  const loaded = loadResult.contracts.find((entry) =>
    entry.contract.id === requestedContractId && entry.contract.contractType === "task"
  );
  if (!loaded) {
    return null;
  }

  try {
    return projectCompletionSurface(loaded.contract);
  } catch (error) {
    logger.warn(
      {
        contractId: requestedContractId,
        error: error instanceof Error ? error.message : String(error),
      },
      "Failed to project task completion surface",
    );
    return null;
  }
}

export function toTaskView(task: TaskRecord): Task {
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
    completionSurface: resolveCompletionSurface(metadata),
    attempt: metadata?.attempt ?? null,
    repoScope: metadata?.repoScope ?? null,
  };
}
