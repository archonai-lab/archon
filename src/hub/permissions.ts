import { and, eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { permissions } from "../db/schema.js";

/**
 * Check if an agent has a specific permission.
 * Supports wildcard resources (e.g. "agent:*" matches "agent:vex").
 */
export async function hasPermission(
  agentId: string,
  resource: string,
  action: string
): Promise<boolean> {
  // Check exact match
  const exact = await db.query.permissions.findFirst({
    where: and(
      eq(permissions.agentId, agentId),
      eq(permissions.resource, resource),
      eq(permissions.action, action)
    ),
  });

  if (exact) return true;

  // Check wildcard resource (e.g. "agent:*" covers "agent:vex")
  const [resourceType] = resource.split(":");
  if (resourceType) {
    const wildcard = await db.query.permissions.findFirst({
      where: and(
        eq(permissions.agentId, agentId),
        eq(permissions.resource, `${resourceType}:*`),
        eq(permissions.action, action)
      ),
    });

    if (wildcard) return true;
  }

  // Check if agent has "admin" action on the resource (admin implies any action)
  if (action !== "admin") {
    const adminExact = await db.query.permissions.findFirst({
      where: and(
        eq(permissions.agentId, agentId),
        eq(permissions.resource, resource),
        eq(permissions.action, "admin")
      ),
    });
    if (adminExact) return true;

    if (resourceType) {
      const adminWildcard = await db.query.permissions.findFirst({
        where: and(
          eq(permissions.agentId, agentId),
          eq(permissions.resource, `${resourceType}:*`),
          eq(permissions.action, "admin")
        ),
      });
      if (adminWildcard) return true;
    }
  }

  return false;
}

/**
 * Grant a permission to an agent.
 */
export async function grantPermission(
  agentId: string,
  resource: string,
  action: string
): Promise<void> {
  // Avoid duplicates
  const existing = await hasPermission(agentId, resource, action);
  if (!existing) {
    await db.insert(permissions).values({ agentId, resource, action });
  }
}
