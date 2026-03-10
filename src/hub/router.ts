import type { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { InboundMessage, AuthMessage } from "../protocol/messages.js";
import { createError, ErrorCode } from "../protocol/errors.js";
import { db } from "../db/connection.js";
import { agents } from "../db/schema.js";
import { SessionManager } from "./session.js";
import { discoverAgents } from "../registry/discovery.js";
import { getAgentCard } from "../registry/agent-card.js";
import { MeetingRoom } from "../meeting/meeting-room.js";
import { logger } from "../utils/logger.js";

export class Router {
  private activeMeetings = new Map<string, MeetingRoom>();

  constructor(private sessions: SessionManager) {}

  async handleRaw(socket: WebSocket, raw: string): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      socket.send(
        JSON.stringify(createError(ErrorCode.INVALID_MESSAGE, "Invalid JSON"))
      );
      return;
    }

    // If this socket is not authenticated yet, only allow auth messages
    const agentId = this.getAgentIdForSocket(socket);
    if (!agentId) {
      await this.handleAuth(socket, data);
      return;
    }

    // Parse as known inbound message
    const parsed = InboundMessage.safeParse(data);
    if (!parsed.success) {
      this.sessions.send(
        agentId,
        createError(
          ErrorCode.INVALID_MESSAGE,
          `Invalid message: ${parsed.error.issues[0]?.message ?? "unknown"}`
        )
      );
      return;
    }

    const message = parsed.data;

    switch (message.type) {
      case "ping":
        this.sessions.send(agentId, { type: "pong" });
        break;

      case "agent.status":
        await this.handleAgentStatus(agentId, message.status);
        break;

      case "directory.list":
        await this.handleDirectoryList(agentId, message.filter);
        break;

      case "directory.get":
        await this.handleDirectoryGet(agentId, message.agentId);
        break;

      // --- Meeting messages ---
      case "meeting.create":
        await this.handleMeetingCreate(agentId, message);
        break;

      case "meeting.join":
        this.handleMeetingJoin(agentId, message.meetingId);
        break;

      case "meeting.leave":
        this.handleMeetingLeave(agentId, message.meetingId);
        break;

      case "meeting.speak":
        await this.handleMeetingSpeak(agentId, message.meetingId, message.content);
        break;

      case "meeting.relevance":
        this.handleMeetingRelevance(agentId, message.meetingId, message.level);
        break;

      case "meeting.advance":
        await this.handleMeetingAdvance(agentId, message.meetingId);
        break;

      case "meeting.propose":
        await this.handleMeetingPropose(agentId, message.meetingId, message.proposal);
        break;

      case "meeting.vote":
        await this.handleMeetingVote(
          agentId,
          message.meetingId,
          message.proposalIndex,
          message.vote,
          message.reason
        );
        break;

      case "meeting.assign":
        await this.handleMeetingAssign(
          agentId,
          message.meetingId,
          message.task,
          message.assigneeId,
          message.deadline
        );
        break;

      case "meeting.acknowledge":
        await this.handleMeetingAcknowledge(agentId, message.meetingId, message.taskIndex);
        break;

      default:
        this.sessions.send(
          agentId,
          createError(ErrorCode.UNKNOWN_TYPE, `Unhandled message type: ${(message as { type: string }).type}`)
        );
    }
  }

  // --- Auth ---

  private async handleAuth(socket: WebSocket, data: unknown): Promise<void> {
    const parsed = AuthMessage.safeParse(data);
    if (!parsed.success) {
      socket.send(
        JSON.stringify(
          createError(ErrorCode.AUTH_REQUIRED, "First message must be auth")
        )
      );
      return;
    }

    const { agentId, token } = parsed.data;

    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });

    if (!agent) {
      socket.send(
        JSON.stringify(
          createError(ErrorCode.AUTH_FAILED, `Agent "${agentId}" not found`)
        )
      );
      socket.close(4001, "Authentication failed");
      return;
    }

    // MVP auth: token must match agent ID
    if (token !== agentId) {
      socket.send(
        JSON.stringify(createError(ErrorCode.AUTH_FAILED, "Invalid token"))
      );
      socket.close(4001, "Authentication failed");
      return;
    }

    this.sessions.add(agentId, socket);

    await db
      .update(agents)
      .set({ status: "online", updatedAt: new Date() })
      .where(eq(agents.id, agentId));

    const agentCard = await getAgentCard(agentId);

    // Find pending invites for this agent
    const pendingInvites: string[] = [];
    for (const [meetingId, room] of this.activeMeetings) {
      if (room.getParticipants().includes(agentId) && !room.getJoined().includes(agentId)) {
        pendingInvites.push(meetingId);
      }
    }

    socket.send(
      JSON.stringify({
        type: "auth.ok",
        agentCard: agentCard ?? {},
        pendingInvites,
      })
    );

    logger.info({ agentId }, "Agent authenticated");
  }

  // --- Directory ---

  private async handleAgentStatus(
    agentId: string,
    status: "online" | "offline" | "busy"
  ): Promise<void> {
    await db
      .update(agents)
      .set({ status, updatedAt: new Date() })
      .where(eq(agents.id, agentId));

    logger.info({ agentId, status }, "Agent status updated");
  }

  private async handleDirectoryList(
    agentId: string,
    filter?: { departmentId?: string }
  ): Promise<void> {
    const cards = await discoverAgents(agentId, filter);
    this.sessions.send(agentId, {
      type: "directory.result",
      agents: cards,
    });
  }

  private async handleDirectoryGet(
    requestingAgentId: string,
    targetAgentId: string
  ): Promise<void> {
    const card = await getAgentCard(targetAgentId);
    if (!card) {
      this.sessions.send(
        requestingAgentId,
        createError(ErrorCode.AGENT_NOT_FOUND, `Agent "${targetAgentId}" not found`)
      );
      return;
    }

    this.sessions.send(requestingAgentId, {
      type: "directory.result",
      agents: [card],
    });
  }

  // --- Meeting handlers ---

  private async handleMeetingCreate(
    agentId: string,
    msg: { title: string; projectId?: string; invitees: string[]; tokenBudget?: number; agenda?: string }
  ): Promise<void> {
    const room = new MeetingRoom({
      title: msg.title,
      initiatorId: agentId,
      projectId: msg.projectId,
      invitees: msg.invitees,
      tokenBudget: msg.tokenBudget,
      agenda: msg.agenda,
      send: (targetId, message) => this.sessions.send(targetId, message),
    });

    await room.persist();
    this.activeMeetings.set(room.id, room);

    // Auto-join initiator
    room.join(agentId);

    // Update session
    const session = this.sessions.get(agentId);
    if (session) session.currentMeetingId = room.id;

    // Send invites to other participants
    room.sendInvites();

    // Confirm creation to initiator
    this.sessions.send(agentId, {
      type: "meeting.created",
      meetingId: room.id,
      title: room.title,
      participants: room.getParticipants(),
    });

    logger.info({ meetingId: room.id, initiator: agentId, participants: room.getParticipants() }, "Meeting created");
  }

  private handleMeetingJoin(agentId: string, meetingId: string): void {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = room.join(agentId);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Cannot join meeting"));
      return;
    }

    // Update session
    const session = this.sessions.get(agentId);
    if (session) session.currentMeetingId = meetingId;

    logger.info({ meetingId, agentId }, "Agent joined meeting");
  }

  private handleMeetingLeave(agentId: string, meetingId: string): void {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    room.leave(agentId);

    const session = this.sessions.get(agentId);
    if (session) session.currentMeetingId = null;

    logger.info({ meetingId, agentId }, "Agent left meeting");
  }

  private async handleMeetingSpeak(agentId: string, meetingId: string, content: string): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = await room.speak(agentId, content);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.NOT_YOUR_TURN, "Cannot speak now"));
    }
  }

  private handleMeetingRelevance(agentId: string, meetingId: string, level: "must_speak" | "could_add" | "pass"): void {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    room.recordRelevance(agentId, level);
  }

  private async handleMeetingAdvance(agentId: string, meetingId: string): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = await room.advance(agentId);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Only initiator can advance"));
    }
  }

  private async handleMeetingPropose(agentId: string, meetingId: string, proposal: string): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = await room.propose(agentId, proposal);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.NOT_YOUR_TURN, "Cannot propose now"));
    }
  }

  private async handleMeetingVote(
    agentId: string,
    meetingId: string,
    proposalIndex: number,
    vote: "approve" | "reject" | "abstain",
    reason?: string
  ): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = await room.vote(agentId, proposalIndex, vote, reason);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.NOT_YOUR_TURN, "Cannot vote now"));
    }
  }

  private async handleMeetingAssign(
    agentId: string,
    meetingId: string,
    task: string,
    assigneeId: string,
    deadline?: string
  ): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = await room.assignTask(agentId, task, assigneeId, deadline);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.NOT_YOUR_TURN, "Cannot assign now"));
    }
  }

  private async handleMeetingAcknowledge(agentId: string, meetingId: string, taskIndex: number): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = await room.acknowledge(agentId, taskIndex);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.NOT_YOUR_TURN, "Cannot acknowledge now"));
    }
  }

  // --- Helpers ---

  private getMeetingOrError(agentId: string, meetingId: string): MeetingRoom | null {
    const room = this.activeMeetings.get(meetingId);
    if (!room) {
      this.sessions.send(agentId, createError(ErrorCode.MEETING_NOT_FOUND, `Meeting "${meetingId}" not found`));
      return null;
    }
    return room;
  }

  private getAgentIdForSocket(socket: WebSocket): string | undefined {
    for (const session of this.sessions.getAll()) {
      if (session.socket === socket) {
        return session.agentId;
      }
    }
    return undefined;
  }

  // --- Expose for testing ---

  getActiveMeetings(): Map<string, MeetingRoom> {
    return this.activeMeetings;
  }
}
