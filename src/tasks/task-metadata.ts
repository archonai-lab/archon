import { z } from "zod";

export interface TaskCompletionContract {
  taskType?: string | null;
  deliverableKind?: string | null;
  artifactRequired?: boolean;
  requiredArtifacts?: string[];
  changedFilesRequired?: boolean;
  verificationRequired?: boolean;
  requiredVerification?: string[];
  requiredSections?: string[];
  findingsOrNoFindingsRequired?: boolean;
  semanticGateRequired?: boolean;
  humanAcceptanceRequired?: boolean;
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

export const taskCompletionContractSchema = z.object({
  taskType: z.string().min(1).optional(),
  deliverableKind: z.string().min(1).optional(),
  artifactRequired: z.boolean().optional(),
  requiredArtifacts: z.array(z.string().min(1)).optional(),
  changedFilesRequired: z.boolean().optional(),
  verificationRequired: z.boolean().optional(),
  requiredVerification: z.array(z.string().min(1)).optional(),
  requiredSections: z.array(z.string().min(1)).optional(),
  findingsOrNoFindingsRequired: z.boolean().optional(),
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

export const taskMetadataSchema = z.object({
  taskType: z.string().min(1).optional(),
  completionContract: taskCompletionContractSchema.optional(),
  attempt: taskAttemptSchema.optional(),
  repoScope: taskRepoScopeSchema.optional(),
}).strict();

export function normalizeTaskMetadata(
  metadata: unknown,
): TaskMetadata | null {
  if (metadata == null) return null;
  const parsed = taskMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}
