import type { WebSocket } from "ws";
import { logger } from "../utils/logger.js";

export interface AgentSession {
  agentId: string;
  socket: WebSocket;
  connectedAt: Date;
  currentMeetingId: string | null;
}

export type AddSessionResult =
  | { ok: true; session: AgentSession }
  | { ok: false; code: "ALREADY_IN_MEETING"; meetingId: string };

export class SessionManager {
  private sessions = new Map<string, AgentSession>();

  /**
   * Three-case decision tree for re-auth:
   * 1. Dead socket (CLOSED/CLOSING) → evict and allow re-auth
   * 2. Alive socket, no active meeting → replace session
   * 3. Alive socket, active meeting → reject with ALREADY_IN_MEETING
   */
  add(agentId: string, socket: WebSocket): AddSessionResult {
    const existing = this.sessions.get(agentId);

    if (existing) {
      const isAlive = existing.socket.readyState === existing.socket.OPEN;
      const hasActiveMeeting = existing.currentMeetingId !== null;

      if (isAlive && hasActiveMeeting) {
        // Case 3: alive socket with active meeting — reject
        logger.warn(
          { agentId, meetingId: existing.currentMeetingId },
          "Re-auth rejected — agent is in an active meeting"
        );
        return { ok: false, code: "ALREADY_IN_MEETING", meetingId: existing.currentMeetingId! };
      }

      // Case 1 (dead socket) or Case 2 (alive, no meeting) — evict and replace
      if (isAlive) {
        logger.warn({ agentId }, "Replacing idle session (no active meeting)");
        existing.socket.close(1000, "Replaced by new connection");
      } else {
        logger.info({ agentId }, "Evicting dead session on reconnect");
      }
    }

    const session: AgentSession = {
      agentId,
      socket,
      connectedAt: new Date(),
      currentMeetingId: null,
    };

    this.sessions.set(agentId, session);
    logger.info({ agentId }, "Agent session created");
    return { ok: true, session };
  }

  remove(agentId: string): void {
    this.sessions.delete(agentId);
    logger.info({ agentId }, "Agent session removed");
  }

  /** Clear the active meeting for an agent — must be called on all meeting termination paths. */
  clearMeeting(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.currentMeetingId = null;
    }
  }

  /** Set the active meeting for an agent. */
  setMeeting(agentId: string, meetingId: string): void {
    const session = this.sessions.get(agentId);
    if (session) {
      session.currentMeetingId = meetingId;
    }
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
