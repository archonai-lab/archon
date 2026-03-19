/**
 * Archon CLI — agent management from the command line.
 *
 * Usage:
 *   npx tsx scripts/cli.ts agent add <path> [options]
 *   npx tsx scripts/cli.ts agent list
 *
 * Examples:
 *   npx tsx scripts/cli.ts agent add ~/.archon/agents/sherlock
 *   npx tsx scripts/cli.ts agent add ./agents/sable --provider cli-claude --model sonnet
 *   npx tsx scripts/cli.ts agent list
 */

import { existsSync, readFileSync } from "fs";
import { resolve, basename } from "path";
import { realpathSync } from "fs";
import { eq } from "drizzle-orm";
import { db, closeConnection } from "../src/db/connection.js";
import { agents, agentDepartments, departments, roles } from "../src/db/schema.js";
import { generateAgentCard } from "../src/registry/agent-card.js";

// --- CLI arg parsing ---

const args = process.argv.slice(2);
const command = args[0]; // "agent"
const subcommand = args[1]; // "add", "list"

function getFlag(flag: string, fallback?: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return fallback;
}

function printUsage(): void {
  console.log(`
Archon CLI — Agent Management

Usage:
  archon agent add <path> [options]   Register an agent from a workspace directory
  archon agent list                   List all registered agents

Options for 'agent add':
  --provider <provider>   LLM provider (default: cli-claude)
  --model <model>         LLM model name
  --department <id>       Department ID to assign
  --role <id>             Role ID for department assignment

Examples:
  archon agent add ~/.archon/agents/sherlock
  archon agent add ./my-agent --provider openai --model gpt-4
  archon agent list
`);
}

// --- Parse IDENTITY.md ---

interface ParsedIdentity {
  name: string;
  displayName: string;
}

function parseIdentityFile(path: string): ParsedIdentity | null {
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      const match = line.match(/^-\s*\*\*Name\*\*:\s*(.+)$/i);
      if (match) {
        const displayName = match[1].trim();
        const name = displayName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
        if (!name) return null;
        return { name, displayName };
      }
    }

    // Fallback: use H1 heading
    for (const line of lines) {
      const match = line.match(/^#\s+(.+)/);
      if (match) {
        const displayName = match[1].trim();
        const name = displayName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
        if (!name) return null;
        return { name, displayName };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// --- Commands ---

async function agentAdd(): Promise<void> {
  const pathArg = args[2];
  if (!pathArg) {
    console.error("Error: Missing <path> argument");
    console.error("Usage: archon agent add <path>");
    process.exit(1);
  }

  // 1. Validate and canonicalize path
  const rawPath = pathArg.replace(/^~/, process.env.HOME ?? "~");
  if (!existsSync(rawPath)) {
    console.error(`Error: Path not found: ${pathArg}`);
    process.exit(1);
  }

  let workspacePath: string;
  try {
    workspacePath = realpathSync(rawPath);
  } catch {
    console.error(`Error: Cannot resolve path: ${pathArg}`);
    process.exit(1);
  }

  // 2. Verify path is within a reasonable workspace root (prevent traversal)
  const archonAgentsDir = resolve(process.env.HOME ?? "", ".archon", "agents");
  const repoAgentsDir = resolve(process.cwd(), "agents");
  if (!workspacePath.startsWith(archonAgentsDir) && !workspacePath.startsWith(repoAgentsDir)) {
    console.error(`Error: Workspace path must be within ~/.archon/agents/ or ./agents/`);
    console.error(`  Resolved path: ${workspacePath}`);
    process.exit(1);
  }

  // 3. Check for identity files
  const hasIdentity = existsSync(resolve(workspacePath, "IDENTITY.md"));
  const hasSoul = existsSync(resolve(workspacePath, "SOUL.md"));

  if (!hasIdentity && !hasSoul) {
    console.error(`Error: No IDENTITY.md or SOUL.md found in ${pathArg}`);
    console.error("An agent workspace must contain at least one identity file.");
    process.exit(1);
  }

  // 3. Parse agent identity
  let name: string;
  let displayName: string;

  if (hasIdentity) {
    const parsed = parseIdentityFile(resolve(workspacePath, "IDENTITY.md"));
    if (!parsed) {
      console.error("Error: Could not parse agent name from IDENTITY.md");
      console.error('Expected format: - **Name**: Agent Name');
      process.exit(1);
    }
    name = parsed.name;
    displayName = parsed.displayName;
  } else {
    // Fallback to directory name
    name = basename(workspacePath).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    displayName = basename(workspacePath);
  }

  // 4. Validate agent ID
  if (!/^[a-z0-9_-]+$/.test(name)) {
    console.error(`Error: Invalid agent ID "${name}" — must be lowercase alphanumeric with hyphens/underscores`);
    process.exit(1);
  }

  // 5. Check for duplicate
  const existing = await db.query.agents.findFirst({
    where: eq(agents.id, name),
  });

  if (existing) {
    console.error(`Error: Agent "${name}" already exists. Remove the record manually or wait for 'agent update' (see https://github.com/LeviathanST/archon/issues/22).`);
    process.exit(1);
  }

  // 6. Build model config
  const provider = getFlag("--provider", "cli-claude");
  const model = getFlag("--model");
  const modelConfig: Record<string, unknown> = { provider };
  if (model) modelConfig.model = model;

  // 7. Validate department/role flags
  const departmentId = getFlag("--department");
  const roleId = getFlag("--role");
  if (departmentId && !roleId) {
    console.error("Error: --department requires --role to be specified as well.");
    process.exit(1);
  }
  if (roleId && !departmentId) {
    console.error("Error: --role requires --department to be specified as well.");
    process.exit(1);
  }

  // 8. Insert into database + generate card in a transaction
  try {
    await db.transaction(async (tx) => {
      const [agent] = await tx
        .insert(agents)
        .values({
          id: name,
          displayName,
          workspacePath,
          modelConfig,
        })
        .returning();

      // Assign department if provided
      if (departmentId && roleId) {
        await tx.insert(agentDepartments).values({
          agentId: name,
          departmentId,
          roleId,
        });
      }

      // Generate agent card (writes to same DB within transaction)
      await generateAgentCard(name);

      console.log(`✓ Agent registered`);
      console.log(`  ID:        ${agent.id}`);
      console.log(`  Name:      ${agent.displayName}`);
      console.log(`  Workspace: ${agent.workspacePath}`);
      console.log(`  Provider:  ${provider}${model ? ` (${model})` : ""}`);
    });
  } catch (err) {
    console.error(`Error: Failed to register agent — ${String(err)}`);
    process.exit(1);
  }
}

async function agentList(): Promise<void> {
  const allAgents = await db.select({
    id: agents.id,
    displayName: agents.displayName,
    status: agents.status,
    workspacePath: agents.workspacePath,
    ephemeral: agents.ephemeral,
  }).from(agents);

  if (allAgents.length === 0) {
    console.log("No agents registered.");
    return;
  }

  // Get department assignments
  const assignments = await db.select({
    agentId: agentDepartments.agentId,
    departmentName: departments.name,
    roleName: roles.name,
  })
    .from(agentDepartments)
    .innerJoin(departments, eq(agentDepartments.departmentId, departments.id))
    .innerJoin(roles, eq(agentDepartments.roleId, roles.id));

  const deptMap = new Map<string, string[]>();
  for (const a of assignments) {
    const list = deptMap.get(a.agentId) ?? [];
    list.push(`${a.departmentName} (${a.roleName})`);
    deptMap.set(a.agentId, list);
  }

  // Print header
  console.log("");
  console.log(
    padRight("ID", 20) +
    padRight("Display Name", 20) +
    padRight("Status", 14) +
    padRight("Departments", 30)
  );
  console.log("─".repeat(84));

  for (const agent of allAgents) {
    const depts = deptMap.get(agent.id)?.join(", ") ?? "—";
    const status = agent.ephemeral ? "ephemeral" : agent.status;
    console.log(
      padRight(agent.id, 20) +
      padRight(agent.displayName, 20) +
      padRight(status, 14) +
      padRight(depts, 30)
    );
  }
  console.log("");
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len - 1) + " " : str + " ".repeat(len - str.length);
}

// --- Main ---

async function main(): Promise<void> {
  if (command === "agent" && subcommand === "add") {
    await agentAdd();
  } else if (command === "agent" && subcommand === "list") {
    await agentList();
  } else {
    printUsage();
    process.exit(command === undefined ? 0 : 1);
  }
}

main()
  .catch((err) => {
    const msg = String(err);
    if (msg.includes("connect") || msg.includes("ECONNREFUSED") || msg.includes("password")) {
      console.error("Error: Cannot connect to database. Is Postgres running? Check DATABASE_URL.");
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
  })
  .finally(() => closeConnection());
