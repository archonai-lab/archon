import { db, closeConnection } from "./connection.js";
import { departments, roles, agents, agentDepartments, permissions } from "./schema.js";
import { logger } from "../utils/logger.js";

async function seed(): Promise<void> {
  logger.info("Seeding database...");

  // --- Departments ---
  await db
    .insert(departments)
    .values([
      { id: "executive", name: "Executive", description: "Company leadership and strategy" },
      { id: "engineering", name: "Engineering", description: "Software development and architecture" },
      { id: "research", name: "Research", description: "Research and experimentation" },
    ])
    .onConflictDoNothing();

  // --- Roles ---
  await db
    .insert(roles)
    .values([
      {
        id: "ceo",
        departmentId: "executive",
        name: "Chief Executive Officer",
        permissions: ["admin", "create_agent", "create_department", "create_meeting", "assign_role"],
      },
      {
        id: "lead_dev",
        departmentId: "engineering",
        name: "Lead Developer",
        permissions: ["create_meeting", "view_agents"],
      },
      {
        id: "researcher",
        departmentId: "research",
        name: "Researcher",
        permissions: ["create_meeting", "view_agents"],
      },
    ])
    .onConflictDoNothing();

  // --- CEO Agent ---
  await db
    .insert(agents)
    .values({
      id: "ceo",
      displayName: "CEO",
      workspacePath: "~/.archon/agents/ceo",
      status: "offline",
      modelConfig: { provider: "acpx", backend: "claude-code" },
    })
    .onConflictDoNothing();

  // --- CEO → Executive department ---
  await db
    .insert(agentDepartments)
    .values({
      agentId: "ceo",
      departmentId: "executive",
      roleId: "ceo",
    })
    .onConflictDoNothing();

  // --- Demo agents for testing ---
  await db
    .insert(agents)
    .values([
      {
        id: "alice",
        displayName: "Alice",
        workspacePath: "~/.archon/agents/alice",
        status: "offline",
      },
      {
        id: "bob",
        displayName: "Bob",
        workspacePath: "~/.archon/agents/bob",
        status: "offline",
      },
    ])
    .onConflictDoNothing();

  // --- Demo agents → Engineering department ---
  await db
    .insert(agentDepartments)
    .values([
      { agentId: "alice", departmentId: "engineering", roleId: "lead_dev" },
      { agentId: "bob", departmentId: "engineering", roleId: "lead_dev" },
    ])
    .onConflictDoNothing();

  // --- CEO admin permissions ---
  const existingPerms = await db.query.permissions.findFirst({
    where: (p, { eq }) => eq(p.agentId, "ceo"),
  });
  if (!existingPerms) {
    await db.insert(permissions).values([
      { agentId: "ceo", resource: "agent:*", action: "admin" },
      { agentId: "ceo", resource: "department:*", action: "admin" },
      { agentId: "ceo", resource: "meeting:*", action: "admin" },
    ]);
  }

  logger.info("Seed complete");
}

seed()
  .then(() => closeConnection())
  .catch((error) => {
    logger.fatal({ error }, "Seed failed");
    process.exit(1);
  });
