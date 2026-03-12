import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, departments, roles, agentDepartments, permissions } from "../../src/db/schema.js";
import {
  listDepartments, createDepartmentFull, updateDepartmentFull, deleteDepartmentFull,
  listRoles, createRoleFull, updateRoleFull, deleteRoleFull,
} from "../../src/registry/department-crud.js";
import { grantPermission } from "../../src/hub/permissions.js";

const ADMIN = "dept-crud-admin";
const REGULAR = "dept-crud-regular";
let createdDeptId = "";
let createdRoleId = "";

beforeAll(async () => {
  await db.insert(agents).values({
    id: ADMIN,
    displayName: "Dept Admin",
    workspacePath: "/tmp/dept-admin",
  }).onConflictDoNothing();

  await grantPermission(ADMIN, "agent:*", "manage");

  await db.insert(agents).values({
    id: REGULAR,
    displayName: "Dept Regular",
    workspacePath: "/tmp/dept-regular",
  }).onConflictDoNothing();
});

afterAll(async () => {
  // Clean up
  if (createdRoleId) {
    await db.delete(agentDepartments).where(eq(agentDepartments.roleId, createdRoleId));
    await db.delete(roles).where(eq(roles.id, createdRoleId));
  }
  if (createdDeptId) {
    await db.delete(departments).where(eq(departments.id, createdDeptId));
  }
  await db.delete(permissions).where(eq(permissions.agentId, ADMIN));
  await db.delete(agents).where(eq(agents.id, ADMIN));
  await db.delete(agents).where(eq(agents.id, REGULAR));
  await closeConnection();
});

describe("Department CRUD", () => {
  it("should create a department", async () => {
    const result = await createDepartmentFull(ADMIN, "Test Engineering", "For testing");
    expect(result.ok).toBe(true);
    if (result.ok) {
      createdDeptId = result.department.id;
      expect(result.department.name).toBe("Test Engineering");
      expect(result.department.description).toBe("For testing");
    }
  });

  it("should reject creation from non-admin", async () => {
    const result = await createDepartmentFull(REGULAR, "Should Not Exist");
    expect(result.ok).toBe(false);
  });

  it("should list departments", async () => {
    const depts = await listDepartments();
    const found = depts.find((d) => d.id === createdDeptId);
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test Engineering");
  });

  it("should update a department", async () => {
    const result = await updateDepartmentFull(ADMIN, createdDeptId, {
      name: "Updated Engineering",
      description: "Updated desc",
    });
    expect(result.ok).toBe(true);

    const dept = await db.query.departments.findFirst({
      where: eq(departments.id, createdDeptId),
    });
    expect(dept!.name).toBe("Updated Engineering");
  });

  it("should return error for non-existent department", async () => {
    const result = await updateDepartmentFull(ADMIN, "nonexistent", { name: "nope" });
    expect(result.ok).toBe(false);
  });
});

describe("Role CRUD", () => {
  it("should create a role in a department", async () => {
    const result = await createRoleFull(ADMIN, createdDeptId, "Lead Engineer");
    expect(result.ok).toBe(true);
    if (result.ok) {
      createdRoleId = result.role.id;
      expect(result.role.name).toBe("Lead Engineer");
      expect(result.role.departmentId).toBe(createdDeptId);
    }
  });

  it("should reject role creation for non-existent department", async () => {
    const result = await createRoleFull(ADMIN, "nonexistent-dept", "Nope");
    expect(result.ok).toBe(false);
  });

  it("should list roles", async () => {
    const allRoles = await listRoles();
    const found = allRoles.find((r) => r.id === createdRoleId);
    expect(found).toBeDefined();
  });

  it("should list roles filtered by department", async () => {
    const deptRoles = await listRoles(createdDeptId);
    expect(deptRoles.some((r) => r.id === createdRoleId)).toBe(true);
  });

  it("should update a role", async () => {
    const result = await updateRoleFull(ADMIN, createdRoleId, { name: "Staff Engineer" });
    expect(result.ok).toBe(true);

    const role = await db.query.roles.findFirst({
      where: eq(roles.id, createdRoleId),
    });
    expect(role!.name).toBe("Staff Engineer");
  });

  it("should delete department and cascade", async () => {
    const result = await deleteDepartmentFull(ADMIN, createdDeptId);
    expect(result.ok).toBe(true);

    // Roles should be removed too
    const remainingRoles = await db.query.roles.findMany({
      where: eq(roles.departmentId, createdDeptId),
    });
    expect(remainingRoles).toHaveLength(0);

    // Prevent afterAll from trying to delete already-deleted resources
    createdDeptId = "";
    createdRoleId = "";
  });
});
