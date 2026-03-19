/**
 * Skill loader — reads skill files from an agent's workspace, validates
 * frontmatter, computes integrity hashes, and matches skills to tasks.
 *
 * Security invariants:
 * - Files opened read-only (O_RDONLY)
 * - Content hash verified before body injection
 * - Skill selection uses AgentTask type, never raw message content
 * - Skills are human-authored in v1 — agents cannot write to skills/
 */

import { z } from "zod";
import * as yaml from "js-yaml";
import { createHash } from "crypto";
import { realpathSync } from "fs";
import { readdir, open } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import type { AgentTask } from "../protocol/types.js";
import { logger } from "../utils/logger.js";

// --- Agent ID safety ---

/**
 * Allowlist regex for agentId values.
 * Reused in the Zod schema and as a runtime guard in loadSkills so there
 * is exactly one source of truth for the pattern.
 */
export const SAFE_AGENT_ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Schema for validating loadSkills / matchSkill inputs at the boundary.
 * Enforces the same agentId allowlist as the runtime guard.
 */
export const LoadSkillsInputSchema = z.object({
  agentId: z.string().regex(SAFE_AGENT_ID_RE),
});

// --- Frontmatter schema ---

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(z.string().min(2)),
  priority: z.number().int().min(0).max(10).optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// --- Skill type ---

export interface Skill {
  frontmatter: SkillFrontmatter;
  body: string;
  hash: string;
  filePath: string;
}

// --- Normalization ---

/**
 * Normalize content for deterministic hashing:
 * 1. Strip BOM
 * 2. Convert \r\n and \r to \n
 * 3. Trim trailing whitespace per line
 */
export function normalizeContent(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/**
 * Compute SHA-256 hash of normalized content.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// --- Frontmatter parser ---

/**
 * Parse YAML frontmatter from a markdown file using js-yaml with CORE_SCHEMA.
 * CORE_SCHEMA (not FAILSAFE_SCHEMA) is required so numeric values like
 * `priority: 5` are parsed as numbers, not strings.
 * Expects --- delimiters at start and end of frontmatter block.
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const rawYaml = match[1];
  const body = match[2];

  const parsed = yaml.load(rawYaml, { schema: yaml.CORE_SCHEMA });
  if (parsed === null || parsed === undefined || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  return { meta: parsed as Record<string, unknown>, body };
}

// --- Loader ---

/**
 * Load all skills from an agent's skills/ directory.
 * Validates frontmatter with Zod, computes integrity hashes.
 * Files are opened read-only.
 */
export async function loadSkills(agentId: string): Promise<Skill[]> {
  if (!SAFE_AGENT_ID_RE.test(agentId)) {
    throw new Error(`Invalid agentId: ${agentId}`);
  }

  const skillsDir = join(homedir(), ".archon", "agents", agentId, "skills");

  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch {
    // No skills directory — not an error, just no skills
    return [];
  }

  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  const skills: Skill[] = [];

  for (const file of mdFiles) {
    const filePath = join(skillsDir, file);

    // Open read-only (O_RDONLY). realpathSync resolves symlinks and throws
    // on dangling symlinks — both must be handled in the same try/catch.
    let rawContent: string;
    let resolvedPath: string;
    try {
      resolvedPath = realpathSync(filePath);
      if (!resolvedPath.startsWith(skillsDir + "/") && resolvedPath !== skillsDir) {
        logger.warn(
          { filePath, resolvedPath, skillsDir },
          "Skill file resolves outside skills dir (symlink escape), skipping"
        );
        continue;
      }

      const fd = await open(resolvedPath, "r");
      try {
        const buffer = await fd.readFile("utf-8");
        rawContent = buffer;
      } finally {
        await fd.close();
      }
    } catch (err) {
      if (err instanceof Error) {
        logger.warn({ err: err.message, filePath }, "Failed to read skill file, skipping");
      } else {
        logger.warn({ err: String(err), filePath }, "Failed to read skill file, skipping");
      }
      continue;
    }

    const normalized = normalizeContent(rawContent);
    const hash = hashContent(normalized);

    const parsed = parseFrontmatter(normalized);
    if (!parsed) {
      logger.warn({ filePath }, "Skill file missing frontmatter (---), skipping");
      continue;
    }

    const result = SkillFrontmatterSchema.safeParse(parsed.meta);
    if (!result.success) {
      logger.warn(
        { filePath, errors: result.error.issues },
        "Skill frontmatter validation failed, skipping"
      );
      continue;
    }

    // Store resolvedPath (not filePath) so verifyAndGetBody re-reads
    // the same resolved target, closing the TOCTOU symlink window.
    skills.push({
      frontmatter: result.data,
      body: parsed.body,
      hash,
      filePath: resolvedPath,
    });
  }

  if (skills.length > 0) {
    logger.info(
      { agentId, skillCount: skills.length, skills: skills.map((s) => s.frontmatter.name) },
      "Skills loaded"
    );
  }

  return skills;
}

// --- Matcher ---

/**
 * Match a task to the best skill by keyword intersection.
 * Returns the highest-priority match; ties broken by filename (alphabetical).
 */
export function matchSkill(task: AgentTask, skills: Skill[]): Skill | null {
  if (skills.length === 0) return null;

  const inputWords = new Set(
    task.input.toLowerCase().split(/\s+/).filter((w) => w.length > 1)
  );

  let bestSkill: Skill | null = null;
  let bestScore = 0;
  let bestPriority = -Infinity;

  for (const skill of skills) {
    const overlap = skill.frontmatter.triggers.filter((t) =>
      inputWords.has(t.toLowerCase())
    ).length;

    if (overlap === 0) continue;

    const priority = skill.frontmatter.priority ?? 0;

    // Lexicographic ordering: (1) higher priority wins, (2) on equal
    // priority higher overlap wins, (3) on equal both, first in sorted
    // array wins (alphabetical filename — skills are pre-sorted).
    if (
      priority > bestPriority ||
      (priority === bestPriority && overlap > bestScore)
    ) {
      bestSkill = skill;
      bestScore = overlap;
      bestPriority = priority;
    }
  }

  return bestSkill;
}

// --- Integrity verification ---

/**
 * Re-verify a skill's content hash before injecting its body.
 * Returns the body if hash matches, null if tampered.
 */
export async function verifyAndGetBody(skill: Skill): Promise<string | null> {
  // Re-resolve to catch symlink swaps between load and verify
  let currentResolved: string;
  try {
    currentResolved = realpathSync(skill.filePath);
  } catch {
    logger.error({ filePath: skill.filePath }, "Skill file no longer accessible");
    return null;
  }
  if (currentResolved !== skill.filePath) {
    logger.error(
      { filePath: skill.filePath, resolved: currentResolved },
      "Skill file path changed after load — possible symlink swap"
    );
    return null;
  }

  let rawContent: string;
  try {
    const fd = await open(skill.filePath, "r");
    try {
      rawContent = await fd.readFile("utf-8");
    } finally {
      await fd.close();
    }
  } catch {
    logger.error({ filePath: skill.filePath }, "Failed to re-read skill for verification");
    return null;
  }

  const normalized = normalizeContent(rawContent);
  const currentHash = hashContent(normalized);

  if (currentHash !== skill.hash) {
    logger.error(
      { filePath: skill.filePath, expected: skill.hash, actual: currentHash },
      "Skill file hash mismatch — file may have been modified at runtime"
    );
    return null;
  }

  return skill.body;
}
