import { z } from "zod";

export interface TaskCompletionContract {
  taskType?: string | null;
  deliverableKind?: string | null;
  contractId?: string | null;
  input?: Record<string, unknown> | null;
  output?: TaskOutputContract | null;
  semanticGateRequired?: boolean;
  humanAcceptanceRequired?: boolean;
}

export interface TaskOutputContract {
  description?: string | null;
  requiredFields?: string[];
  fields?: Record<string, TaskOutputFieldContract>;
}

export interface TaskOutputFieldContract {
  description?: string | null;
  type?: "string" | "string_array" | "array" | "object" | "boolean" | "number";
  required?: boolean;
  nonEmpty?: boolean;
  equalsInput?: string;
  includesInput?: string;
  pathExists?: boolean;
  minBytes?: number;
  fileIncludes?: string[];
  rejectNegative?: boolean;
}

export interface TaskAttempt {
  number?: number;
  kind?: string | null;
  previousTaskId?: string | null;
}

export interface TaskRepoScope {
  targetRepo?: string | null;
  relatedRepos?: string[];
  crossRepoPolicy?: string | null;
}

export interface TaskMetadata {
  taskType?: string | null;
  completionContract?: TaskCompletionContract | null;
  attempt?: TaskAttempt | null;
  repoScope?: TaskRepoScope | null;
}

export interface TaskContractResult {
  contractId: string;
  output: Record<string, unknown>;
}

export type TaskCompletionTelemetry = {
  classifierState: string;
  salvageCount?: number;
  salvageBudget?: number;
  finalDisposition: string;
} & Record<string, unknown>;

export type TaskResultMeta = {
  completion?: string | TaskCompletionTelemetry;
} & Record<string, unknown>;

export const taskCompletionContractSchema = z.object({
  taskType: z.string().min(1).optional(),
  deliverableKind: z.string().min(1).optional(),
  contractId: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.object({
    description: z.string().min(1).optional(),
    requiredFields: z.array(z.string().min(1)).optional(),
    fields: z.record(z.string(), z.object({
      description: z.string().min(1).optional(),
      type: z.enum(["string", "string_array", "array", "object", "boolean", "number"]).optional(),
      required: z.boolean().optional(),
      nonEmpty: z.boolean().optional(),
      equalsInput: z.string().min(1).optional(),
      includesInput: z.string().min(1).optional(),
      pathExists: z.boolean().optional(),
      minBytes: z.number().int().min(0).optional(),
      fileIncludes: z.array(z.string().min(1)).optional(),
      rejectNegative: z.boolean().optional(),
    }).strict()).optional(),
  }).strict().optional(),
  semanticGateRequired: z.boolean().optional(),
  humanAcceptanceRequired: z.boolean().optional(),
}).strict();

export const taskAttemptSchema = z.object({
  number: z.number().int().positive().optional(),
  kind: z.string().min(1).optional(),
  previousTaskId: z.string().min(1).optional(),
}).strict();

export const taskRepoScopeSchema = z.object({
  targetRepo: z.string().min(1).optional(),
  relatedRepos: z.array(z.string().min(1)).optional(),
  crossRepoPolicy: z.string().min(1).optional(),
}).strict();

export const taskCompletionTelemetrySchema = z.object({
  classifierState: z.string().min(1),
  salvageCount: z.number().int().min(0).optional(),
  salvageBudget: z.number().int().min(0).optional(),
  finalDisposition: z.string().min(1),
}).catchall(z.unknown());

export const taskResultMetaSchema = z.object({
  completion: z.union([
    z.string().min(1),
    taskCompletionTelemetrySchema,
  ]).optional(),
}).catchall(z.unknown());

export const taskMetadataSchema = z.object({
  taskType: z.string().min(1).optional(),
  completionContract: taskCompletionContractSchema.optional(),
  attempt: taskAttemptSchema.optional(),
  repoScope: taskRepoScopeSchema.optional(),
}).strict();

export function normalizeTaskMetadata(metadata: unknown): TaskMetadata | null {
  if (metadata == null) return null;
  const parsed = taskMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}
