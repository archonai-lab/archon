import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import {
  agents,
  agentDepartments,
  permissions,
} from "../db/schema.js";
import { hasPermission } from "../hub/permissions.js";
import { generateAgentCard } from "./agent-card.js";
import { assignAgentToDepartment } from "./agent-registry.js";
import { logger } from "../utils/logger.js";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// --- Types ---

export interface CreateAgentOpts {
  name: string;
  displayName: string;
  departments?: Array<{ departmentId: string; roleId: string }>;
  role?: string;
  modelConfig?: Record<string, unknown>;
}

export interface UpdateAgentOpts {
  displayName?: string;
  departments?: Array<{ departmentId: string; roleId: string }>;
  modelConfig?: Record<string, unknown>;
}

// --- Permission check ---

export async function canManageAgents(agentId: string): Promise<boolean> {
  return hasPermission(agentId, "agent:*", "manage");
}

// --- CRUD ---

export async function createAgentFull(
  requesterId: string,
  opts: CreateAgentOpts
): Promise<{ ok: true; agent: typeof agents.$inferSelect } | { ok: false; error: string }> {
  const allowed = await canManageAgents(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied: only admin/CEO can create agents" };

  // Check for duplicate ID
  const existing = await db.query.agents.findFirst({
    where: eq(agents.id, opts.name),
  });
  if (existing) return { ok: false, error: `Agent "${opts.name}" already exists` };

  // Create workspace directory
  const workspacePath = join(homedir(), ".archon", "agents", opts.name);
  try {
    await mkdir(workspacePath, { recursive: true });
  } catch (err) {
    logger.error({ err, workspacePath }, "Failed to create agent workspace");
    return { ok: false, error: "Failed to create agent workspace" };
  }

  // Generate default IDENTITY.md and SOUL.md
  const identityContent = `# ${opts.displayName}

## Description
${opts.role ?? "An AI agent in the Archon platform."}

## Version
1.0.0
`;

  const soulContent = `# ${opts.displayName} — Soul

## Personality
Professional, collaborative, and focused.

## Strengths
- Collaborative problem-solving
- Clear communication

## Weaknesses
- New to the team

## Communication Style
Direct and respectful.
`;

  try {
    await writeFile(join(workspacePath, "IDENTITY.md"), identityContent, "utf-8");
    await writeFile(join(workspacePath, "SOUL.md"), soulContent, "utf-8");
  } catch (err) {
    logger.error({ err }, "Failed to write agent template files");
  }

  // Insert into database
  const [agent] = await db
    .insert(agents)
    .values({
      id: opts.name,
      displayName: opts.displayName,
      workspacePath,
      modelConfig: opts.modelConfig ?? null,
    })
    .returning();

  // Assign departments if provided
  if (opts.departments) {
    for (const dept of opts.departments) {
      await assignAgentToDepartment(opts.name, dept.departmentId, dept.roleId);
    }
  }

  // Generate agent card
  await generateAgentCard(opts.name);

  logger.info({ agentId: opts.name, requester: requesterId }, "Agent created via protocol");
  return { ok: true, agent };
}

export async function updateAgentFull(
  requesterId: string,
  agentId: string,
  opts: UpdateAgentOpts
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await canManageAgents(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied: only admin/CEO can update agents" };

  const existing = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });
  if (!existing) return { ok: false, error: `Agent "${agentId}" not found` };

  // Build update set
  const updateSet: Record<string, unknown> = { updatedAt: new Date() };
  if (opts.displayName) updateSet.displayName = opts.displayName;
  if (opts.modelConfig) updateSet.modelConfig = opts.modelConfig;

  await db.update(agents).set(updateSet).where(eq(agents.id, agentId));

  // Update department assignments if provided
  if (opts.departments) {
    // Remove existing assignments
    await db.delete(agentDepartments).where(eq(agentDepartments.agentId, agentId));
    // Re-assign
    for (const dept of opts.departments) {
      await assignAgentToDepartment(agentId, dept.departmentId, dept.roleId);
    }
  }

  // Invalidate agent card so it regenerates
  await db.update(agents).set({ agentCard: null }).where(eq(agents.id, agentId));

  logger.info({ agentId, requester: requesterId }, "Agent updated via protocol");
  return { ok: true };
}

export async function reactivateAgentFull(
  requesterId: string,
  agentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await canManageAgents(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied: only admin/CEO can reactivate agents" };

  const existing = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });
  if (!existing) return { ok: false, error: `Agent "${agentId}" not found` };
  if (existing.status === "active") return { ok: false, error: `Agent "${agentId}" is already active` };

  await db
    .update(agents)
    .set({ status: "active", agentCard: null, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  // Regenerate agent card
  await generateAgentCard(agentId);

  logger.info({ agentId, requester: requesterId }, "Agent reactivated via protocol");
  return { ok: true };
}

export async function deleteAgentFull(
  requesterId: string,
  agentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await canManageAgents(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied: only admin/CEO can delete agents" };

  const existing = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });
  if (!existing) return { ok: false, error: `Agent "${agentId}" not found` };

  // Soft-delete: set status to deactivated and clear memberships
  await db.delete(agentDepartments).where(eq(agentDepartments.agentId, agentId));
  await db.delete(permissions).where(eq(permissions.agentId, agentId));
  await db
    .update(agents)
    .set({ status: "deactivated", agentCard: null, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  logger.info({ agentId, requester: requesterId }, "Agent deactivated via protocol");
  return { ok: true };
}
