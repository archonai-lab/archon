import { WebSocketServer, WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { SessionManager } from "./session.js";
import { Router } from "./router.js";
import { db } from "../db/connection.js";
import { agents } from "../db/schema.js";
import { logger } from "../utils/logger.js";

export class HubServer {
  private wss: WebSocketServer | null = null;
  private sessions = new SessionManager();
  private router = new Router(this.sessions);

  async start(port: number): Promise<void> {
    this.wss = new WebSocketServer({ port });

    this.wss.on("connection", (socket: WebSocket) => {
      logger.debug("New WebSocket connection");

      socket.on("message", async (raw: Buffer) => {
        try {
          await this.router.handleRaw(socket, raw.toString());
        } catch (error) {
          logger.error({ error }, "Unhandled error in message handler");
          socket.send(
            JSON.stringify({
              type: "error",
              code: "INTERNAL_ERROR",
              message: "Internal server error",
            })
          );
        }
      });

      socket.on("close", async () => {
        // Find and clean up the session for this socket
        for (const session of this.sessions.getAll()) {
          if (session.socket === socket) {
            const { agentId } = session;
            this.sessions.remove(agentId);

            // Update status in DB
            try {
              await db
                .update(agents)
                .set({ status: "offline", updatedAt: new Date() })
                .where(eq(agents.id, agentId));
            } catch (error) {
              logger.error({ error, agentId }, "Failed to update agent status on disconnect");
            }

            logger.info({ agentId }, "Agent disconnected");
            break;
          }
        }
      });

      socket.on("error", (error) => {
        logger.error({ error }, "WebSocket error");
      });
    });

    logger.info({ port }, "Hub WebSocket server started");
  }

  async stop(): Promise<void> {
    if (!this.wss) return;

    // Close all connections
    for (const session of this.sessions.getAll()) {
      session.socket.close(1001, "Server shutting down");
    }

    return new Promise((resolve) => {
      this.wss!.close(() => {
        logger.info("Hub WebSocket server stopped");
        resolve();
      });
    });
  }

  getSessionManager(): SessionManager {
    return this.sessions;
  }
}
