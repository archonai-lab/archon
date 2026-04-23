import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { TaskResultMeta } from "./task-metadata.js";

export const PLAN_ARTIFACT_CONTRACT_ID = "plan_artifact_v1";

const planArtifactOutputSchema = z.object({
  scope: z.string().min(1),
  steps: z.array(z.string().min(1)).min(1),
  risks: z.array(z.string().min(1)),
  verification: z.array(z.string().min(1)).min(1),
}).strict();

export type PlanArtifactOutput = z.infer<typeof planArtifactOutputSchema>;

export interface PlanFinalizeResult {
  artifactPath: string;
  renderedArtifact: string;
  resultMeta: TaskResultMeta;
}

export const taskFinalizeOps = {
  derivePlanArtifactPath(taskId: string): string {
    return `artifacts/tasks/${taskId}/plan.md`;
  },
  resolveArtifactPath(repoRoot: string, relativeArtifactPath: string): string {
    if (!repoRoot.trim()) {
      throw new Error("Finalize requires repoScope.targetRepo");
    }
    if (!isAbsolute(repoRoot)) {
      throw new Error(`Finalize requires an absolute repo root: ${repoRoot}`);
    }

    const resolvedRepoRoot = resolve(repoRoot);
    const resolvedArtifactPath = resolve(resolvedRepoRoot, relativeArtifactPath);
    const rel = relative(resolvedRepoRoot, resolvedArtifactPath);

    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Derived artifact path escapes repo scope: ${resolvedArtifactPath}`);
    }

    return resolvedArtifactPath;
  },
};

export function finalizePlanArtifact(
  repoRoot: string,
  taskId: string,
  output: unknown,
  existingResultMeta?: TaskResultMeta,
): PlanFinalizeResult {
  const parsed = planArtifactOutputSchema.parse(output);
  const artifactPath = taskFinalizeOps.derivePlanArtifactPath(taskId);

  return {
    artifactPath,
    renderedArtifact: renderPlanArtifact(parsed),
    resultMeta: {
      ...(existingResultMeta ?? {}),
      artifactPath: taskFinalizeOps.resolveArtifactPath(repoRoot, artifactPath),
    },
  };
}

export function derivePlanArtifactPath(taskId: string): string {
  return taskFinalizeOps.derivePlanArtifactPath(taskId);
}

export function renderPlanArtifact(output: PlanArtifactOutput): string {
  const risks = output.risks.length > 0
    ? output.risks.map((risk) => `- ${risk}`).join("\n")
    : "- None.";

  const steps = output.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  const verification = output.verification.map((step) => `- ${step}`).join("\n");

  return [
    "# Plan Artifact",
    "",
    "## Scope",
    output.scope,
    "",
    "## Steps",
    steps,
    "",
    "## Risks",
    risks,
    "",
    "## Verification",
    verification,
    "",
  ].join("\n");
}

export function resolveArtifactPath(repoRoot: string, relativeArtifactPath: string): string {
  return taskFinalizeOps.resolveArtifactPath(repoRoot, relativeArtifactPath);
}

export async function persistArtifact(repoRoot: string, relativeArtifactPath: string, content: string): Promise<void> {
  const artifactPath = resolveArtifactPath(repoRoot, relativeArtifactPath);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf-8");
}

export async function removeArtifact(repoRoot: string, relativeArtifactPath: string): Promise<void> {
  const artifactPath = resolveArtifactPath(repoRoot, relativeArtifactPath);
  await rm(artifactPath, { force: true });
}
