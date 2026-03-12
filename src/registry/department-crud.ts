import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db/connection.js";
import {
  departments,
  roles,
  agentDepartments,
} from "../db/schema.js";
import { hasPermission } from "../hub/permissions.js";
import { logger } from "../utils/logger.js";

// --- Permission check ---

async function canManageOrg(agentId: string): Promise<boolean> {
  return hasPermission(agentId, "agent:*", "manage");
}

// --- Department CRUD ---

export async function listDepartments() {
  return db.query.departments.findMany();
}

export async function createDepartmentFull(
  requesterId: string,
  name: string,
  description?: string
): Promise<{ ok: true; department: typeof departments.$inferSelect } | { ok: false; error: string }> {
  const allowed = await canManageOrg(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied" };

  const id = nanoid(12);
  const [dept] = await db
    .insert(departments)
    .values({ id, name, description: description ?? null })
    .returning();

  logger.info({ departmentId: id, requester: requesterId }, "Department created");
  return { ok: true, department: dept };
}

export async function updateDepartmentFull(
  requesterId: string,
  departmentId: string,
  opts: { name?: string; description?: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await canManageOrg(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied" };

  const existing = await db.query.departments.findFirst({
    where: eq(departments.id, departmentId),
  });
  if (!existing) return { ok: false, error: `Department "${departmentId}" not found` };

  const updateSet: Record<string, unknown> = {};
  if (opts.name) updateSet.name = opts.name;
  if (opts.description !== undefined) updateSet.description = opts.description;

  if (Object.keys(updateSet).length > 0) {
    await db.update(departments).set(updateSet).where(eq(departments.id, departmentId));
  }

  logger.info({ departmentId, requester: requesterId }, "Department updated");
  return { ok: true };
}

export async function deleteDepartmentFull(
  requesterId: string,
  departmentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await canManageOrg(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied" };

  // Remove agent assignments first
  await db.delete(agentDepartments).where(eq(agentDepartments.departmentId, departmentId));
  // Remove roles in this department
  await db.delete(roles).where(eq(roles.departmentId, departmentId));
  // Remove department
  await db.delete(departments).where(eq(departments.id, departmentId));

  logger.info({ departmentId, requester: requesterId }, "Department deleted");
  return { ok: true };
}

// --- Role CRUD ---

export async function listRoles(departmentId?: string) {
  if (departmentId) {
    return db.query.roles.findMany({
      where: eq(roles.departmentId, departmentId),
    });
  }
  return db.query.roles.findMany();
}

export async function createRoleFull(
  requesterId: string,
  departmentId: string,
  name: string,
  rolePermissions?: string[]
): Promise<{ ok: true; role: typeof roles.$inferSelect } | { ok: false; error: string }> {
  const allowed = await canManageOrg(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied" };

  // Verify department exists
  const dept = await db.query.departments.findFirst({
    where: eq(departments.id, departmentId),
  });
  if (!dept) return { ok: false, error: `Department "${departmentId}" not found` };

  const id = nanoid(12);
  const [role] = await db
    .insert(roles)
    .values({
      id,
      departmentId,
      name,
      permissions: rolePermissions ?? [],
    })
    .returning();

  logger.info({ roleId: id, departmentId, requester: requesterId }, "Role created");
  return { ok: true, role };
}

export async function updateRoleFull(
  requesterId: string,
  roleId: string,
  opts: { name?: string; permissions?: string[] }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await canManageOrg(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied" };

  const existing = await db.query.roles.findFirst({
    where: eq(roles.id, roleId),
  });
  if (!existing) return { ok: false, error: `Role "${roleId}" not found` };

  const updateSet: Record<string, unknown> = {};
  if (opts.name) updateSet.name = opts.name;
  if (opts.permissions) updateSet.permissions = opts.permissions;

  if (Object.keys(updateSet).length > 0) {
    await db.update(roles).set(updateSet).where(eq(roles.id, roleId));
  }

  logger.info({ roleId, requester: requesterId }, "Role updated");
  return { ok: true };
}

export async function deleteRoleFull(
  requesterId: string,
  roleId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await canManageOrg(requesterId);
  if (!allowed) return { ok: false, error: "Permission denied" };

  // Remove agent assignments referencing this role
  await db.delete(agentDepartments).where(eq(agentDepartments.roleId, roleId));
  await db.delete(roles).where(eq(roles.id, roleId));

  logger.info({ roleId, requester: requesterId }, "Role deleted");
  return { ok: true };
}
