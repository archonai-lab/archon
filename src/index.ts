import { testConnection, closeConnection } from "./db/connection.js";
import { HubServer } from "./hub/server.js";
import { logger } from "./utils/logger.js";
import { isLLMAvailable } from "./meeting/summarizer.js";

const WS_PORT = parseInt(process.env.WS_PORT ?? "9500", 10);
const WS_HOST = process.env.WS_HOST ?? "127.0.0.1";

async function main(): Promise<void> {
  logger.info("Archon — Agent Company Platform");
  logger.info("Starting up...");

  // 1. Check LLM availability
  logger.info({ llmAvailable: isLLMAvailable() }, "Meeting summary LLM status");

  // 2. Test database connection
  await testConnection();

  // 3. Start WebSocket hub
  const hub = new HubServer();
  await hub.start(WS_PORT, WS_HOST);

  logger.info("Archon is ready");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    await hub.stop();
    await closeConnection();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.fatal({ error }, "Failed to start Archon");
  process.exit(1);
});
