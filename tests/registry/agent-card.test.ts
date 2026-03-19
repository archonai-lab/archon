import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeConnection } from "../../src/db/connection.js";
import {
  agents,
  departments,
  roles,
  agentDepartments,
} from "../../src/db/schema.js";
import { generateAgentCard, getAgentCard } from "../../src/registry/agent-card.js";

const TEST_AGENT_ID = "card-test-agent";
const TEST_DEPT_ID = "card-test-dept";
const TEST_ROLE_ID = "card-test-role";

beforeAll(async () => {
  // Set up test data
  await db.insert(departments).values({
    id: TEST_DEPT_ID,
    name: "Card Test Dept",
    description: "For testing agent cards",
  }).onConflictDoNothing();

  await db.insert(roles).values({
    id: TEST_ROLE_ID,
    departmentId: TEST_DEPT_ID,
    name: "Card Tester",
    permissions: ["view_agents"],
  }).onConflictDoNothing();

  await db.insert(agents).values({
    id: TEST_AGENT_ID,
    displayName: "Card Test Agent",
    workspacePath: "/nonexistent/path",
    status: "active",
    modelConfig: { provider: "acpx", backend: "claude-code" },
  }).onConflictDoNothing();

  await db.insert(agentDepartments).values({
    agentId: TEST_AGENT_ID,
    departmentId: TEST_DEPT_ID,
    roleId: TEST_ROLE_ID,
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(agentDepartments).where(eq(agentDepartments.agentId, TEST_AGENT_ID));
  await db.delete(agents).where(eq(agents.id, TEST_AGENT_ID));
  await db.delete(roles).where(eq(roles.id, TEST_ROLE_ID));
  await db.delete(departments).where(eq(departments.id, TEST_DEPT_ID));
  await closeConnection();
});

describe("Agent Card", () => {
  it("should generate a card with DB data", async () => {
    const card = await generateAgentCard(TEST_AGENT_ID);

    expect(card).not.toBeNull();
    expect(card!.id).toBe(TEST_AGENT_ID);
    expect(card!.displayName).toBe("Card Test Agent");
    expect(card!.departments).toHaveLength(1);
    expect(card!.departments[0]).toMatchObject({
      id: TEST_DEPT_ID,
      name: "Card Test Dept",
      role: { id: TEST_ROLE_ID, name: "Card Tester" },
    });
    expect(card!.model).toMatchObject({
      provider: "acpx",
      backend: "claude-code",
    });
  });

  it("should return null for nonexistent agent", async () => {
    const card = await generateAgentCard("nonexistent");
    expect(card).toBeNull();
  });

  it("should cache and return cached card", async () => {
    // Generate to populate cache
    await generateAgentCard(TEST_AGENT_ID);

    // Get should return cached
    const card = await getAgentCard(TEST_AGENT_ID);
    expect(card).not.toBeNull();
    expect(card!.id).toBe(TEST_AGENT_ID);
  });

  it("should reflect live status on cached card", async () => {
    await generateAgentCard(TEST_AGENT_ID);

    // Update status to deactivated
    await db
      .update(agents)
      .set({ status: "deactivated" })
      .where(eq(agents.id, TEST_AGENT_ID));

    const card = await getAgentCard(TEST_AGENT_ID);
    expect(card!.status).toBe("deactivated");

    // Reset for other tests
    await db
      .update(agents)
      .set({ status: "active" })
      .where(eq(agents.id, TEST_AGENT_ID));
  });

  it("should generate card for CEO with workspace files", async () => {
    // CEO was seeded with workspace pointing to agents/ceo/
    // Update CEO workspace to point to repo templates
    const ceoWorkspace = process.cwd() + "/defaults/agents/ceo";
    await db
      .update(agents)
      .set({ workspacePath: ceoWorkspace, agentCard: null })
      .where(eq(agents.id, "ceo"));

    const card = await generateAgentCard("ceo");
    expect(card).not.toBeNull();
    expect(card!.id).toBe("ceo");
    expect(card!.characteristics.strengths.length).toBeGreaterThan(0);
    expect(card!.characteristics.personality.length).toBeGreaterThan(0);
    expect(card!.skills.length).toBeGreaterThan(0);
  });
});
