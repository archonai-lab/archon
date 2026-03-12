/**
 * AgentCard — inspired by Google A2A protocol's Agent Card concept.
 * @see https://a2a-protocol.org/latest/specification/
 * We borrow the discovery/card pattern for agent capability advertisement.
 * NOT the A2A transport (HTTP/SSE) — Archon uses its own WebSocket protocol.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import {
  agents,
  agentDepartments,
  departments,
  roles,
} from "../db/schema.js";
import { logger } from "../utils/logger.js";

/**
 * A2A-inspired Agent Card — auto-generated from IDENTITY.md + SOUL.md + Postgres.
 * Cached in the agents.agent_card JSONB column.
 */
export interface AgentCard {
  id: string;
  displayName: string;
  description: string;
  version: string;

  departments: Array<{
    id: string;
    name: string;
    role: { id: string; name: string };
  }>;

  characteristics: {
    personality: string;
    strengths: string[];
    weaknesses: string[];
    communicationStyle: string;
  };

  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;

  status: "active" | "deactivated";
  activity: string; // "idle", "connected", "in_meeting:<title>"

  model: {
    provider: string;
    backend: string;
  } | null;

  createdAt: string;
  updatedAt: string;
}

/** Parse a markdown list section into string[] */
function parseListSection(content: string, heading: string): string[] {
  const regex = new RegExp(
    `## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
    "i"
  );
  const match = content.match(regex);
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** Parse a paragraph section (first non-empty paragraph after heading) */
function parseParagraphSection(content: string, heading: string): string {
  const regex = new RegExp(
    `## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
    "i"
  );
  const match = content.match(regex);
  if (!match) return "";

  return match[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ");
}

/** Parse skills from IDENTITY.md (format: - **id**: description) */
function parseSkills(
  content: string
): Array<{ id: string; name: string; description: string }> {
  const regex = /## Skills\s*\n([\s\S]*?)(?=\n## |$)/i;
  const match = content.match(regex);
  if (!match) return [];

  return match[1]
    .split("\n")
    .map((line) => {
      const m = line.match(/^[-*]\s*\*\*(\S+)\*\*:\s*(.+)$/);
      if (!m) return null;
      return { id: m[1], name: m[1], description: m[2].trim() };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

/** Parse IDENTITY.md front-matter fields */
function parseIdentityFields(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const m = line.match(/^-\s*\*\*(\w[\w\s]*)\*\*:\s*(.+)$/);
    if (m) {
      fields[m[1].toLowerCase().trim()] = m[2].trim();
    }
  }
  return fields;
}

async function readWorkspaceFile(
  workspacePath: string,
  filename: string
): Promise<string | null> {
  try {
    const resolvedPath = workspacePath.replace(/^~/, process.env.HOME ?? "~");
    return await readFile(join(resolvedPath, filename), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Generate an Agent Card by reading workspace files + DB data.
 * Falls back to DB-only data if workspace files are missing.
 */
export async function generateAgentCard(
  agentId: string
): Promise<AgentCard | null> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) return null;

  // Query department memberships with role info
  const memberships = await db
    .select({
      departmentId: agentDepartments.departmentId,
      departmentName: departments.name,
      roleId: agentDepartments.roleId,
      roleName: roles.name,
    })
    .from(agentDepartments)
    .innerJoin(departments, eq(agentDepartments.departmentId, departments.id))
    .innerJoin(roles, eq(agentDepartments.roleId, roles.id))
    .where(eq(agentDepartments.agentId, agentId));

  // Try reading workspace files
  const identityContent = await readWorkspaceFile(
    agent.workspacePath,
    "IDENTITY.md"
  );
  const soulContent = await readWorkspaceFile(agent.workspacePath, "SOUL.md");

  // Parse identity fields
  const identityFields = identityContent
    ? parseIdentityFields(identityContent)
    : {};
  const skills = identityContent ? parseSkills(identityContent) : [];
  const strengths = identityContent
    ? parseListSection(identityContent, "Strengths")
    : [];
  const weaknesses = identityContent
    ? parseListSection(identityContent, "Weaknesses")
    : [];

  // Parse soul fields
  const personality = soulContent
    ? parseParagraphSection(soulContent, "Personality")
    : "";
  const communicationStyle = soulContent
    ? parseParagraphSection(soulContent, "Communication Style")
    : "";

  const modelConfig = agent.modelConfig as {
    provider?: string;
    backend?: string;
  } | null;

  const card: AgentCard = {
    id: agent.id,
    displayName: agent.displayName,
    description: identityFields.description ?? "",
    version: identityFields.version ?? "1.0.0",

    departments: memberships.map((m) => ({
      id: m.departmentId,
      name: m.departmentName,
      role: { id: m.roleId, name: m.roleName },
    })),

    characteristics: {
      personality,
      strengths,
      weaknesses,
      communicationStyle,
    },

    skills,

    status: agent.status as "active" | "deactivated",
    activity: "idle",

    model: modelConfig
      ? {
          provider: modelConfig.provider ?? "unknown",
          backend: modelConfig.backend ?? "unknown",
        }
      : null,

    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };

  // Cache the card in DB
  await db
    .update(agents)
    .set({ agentCard: card, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  logger.debug({ agentId }, "Agent card generated");
  return card;
}

/**
 * Get a cached agent card, or generate a fresh one.
 */
export async function getAgentCard(
  agentId: string
): Promise<AgentCard | null> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
  });

  if (!agent) return null;

  // Return cached card if available
  if (agent.agentCard) {
    const card = agent.agentCard as AgentCard;
    card.status = agent.status as "active" | "deactivated";
    // Activity is set dynamically by the router when building directory results
    card.activity = "idle";
    return card;
  }

  return generateAgentCard(agentId);
}
