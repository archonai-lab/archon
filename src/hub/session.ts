import type { WebSocket } from "ws";
import { logger } from "../utils/logger.js";

export interface AgentSession {
  agentId: string;
  socket: WebSocket;
  connectedAt: Date;
  currentMeetingId: string | null;
}

export class SessionManager {
  private sessions = new Map<string, AgentSession>();

  add(agentId: string, socket: WebSocket): AgentSession {
    // Close existing session if agent reconnects
    const existing = this.sessions.get(agentId);
    if (existing) {
      logger.warn({ agentId }, "Agent reconnecting, closing previous session");
      existing.socket.close(1000, "Replaced by new connection");
    }

    const session: AgentSession = {
      agentId,
      socket,
      connectedAt: new Date(),
      currentMeetingId: null,
    };

    this.sessions.set(agentId, session);
    logger.info({ agentId }, "Agent session created");
    return session;
  }

  remove(agentId: string): void {
    this.sessions.delete(agentId);
    logger.info({ agentId }, "Agent session removed");
  }

  get(agentId: string): AgentSession | undefined {
    return this.sessions.get(agentId);
  }

  getAll(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getOnlineAgentIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  isOnline(agentId: string): boolean {
    return this.sessions.has(agentId);
  }

  send(agentId: string, message: unknown): boolean {
    const session = this.sessions.get(agentId);
    if (!session || session.socket.readyState !== session.socket.OPEN) {
      return false;
    }
    session.socket.send(JSON.stringify(message));
    return true;
  }

  broadcast(message: unknown, exclude?: string): void {
    const data = JSON.stringify(message);
    for (const [agentId, session] of this.sessions) {
      if (agentId !== exclude && session.socket.readyState === session.socket.OPEN) {
        session.socket.send(data);
      }
    }
  }
}
