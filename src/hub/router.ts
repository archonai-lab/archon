import type { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { InboundMessage, AuthMessage } from "../protocol/messages.js";
import { createError, ErrorCode } from "../protocol/errors.js";
import { db } from "../db/connection.js";
import { agents, meetingParticipants } from "../db/schema.js";
import { SessionManager } from "./session.js";
import { discoverAgents } from "../registry/discovery.js";
import { getAgentCard } from "../registry/agent-card.js";
import { MeetingRoom } from "../meeting/meeting-room.js";
import { loadMethodology, getDefaultMethodology } from "../meeting/methodology-loader.js";
import { createAgentFull, updateAgentFull, deleteAgentFull, reactivateAgentFull, enrichAgentIdentity, hardDeleteAgent } from "../registry/agent-crud.js";
import {
  listDepartments, createDepartmentFull, updateDepartmentFull, deleteDepartmentFull,
  listRoles, createRoleFull, updateRoleFull, deleteRoleFull,
} from "../registry/department-crud.js";
import { listMeetings, getMeetingTranscript } from "../meeting/meeting-queries.js";
import { getLLMConfig, setLLMConfig, isLLMAvailable } from "../meeting/summarizer.js";
import { AgentSpawner } from "./agent-spawner.js";
import { logger } from "../utils/logger.js";

export class Router {
  private activeMeetings = new Map<string, MeetingRoom>();
  private spawner: AgentSpawner;

  constructor(private sessions: SessionManager) {
    const wsPort = parseInt(process.env.WS_PORT ?? "9500", 10);
    this.spawner = new AgentSpawner(`ws://127.0.0.1:${wsPort}`, {
      onProcessExit: (agentId, code, signal) => this.handleAgentProcessExit(agentId, code, signal),
    });
  }

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
        // Deprecated — status is now derived from activity
        break;

      case "directory.list":
        await this.handleDirectoryList(agentId, message.filter);
        break;

      case "directory.get":
        await this.handleDirectoryGet(agentId, message.agentId);
        break;

      // --- Agent CRUD ---
      case "agent.create":
        await this.handleAgentCreate(agentId, message);
        break;

      case "agent.update":
        await this.handleAgentUpdate(agentId, message);
        break;

      case "agent.delete":
        await this.handleAgentDelete(agentId, message.agentId);
        break;

      case "agent.reactivate":
        await this.handleAgentReactivate(agentId, message.agentId);
        break;

      case "agent.enrich":
        await this.handleAgentEnrich(agentId, message);
        break;

      // --- Department CRUD ---
      case "department.list":
        await this.handleDepartmentList(agentId);
        break;

      case "department.create":
        await this.handleDepartmentCreate(agentId, message);
        break;

      case "department.update":
        await this.handleDepartmentUpdate(agentId, message);
        break;

      case "department.delete":
        await this.handleDepartmentDelete(agentId, message.departmentId);
        break;

      // --- Role CRUD ---
      case "role.list":
        await this.handleRoleList(agentId, message.departmentId);
        break;

      case "role.create":
        await this.handleRoleCreate(agentId, message);
        break;

      case "role.update":
        await this.handleRoleUpdate(agentId, message);
        break;

      case "role.delete":
        await this.handleRoleDelete(agentId, message.roleId);
        break;

      // --- Meeting messages ---
      case "meeting.create":
        await this.handleMeetingCreate(agentId, message);
        break;

      case "meeting.join":
        await this.handleMeetingJoin(agentId, message.meetingId);
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

      case "meeting.approve":
        await this.handleMeetingApprove(agentId, message.meetingId);
        break;

      case "meeting.cancel":
        await this.handleMeetingCancel(agentId, message.meetingId, message.reason);
        break;

      case "meeting.active_list":
        await this.handleMeetingActiveList(agentId);
        break;

      // --- Meeting history ---
      case "meeting.history":
        await this.handleMeetingHistory(agentId, message);
        break;

      case "meeting.transcript":
        await this.handleMeetingTranscript(agentId, message.meetingId);
        break;

      // --- Hub config ---
      case "config.get":
        await this.handleConfigGet(agentId);
        break;

      case "config.set":
        await this.handleConfigSet(agentId, message.key, message.value);
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

    const agentCard = await getAgentCard(agentId);

    // Find pending invites and active meetings for this agent
    const pendingInvites: string[] = [];
    const activeMeetings: Array<{
      meetingId: string;
      title: string;
      phase: string;
      initiator: string;
      participants: string[];
      budgetRemaining: number;
    }> = [];

    for (const [meetingId, room] of this.activeMeetings) {
      if (!room.getParticipants().includes(agentId)) continue;

      if (room.getJoined().includes(agentId)) {
        // Already joined — this is a reconnect, re-add to joined set
        activeMeetings.push({
          meetingId,
          title: room.title,
          phase: room.getPhase(),
          initiator: room.initiatorId,
          participants: room.getParticipants(),
          budgetRemaining: room.tokenBudget - room.getTokensUsed(),
        });
        // Update session to track current meeting
        const session = this.sessions.get(agentId);
        if (session && !session.currentMeetingId) {
          session.currentMeetingId = meetingId;
        }
      } else {
        pendingInvites.push(meetingId);
      }
    }

    socket.send(
      JSON.stringify({
        type: "auth.ok",
        agentCard: agentCard ?? {},
        pendingInvites,
        activeMeetings,
      })
    );

    logger.info({ agentId, activeMeetings: activeMeetings.length, pendingInvites: pendingInvites.length }, "Agent authenticated");
  }

  // --- Directory ---

  private async handleDirectoryList(
    agentId: string,
    filter?: { departmentId?: string }
  ): Promise<void> {
    const cards = await discoverAgents(agentId, filter);

    // Enrich cards with live activity derived from sessions + meetings
    for (const card of cards) {
      const c = card as { id: string; activity?: string };
      if (!this.sessions.isOnline(c.id)) {
        // Check if agent is spawning (process started but not yet connected)
        c.activity = this.spawner.isSpawned(c.id) ? "spawning" : "idle";
        continue;
      }
      // Check if agent is in an active meeting
      const session = this.sessions.get(c.id);
      if (session?.currentMeetingId) {
        const room = this.activeMeetings.get(session.currentMeetingId);
        c.activity = room ? `in_meeting:${room.title}` : "connected";
      } else {
        c.activity = "connected";
      }
    }

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
    msg: { title: string; projectId?: string; invitees: string[]; tokenBudget?: number; agenda?: string; methodology?: string; approvalRequired?: boolean; summaryMode?: "off" | "structured" | "llm" }
  ): Promise<void> {
    let methodology;
    try {
      methodology = msg.methodology
        ? await loadMethodology(msg.methodology)
        : getDefaultMethodology();
    } catch (err) {
      this.sessions.send(
        agentId,
        createError(ErrorCode.INVALID_MESSAGE, `Failed to load methodology "${msg.methodology}": ${(err as Error).message}`)
      );
      return;
    }

    const room = new MeetingRoom({
      title: msg.title,
      initiatorId: agentId,
      projectId: msg.projectId,
      invitees: msg.invitees,
      tokenBudget: msg.tokenBudget,
      agenda: msg.agenda,
      send: (targetId, message) => this.sessions.send(targetId, message),
      methodology,
      approvalRequired: msg.approvalRequired,
      summaryMode: msg.summaryMode,
      onEnd: (meetingId) => this.handleMeetingEnd(meetingId),
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

    // Auto-spawn agent processes for invitees that aren't already connected
    const toSpawn = room.getParticipants().filter(
      (id) => id !== agentId && !this.sessions.isOnline(id)
    );
    if (toSpawn.length > 0) {
      const result = await this.spawner.spawnForMeeting(toSpawn, room.id);
      if (result.spawned.length > 0) {
        logger.info({ meetingId: room.id, spawned: result.spawned }, "Auto-spawned agents for meeting");
        this.sessions.send(agentId, {
          type: "agents.spawned",
          meetingId: room.id,
          agentIds: result.spawned,
        });
      }
      if (result.failed.length > 0) {
        logger.warn({ meetingId: room.id, failed: result.failed }, "Some agents failed to spawn");
        this.sessions.send(agentId, {
          type: "agents.spawn_failed",
          meetingId: room.id,
          failures: result.failed,
        });
      }
    }
  }

  private async handleMeetingJoin(agentId: string, meetingId: string): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    // If agent is not a participant, check if they're admin/CEO — allow them to join
    if (!room.getParticipants().includes(agentId)) {
      const { canManageAgents } = await import("../registry/agent-crud.js");
      const isAdmin = await canManageAgents(agentId);
      if (!isAdmin) {
        this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Cannot join meeting — not a participant"));
        return;
      }
      // Add as participant and persist
      room.addParticipant(agentId);
      await db.insert(meetingParticipants).values({
        meetingId,
        agentId,
      }).onConflictDoNothing();
      logger.info({ meetingId, agentId }, "Admin joined meeting as new participant");
    }

    const ok = room.join(agentId);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Cannot join meeting"));
      return;
    }

    // Update session
    const session = this.sessions.get(agentId);
    if (session) session.currentMeetingId = meetingId;

    // Send current meeting state to the joining agent
    this.sessions.send(agentId, {
      type: "meeting.created",
      meetingId: room.id,
      title: room.title,
      participants: room.getParticipants(),
    });

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

  private async handleMeetingApprove(agentId: string, meetingId: string): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    const ok = await room.approve(agentId);
    if (!ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Cannot approve: not initiator or not awaiting approval"));
    }
  }

  // --- Agent CRUD handlers ---

  private async handleAgentCreate(
    agentId: string,
    msg: { name: string; displayName: string; departments?: Array<{ departmentId: string; roleId: string }>; role?: string; modelConfig?: Record<string, unknown>; ephemeral?: boolean }
  ): Promise<void> {
    const result = await createAgentFull(agentId, {
      name: msg.name,
      displayName: msg.displayName,
      departments: msg.departments,
      role: msg.role,
      modelConfig: msg.modelConfig,
      ephemeral: msg.ephemeral,
    });

    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, {
      type: "agent.created",
      agentId: result.agent.id,
      displayName: result.agent.displayName,
    });

    this.broadcastDirectoryUpdated();
  }

  private async handleAgentUpdate(
    agentId: string,
    msg: { agentId: string; displayName?: string; departments?: Array<{ departmentId: string; roleId: string }>; modelConfig?: Record<string, unknown> }
  ): Promise<void> {
    const result = await updateAgentFull(agentId, msg.agentId, {
      displayName: msg.displayName,
      departments: msg.departments,
      modelConfig: msg.modelConfig,
    });

    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, {
      type: "agent.updated",
      agentId: msg.agentId,
    });

    this.broadcastDirectoryUpdated();
  }

  private async handleAgentDelete(requesterId: string, targetAgentId: string): Promise<void> {
    const result = await deleteAgentFull(requesterId, targetAgentId);

    if (!result.ok) {
      this.sessions.send(requesterId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    // Remove from active meetings
    for (const [, room] of this.activeMeetings) {
      if (room.getParticipants().includes(targetAgentId)) {
        room.leave(targetAgentId);
      }
    }

    this.sessions.send(requesterId, {
      type: "agent.deleted",
      agentId: targetAgentId,
    });

    this.broadcastDirectoryUpdated();
  }

  private async handleAgentReactivate(requesterId: string, targetAgentId: string): Promise<void> {
    const result = await reactivateAgentFull(requesterId, targetAgentId);

    if (!result.ok) {
      this.sessions.send(requesterId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(requesterId, {
      type: "agent.updated",
      agentId: targetAgentId,
    });

    this.broadcastDirectoryUpdated();
  }

  private async handleAgentEnrich(
    agentId: string,
    msg: { agentId: string; identity?: string; soul?: string }
  ): Promise<void> {
    const result = await enrichAgentIdentity(agentId, msg.agentId, {
      identity: msg.identity,
      soul: msg.soul,
    });

    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, {
      type: "agent.enriched",
      agentId: msg.agentId,
    });

    this.broadcastDirectoryUpdated();
  }

  // --- Department CRUD handlers ---

  private async handleDepartmentList(agentId: string): Promise<void> {
    const depts = await listDepartments();
    this.sessions.send(agentId, {
      type: "department.result",
      departments: depts,
    });
  }

  private async handleDepartmentCreate(
    agentId: string,
    msg: { name: string; description?: string }
  ): Promise<void> {
    const result = await createDepartmentFull(agentId, msg.name, msg.description);
    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, {
      type: "department.created",
      departmentId: result.department.id,
      name: result.department.name,
    });

    this.broadcastDirectoryUpdated();
  }

  private async handleDepartmentUpdate(
    agentId: string,
    msg: { departmentId: string; name?: string; description?: string }
  ): Promise<void> {
    const result = await updateDepartmentFull(agentId, msg.departmentId, {
      name: msg.name,
      description: msg.description,
    });

    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, { type: "department.updated", departmentId: msg.departmentId });
    this.broadcastDirectoryUpdated();
  }

  private async handleDepartmentDelete(agentId: string, departmentId: string): Promise<void> {
    const result = await deleteDepartmentFull(agentId, departmentId);
    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, { type: "department.deleted", departmentId });
    this.broadcastDirectoryUpdated();
  }

  // --- Role CRUD handlers ---

  private async handleRoleList(agentId: string, departmentId?: string): Promise<void> {
    const roleList = await listRoles(departmentId);
    this.sessions.send(agentId, {
      type: "role.result",
      roles: roleList,
    });
  }

  private async handleRoleCreate(
    agentId: string,
    msg: { departmentId: string; name: string; permissions?: string[] }
  ): Promise<void> {
    const result = await createRoleFull(agentId, msg.departmentId, msg.name, msg.permissions);
    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, {
      type: "role.created",
      roleId: result.role.id,
      name: result.role.name,
      departmentId: msg.departmentId,
    });
  }

  private async handleRoleUpdate(
    agentId: string,
    msg: { roleId: string; name?: string; permissions?: string[] }
  ): Promise<void> {
    const result = await updateRoleFull(agentId, msg.roleId, {
      name: msg.name,
      permissions: msg.permissions,
    });

    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, { type: "role.updated", roleId: msg.roleId });
  }

  private async handleRoleDelete(agentId: string, roleId: string): Promise<void> {
    const result = await deleteRoleFull(agentId, roleId);
    if (!result.ok) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, result.error));
      return;
    }

    this.sessions.send(agentId, { type: "role.deleted", roleId });
  }

  // --- Meeting history handlers ---

  private async handleMeetingHistory(
    agentId: string,
    msg: { status?: "active" | "completed" | "cancelled"; cursor?: string; limit?: number }
  ): Promise<void> {
    const results = await listMeetings({
      status: msg.status,
      cursor: msg.cursor,
      limit: msg.limit,
    });

    this.sessions.send(agentId, {
      type: "meeting.history.result",
      meetings: results,
    });
  }

  private async handleMeetingTranscript(agentId: string, meetingId: string): Promise<void> {
    const result = await getMeetingTranscript(meetingId);
    if (!result) {
      this.sessions.send(agentId, createError(ErrorCode.MEETING_NOT_FOUND, `Meeting "${meetingId}" not found`));
      return;
    }

    this.sessions.send(agentId, {
      type: "meeting.transcript.result",
      ...result,
    });
  }

  private async handleMeetingCancel(agentId: string, meetingId: string, reason?: string): Promise<void> {
    const room = this.getMeetingOrError(agentId, meetingId);
    if (!room) return;

    // Only initiator can cancel
    if (room.initiatorId !== agentId) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Only the meeting initiator can cancel"));
      return;
    }

    await room.cancel(reason ?? "Cancelled by initiator");
  }

  // --- Hub config ---

  private async handleConfigGet(agentId: string): Promise<void> {
    const { canManageAgents } = await import("../registry/agent-crud.js");
    const isAdmin = await canManageAgents(agentId);
    if (!isAdmin) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Only admins can read hub config"));
      return;
    }

    this.sendConfigResult(agentId);
  }

  private async handleConfigSet(agentId: string, key: string, value: unknown): Promise<void> {
    const { canManageAgents } = await import("../registry/agent-crud.js");
    const isAdmin = await canManageAgents(agentId);
    if (!isAdmin) {
      this.sessions.send(agentId, createError(ErrorCode.PERMISSION_DENIED, "Only admins can update hub config"));
      return;
    }

    const error = setLLMConfig(key, value);
    if (error) {
      this.sessions.send(agentId, createError(ErrorCode.INVALID_MESSAGE, error));
      return;
    }

    this.sendConfigResult(agentId);
  }

  private sendConfigResult(agentId: string): void {
    const config = getLLMConfig();
    this.sessions.send(agentId, {
      type: "config.result",
      config: {
        llmAvailable: isLLMAvailable(),
        llmApiKey: config.llmApiKey ? "••••" + config.llmApiKey.slice(-4) : "",
        llmBaseUrl: config.llmBaseUrl,
        llmModel: config.llmModel,
      },
    });
  }

  // --- Active meetings list ---

  private async handleMeetingActiveList(agentId: string): Promise<void> {
    const meetings: Array<{
      meetingId: string;
      title: string;
      phase: string;
      initiator: string;
      participants: string[];
      status: string;
    }> = [];

    for (const [meetingId, room] of this.activeMeetings) {
      meetings.push({
        meetingId,
        title: room.title,
        phase: room.getPhase(),
        initiator: room.initiatorId,
        participants: room.getParticipants(),
        status: "active",
      });
    }

    this.sessions.send(agentId, {
      type: "meeting.active_list.result",
      meetings,
    });
  }

  // --- Agent process lifecycle ---

  private handleAgentProcessExit(agentId: string, code: number | null, signal: string | null): void {
    // Normal exit (code 0 or SIGINT from despawn) — don't notify
    if (code === 0 || signal === "SIGINT") return;

    // Unexpected crash — notify all connected clients
    logger.warn({ agentId, code, signal }, "Agent process crashed");
    this.sessions.broadcast({
      type: "agent.process_error",
      agentId,
      reason: code !== null ? `Process exited with code ${code}` : `Process killed by ${signal}`,
    });
    this.broadcastDirectoryUpdated();
  }

  // --- Meeting lifecycle ---

  private handleMeetingEnd(meetingId: string): void {
    const despawned = this.spawner.despawnForMeeting(meetingId);
    if (despawned.length > 0) {
      logger.info({ meetingId, despawned }, "Despawned agents after meeting ended");
    }
    this.activeMeetings.delete(meetingId);

    // Clean up ephemeral agents that were despawned
    this.cleanupEphemeralAgents(despawned).catch((err) => {
      logger.error({ err, meetingId }, "Failed to clean up ephemeral agents");
    });

    this.broadcastDirectoryUpdated();
  }

  private async cleanupEphemeralAgents(agentIds: string[]): Promise<void> {
    for (const agentId of agentIds) {
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, agentId),
      });
      if (agent?.ephemeral) {
        await hardDeleteAgent(agentId);
        logger.info({ agentId }, "Cleaned up ephemeral agent after meeting");
      }
    }
  }

  /** Kill all spawned agent processes (called during shutdown). */
  killAllAgents(): void {
    this.spawner.killAll();
  }

  // --- Broadcast helpers ---

  private broadcastDirectoryUpdated(): void {
    this.sessions.broadcast({ type: "directory.updated" });
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
