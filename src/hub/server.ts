import { WebSocketServer, WebSocket } from "ws";
import { SessionManager } from "./session.js";
import { Router } from "./router.js";
import { logger } from "../utils/logger.js";

// CALIBRATION: 30s ping interval — frequent enough to detect dead sockets before
// a meeting invite is sent (meetings rarely start within 30s of agent death),
// infrequent enough to not generate noise in logs or stress the event loop.
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

// CALIBRATION: Pong timeout is implicit — a socket that doesn't respond within
// one full ping interval (30s) is evicted on the next cycle. This means
// worst-case detection is 2 × 30s = 60s, which is acceptable given that
// meeting creation is the only user-visible operation affected.

export interface HubServerOptions {
  /**
   * Override the heartbeat ping interval. Only set this in tests.
   * Production default: 30_000ms.
   */
  heartbeatIntervalMs?: number;
}

export class HubServer {
  private wss: WebSocketServer | null = null;
  private sessions = new SessionManager();
  private router = new Router(this.sessions);
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly heartbeatIntervalMs: number;

  constructor(options: HubServerOptions = {}) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  }

  async start(port: number, host?: string): Promise<void> {
    this.wss = new WebSocketServer({ port, host });

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

      socket.on("pong", () => {
        // Mark the session owning this socket as alive
        for (const session of this.sessions.getAll()) {
          if (session.socket === socket) {
            session.isAlive = true;
            break;
          }
        }
      });

      socket.on("close", () => {
        // Find and clean up the session for this socket
        for (const session of this.sessions.getAll()) {
          if (session.socket === socket) {
            const { agentId } = session;
            this.sessions.remove(agentId);
            logger.info({ agentId }, "Agent disconnected");
            break;
          }
        }
      });

      socket.on("error", (error) => {
        logger.error({ error }, "WebSocket error");
      });
    });

    this.startHeartbeat();

    logger.info({ port, host: host ?? "127.0.0.1" }, "Hub WebSocket server started");
  }

  /**
   * Ping every connected socket. Any socket that didn't pong since the last
   * ping is treated as a zombie: terminated and evicted from the session map.
   *
   * Flow per cycle:
   *   1. For each session: if isAlive === false → kill it (missed last ping)
   *   2. Reset isAlive = false, send ping
   *   3. If pong arrives before next cycle, isAlive is set back to true (see pong handler above)
   *
   * Worst-case detection latency: 2 × heartbeatIntervalMs (missed one full cycle).
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.tickHeartbeat();
    }, this.heartbeatIntervalMs);

    // Don't let the heartbeat timer keep the process alive after stop()
    this.heartbeatTimer.unref?.();
  }

  /** Separated for testability — runs one heartbeat cycle. */
  tickHeartbeat(): void {
    for (const session of this.sessions.getAll()) {
      if (!session.isAlive) {
        logger.warn({ agentId: session.agentId }, "Zombie socket detected — evicting session");
        session.socket.terminate();
        this.sessions.remove(session.agentId);
        continue;
      }

      session.isAlive = false;
      try {
        session.socket.ping();
      } catch {
        // Socket already gone — will be cleaned up on close event or next cycle
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.wss) return;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Kill all spawned agent processes
    this.router.killAllAgents();

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
