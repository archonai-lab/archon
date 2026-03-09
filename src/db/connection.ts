import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { logger } from "../utils/logger.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://archon:archon@localhost:5432/archon";

const client = postgres(databaseUrl);

export const db = drizzle(client, { schema });

export async function testConnection(): Promise<void> {
  try {
    await client`SELECT 1`;
    logger.info("Database connection established");
  } catch (error) {
    logger.fatal({ error }, "Failed to connect to database");
    throw error;
  }
}

export async function closeConnection(): Promise<void> {
  await client.end();
  logger.info("Database connection closed");
}
