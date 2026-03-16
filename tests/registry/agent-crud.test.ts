import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, departments, roles, agentDepartments, permissions } from "../../src/db/schema.js";
import { createAgentFull, updateAgentFull, deleteAgentFull, enrichAgentIdentity, canManageAgents } from "../../src/registry/agent-crud.js";
import { readFile } from "node:fs/promises";
import { grantPermission } from "../../src/hub/permissions.js";

const ADMIN_AGENT = "crud-test-admin";
const REGULAR_AGENT = "crud-test-regular";
const TARGET_AGENT = "crud-test-target";
const TEST_DEPT = "crud-test-dept";
const TEST_ROLE = "crud-test-role";

beforeAll(async () => {
  // Create admin agent with manage permission
  await db.insert(agents).values({
    id: ADMIN_AGENT,
    displayName: "Admin Agent",
    workspacePath: "/tmp/crud-test-admin",
  }).onConflictDoNothing();

  await grantPermission(ADMIN_AGENT, "agent:*", "manage");

  // Create regular agent without manage permission
  await db.insert(agents).values({
    id: REGULAR_AGENT,
    displayName: "Regular Agent",
    workspacePath: "/tmp/crud-test-regular",
  }).onConflictDoNothing();

  // Create a department and role for assignment tests
  await db.insert(departments).values({
    id: TEST_DEPT,
    name: "CRUD Test Dept",
  }).onConflictDoNothing();

  await db.insert(roles).values({
    id: TEST_ROLE,
    departmentId: TEST_DEPT,
    name: "Test Role",
    permissions: [],
  }).onConflictDoNothing();
});

afterAll(async () => {
  // Clean up all test data
  await db.delete(agentDepartments).where(eq(agentDepartments.agentId, TARGET_AGENT));
  await db.delete(permissions).where(eq(permissions.agentId, ADMIN_AGENT));
  await db.delete(permissions).where(eq(permissions.agentId, REGULAR_AGENT));
  await db.delete(permissions).where(eq(permissions.agentId, TARGET_AGENT));
  await db.delete(agents).where(eq(agents.id, TARGET_AGENT));
  await db.delete(agents).where(eq(agents.id, ADMIN_AGENT));
  await db.delete(agents).where(eq(agents.id, REGULAR_AGENT));
  await db.delete(roles).where(eq(roles.id, TEST_ROLE));
  await db.delete(departments).where(eq(departments.id, TEST_DEPT));
  await closeConnection();
});

describe("Agent CRUD", () => {
  describe("canManageAgents", () => {
    it("should return true for admin agent", async () => {
      expect(await canManageAgents(ADMIN_AGENT)).toBe(true);
    });

    it("should return false for regular agent", async () => {
      expect(await canManageAgents(REGULAR_AGENT)).toBe(false);
    });
  });

  describe("createAgentFull", () => {
    it("should create an agent when called by admin", async () => {
      const result = await createAgentFull(ADMIN_AGENT, {
        name: TARGET_AGENT,
        displayName: "Test Target Agent",
        role: "QA Tester",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.agent.id).toBe(TARGET_AGENT);
        expect(result.agent.displayName).toBe("Test Target Agent");
      }

      // Verify agent exists in DB
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, TARGET_AGENT),
      });
      expect(agent).toBeDefined();
      expect(agent!.displayName).toBe("Test Target Agent");
    });

    it("should reject creation from non-admin", async () => {
      const result = await createAgentFull(REGULAR_AGENT, {
        name: "should-not-exist",
        displayName: "Should Not Exist",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Permission denied");
      }
    });

    it("should reject duplicate agent name", async () => {
      const result = await createAgentFull(ADMIN_AGENT, {
        name: TARGET_AGENT,
        displayName: "Duplicate",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("already exists");
      }
    });

    it("should assign departments during creation", async () => {
      // Delete the target agent first, then recreate with departments
      await db.delete(agents).where(eq(agents.id, TARGET_AGENT));

      const result = await createAgentFull(ADMIN_AGENT, {
        name: TARGET_AGENT,
        displayName: "Target With Dept",
        departments: [{ departmentId: TEST_DEPT, roleId: TEST_ROLE }],
      });

      expect(result.ok).toBe(true);

      // Verify department assignment
      const assignments = await db.query.agentDepartments.findMany({
        where: eq(agentDepartments.agentId, TARGET_AGENT),
      });
      expect(assignments).toHaveLength(1);
      expect(assignments[0].departmentId).toBe(TEST_DEPT);
      expect(assignments[0].roleId).toBe(TEST_ROLE);
    });
  });

  describe("updateAgentFull", () => {
    it("should update display name when called by admin", async () => {
      const result = await updateAgentFull(ADMIN_AGENT, TARGET_AGENT, {
        displayName: "Updated Name",
      });

      expect(result.ok).toBe(true);

      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, TARGET_AGENT),
      });
      expect(agent!.displayName).toBe("Updated Name");
    });

    it("should reject update from non-admin", async () => {
      const result = await updateAgentFull(REGULAR_AGENT, TARGET_AGENT, {
        displayName: "Should Not Update",
      });

      expect(result.ok).toBe(false);
    });

    it("should return error for non-existent agent", async () => {
      const result = await updateAgentFull(ADMIN_AGENT, "nonexistent-agent", {
        displayName: "Nope",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("not found");
      }
    });
  });

  describe("deleteAgentFull", () => {
    it("should reject deletion from non-admin", async () => {
      const result = await deleteAgentFull(REGULAR_AGENT, TARGET_AGENT);
      expect(result.ok).toBe(false);
    });

    it("should soft-delete agent (set offline, clear memberships)", async () => {
      const result = await deleteAgentFull(ADMIN_AGENT, TARGET_AGENT);
      expect(result.ok).toBe(true);

      // Agent should still exist but be offline
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, TARGET_AGENT),
      });
      expect(agent).toBeDefined();
      expect(agent!.status).toBe("deactivated");

      // Department assignments should be removed
      const assignments = await db.query.agentDepartments.findMany({
        where: eq(agentDepartments.agentId, TARGET_AGENT),
      });
      expect(assignments).toHaveLength(0);
    });

    it("should return error for non-existent agent", async () => {
      const result = await deleteAgentFull(ADMIN_AGENT, "nonexistent-agent");
      expect(result.ok).toBe(false);
    });
  });

  describe("enrichAgentIdentity", () => {
    const ENRICH_AGENT = "crud-test-enrich";

    beforeAll(async () => {
      // Recreate a fresh agent for enrichment tests
      await db.delete(agents).where(eq(agents.id, ENRICH_AGENT));
      await createAgentFull(ADMIN_AGENT, {
        name: ENRICH_AGENT,
        displayName: "Enrich Test Agent",
      });
    });

    afterAll(async () => {
      await db.delete(agents).where(eq(agents.id, ENRICH_AGENT));
    });

    it("should overwrite IDENTITY.md when identity is provided", async () => {
      const identity = "# Custom Identity\n\n- **Name**: Sentinel\n- **Title**: Security Specialist";
      const result = await enrichAgentIdentity(ADMIN_AGENT, ENRICH_AGENT, { identity });

      expect(result.ok).toBe(true);

      // Verify file was written
      const agent = await db.query.agents.findFirst({ where: eq(agents.id, ENRICH_AGENT) });
      const content = await readFile(`${agent!.workspacePath}/IDENTITY.md`, "utf-8");
      expect(content).toBe(identity);
    });

    it("should overwrite SOUL.md when soul is provided", async () => {
      const soul = "# Soul\n\n## Personality\nParanoid and aggressive.";
      const result = await enrichAgentIdentity(ADMIN_AGENT, ENRICH_AGENT, { soul });

      expect(result.ok).toBe(true);

      const agent = await db.query.agents.findFirst({ where: eq(agents.id, ENRICH_AGENT) });
      const content = await readFile(`${agent!.workspacePath}/SOUL.md`, "utf-8");
      expect(content).toBe(soul);
    });

    it("should invalidate agent card after enrichment", async () => {
      const result = await enrichAgentIdentity(ADMIN_AGENT, ENRICH_AGENT, {
        identity: "# Updated Identity",
      });

      expect(result.ok).toBe(true);

      // Agent card should have been regenerated (not null)
      const agent = await db.query.agents.findFirst({ where: eq(agents.id, ENRICH_AGENT) });
      expect(agent!.agentCard).not.toBeNull();
    });

    it("should reject enrichment from non-admin", async () => {
      const result = await enrichAgentIdentity(REGULAR_AGENT, ENRICH_AGENT, {
        identity: "# Hacked Identity",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("Permission denied");
    });

    it("should reject enrichment for non-existent agent", async () => {
      const result = await enrichAgentIdentity(ADMIN_AGENT, "nonexistent-agent", {
        identity: "# Nope",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("not found");
    });

    it("should reject when neither identity nor soul is provided", async () => {
      const result = await enrichAgentIdentity(ADMIN_AGENT, ENRICH_AGENT, {});

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("at least one");
    });
  });
});
