/**
 * Reusable agent WebSocket client for connecting to the Archon hub.
 *
 * Handles auth handshake, meeting participation, reconnect with backoff,
 * and event-based message dispatch.
 *
 * Usage:
 *   const client = new AgentClient({ agentId: "alice", hubUrl: "ws://localhost:9500" });
 *   client.on("meeting.invite", (msg) => { ... });
 *   client.connect();
 */

import WebSocket from "ws";
import { EventEmitter } from "events";

// --- Types ---

export interface AgentClientOptions {
  agentId: string;
  token?: string; // defaults to agentId (MVP auth)
  hubUrl?: string; // defaults to ws://localhost:9500
  reconnect?: boolean; // defaults to true
  maxReconnectDelay?: number; // max backoff in ms, defaults to 30_000
  pingInterval?: number; // keepalive interval in ms, defaults to 30_000
}

/** All outbound hub message types the client might receive. */
export type HubMessage =
  | { type: "auth.ok"; agentCard: Record<string, unknown>; pendingInvites: string[] }
  | { type: "directory.result"; agents: Record<string, unknown>[] }
  | { type: "directory.updated" }
  | { type: "agent.created"; agentId: string; displayName: string }
  | { type: "agent.updated"; agentId: string }
  | { type: "agent.deleted"; agentId: string }
  | { type: "department.result"; departments: Record<string, unknown>[] }
  | { type: "department.created"; departmentId: string; name: string }
  | { type: "department.updated"; departmentId: string }
  | { type: "department.deleted"; departmentId: string }
  | { type: "role.result"; roles: Record<string, unknown>[] }
  | { type: "role.created"; roleId: string; name: string; departmentId: string }
  | { type: "role.updated"; roleId: string }
  | { type: "role.deleted"; roleId: string }
  | { type: "meeting.invite"; meetingId: string; title: string; initiator: string; agenda?: string }
  | { type: "meeting.phase_change"; meetingId: string; phase: string; budgetRemaining: number }
  | { type: "meeting.message"; meetingId: string; agentId: string; content: string; phase: string; tokenCount: number; budgetRemaining: number }
  | { type: "meeting.relevance_check"; meetingId: string; lastMessage: { agentId: string; content: string }; phase: string; contextSummary: string }
  | { type: "meeting.your_turn"; meetingId: string; phase: string; budgetRemaining: number }
  | { type: "meeting.proposal"; meetingId: string; proposalIndex: number; agentId: string; proposal: string }
  | { type: "meeting.vote_result"; meetingId: string; proposalIndex: number; agentId: string; vote: string; reason?: string }
  | { type: "meeting.action_item"; meetingId: string; taskIndex: number; task: string; assigneeId: string; assignedBy: string; deadline?: string }
  | { type: "meeting.completed"; meetingId: string; decisions: unknown[]; actionItems: unknown[] }
  | { type: "meeting.cancelled"; meetingId: string; reason: string }
  | { type: "meeting.history.result"; meetings: unknown[] }
  | { type: "meeting.transcript.result"; meeting: unknown; messages: unknown[]; participants: string[] }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }
  | { type: string; [key: string]: unknown };

export interface AgentClientEvents {
  connected: [];
  disconnected: [code: number, reason: string];
  error: [error: Error];
  message: [msg: HubMessage];
  // Specific event shortcuts
  "auth.ok": [msg: Extract<HubMessage, { type: "auth.ok" }>];
  "directory.updated": [msg: Extract<HubMessage, { type: "directory.updated" }>];
  "agent.created": [msg: Extract<HubMessage, { type: "agent.created" }>];
  "agent.updated": [msg: Extract<HubMessage, { type: "agent.updated" }>];
  "agent.deleted": [msg: Extract<HubMessage, { type: "agent.deleted" }>];
  "department.result": [msg: Extract<HubMessage, { type: "department.result" }>];
  "department.created": [msg: Extract<HubMessage, { type: "department.created" }>];
  "role.result": [msg: Extract<HubMessage, { type: "role.result" }>];
  "role.created": [msg: Extract<HubMessage, { type: "role.created" }>];
  "meeting.invite": [msg: Extract<HubMessage, { type: "meeting.invite" }>];
  "meeting.phase_change": [msg: Extract<HubMessage, { type: "meeting.phase_change" }>];
  "meeting.message": [msg: Extract<HubMessage, { type: "meeting.message" }>];
  "meeting.relevance_check": [msg: Extract<HubMessage, { type: "meeting.relevance_check" }>];
  "meeting.your_turn": [msg: Extract<HubMessage, { type: "meeting.your_turn" }>];
  "meeting.proposal": [msg: Extract<HubMessage, { type: "meeting.proposal" }>];
  "meeting.vote_result": [msg: Extract<HubMessage, { type: "meeting.vote_result" }>];
  "meeting.action_item": [msg: Extract<HubMessage, { type: "meeting.action_item" }>];
  "meeting.completed": [msg: Extract<HubMessage, { type: "meeting.completed" }>];
  "meeting.cancelled": [msg: Extract<HubMessage, { type: "meeting.cancelled" }>];
  "meeting.history.result": [msg: Extract<HubMessage, { type: "meeting.history.result" }>];
  "meeting.transcript.result": [msg: Extract<HubMessage, { type: "meeting.transcript.result" }>];
  "hub.error": [msg: Extract<HubMessage, { type: "error" }>];
}

export class AgentClient extends EventEmitter<AgentClientEvents> {
  readonly agentId: string;
  private readonly token: string;
  private readonly hubUrl: string;
  private readonly shouldReconnect: boolean;
  private readonly maxReconnectDelay: number;
  private readonly pingInterval: number;

  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  constructor(opts: AgentClientOptions) {
    super();
    this.agentId = opts.agentId;
    this.token = opts.token ?? opts.agentId;
    this.hubUrl = opts.hubUrl ?? "ws://localhost:9500";
    this.shouldReconnect = opts.reconnect ?? true;
    this.maxReconnectDelay = opts.maxReconnectDelay ?? 30_000;
    this.pingInterval = opts.pingInterval ?? 30_000;
  }

  // --- Connection lifecycle ---

  connect(): void {
    this.intentionallyClosed = false;
    this.ws = new WebSocket(this.hubUrl);

    this.ws.on("open", () => {
      this.reconnectAttempts = 0;
      this.send({ type: "auth", agentId: this.agentId, token: this.token });
      this.startPing();
    });

    this.ws.on("message", (raw) => {
      let msg: HubMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed messages
      }

      // Emit generic + specific event
      this.emit("message", msg);
      if (msg.type === "auth.ok") {
        this.emit("connected");
      }
      // Hub "error" messages must NOT use the native EventEmitter "error" event
      // (which throws if no listener is attached). Emit as "hub.error" instead.
      if (msg.type === "error") {
        this.emit("hub.error", msg as never);
        return;
      }
      // Emit typed event for known message types
      this.emit(msg.type as keyof AgentClientEvents, msg as never);
    });

    this.ws.on("close", (code, reason) => {
      this.cleanup();
      const reasonStr = reason.toString();
      this.emit("disconnected", code, reasonStr);

      if (this.shouldReconnect && !this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // --- Send helpers ---

  send(data: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(data));
    return true;
  }

  // --- Meeting participation helpers ---

  joinMeeting(meetingId: string): boolean {
    return this.send({ type: "meeting.join", meetingId });
  }

  leaveMeeting(meetingId: string): boolean {
    return this.send({ type: "meeting.leave", meetingId });
  }

  speak(meetingId: string, content: string): boolean {
    return this.send({ type: "meeting.speak", meetingId, content });
  }

  sendRelevance(meetingId: string, level: "must_speak" | "could_add" | "pass", reason?: string): boolean {
    return this.send({ type: "meeting.relevance", meetingId, level, reason });
  }

  advanceMeeting(meetingId: string): boolean {
    return this.send({ type: "meeting.advance", meetingId });
  }

  propose(meetingId: string, proposal: string): boolean {
    return this.send({ type: "meeting.propose", meetingId, proposal });
  }

  vote(meetingId: string, proposalIndex: number, vote: "approve" | "reject" | "abstain", reason?: string): boolean {
    return this.send({ type: "meeting.vote", meetingId, proposalIndex, vote, reason });
  }

  assignTask(meetingId: string, task: string, assigneeId: string, deadline?: string): boolean {
    return this.send({ type: "meeting.assign", meetingId, task, assigneeId, deadline });
  }

  acknowledge(meetingId: string, taskIndex: number): boolean {
    return this.send({ type: "meeting.acknowledge", meetingId, taskIndex });
  }

  approveMeeting(meetingId: string): boolean {
    return this.send({ type: "meeting.approve", meetingId });
  }

  createMeeting(title: string, invitees: string[], opts?: { agenda?: string; tokenBudget?: number; projectId?: string; methodology?: string; approvalRequired?: boolean }): boolean {
    return this.send({
      type: "meeting.create",
      title,
      invitees,
      ...opts,
    });
  }

  // --- Agent CRUD ---

  createAgent(name: string, displayName: string, opts?: {
    departments?: Array<{ departmentId: string; roleId: string }>;
    role?: string;
    modelConfig?: Record<string, unknown>;
  }): boolean {
    return this.send({ type: "agent.create", name, displayName, ...opts });
  }

  updateAgent(agentId: string, opts: {
    displayName?: string;
    departments?: Array<{ departmentId: string; roleId: string }>;
    modelConfig?: Record<string, unknown>;
  }): boolean {
    return this.send({ type: "agent.update", agentId, ...opts });
  }

  deleteAgent(agentId: string): boolean {
    return this.send({ type: "agent.delete", agentId });
  }

  // --- Department CRUD ---

  listDepartments(): boolean {
    return this.send({ type: "department.list" });
  }

  createDepartment(name: string, description?: string): boolean {
    return this.send({ type: "department.create", name, description });
  }

  updateDepartment(departmentId: string, opts: { name?: string; description?: string }): boolean {
    return this.send({ type: "department.update", departmentId, ...opts });
  }

  deleteDepartment(departmentId: string): boolean {
    return this.send({ type: "department.delete", departmentId });
  }

  // --- Role CRUD ---

  listRoles(departmentId?: string): boolean {
    return this.send({ type: "role.list", departmentId });
  }

  createRole(departmentId: string, name: string, permissions?: string[]): boolean {
    return this.send({ type: "role.create", departmentId, name, permissions });
  }

  updateRole(roleId: string, opts: { name?: string; permissions?: string[] }): boolean {
    return this.send({ type: "role.update", roleId, ...opts });
  }

  deleteRole(roleId: string): boolean {
    return this.send({ type: "role.delete", roleId });
  }

  // --- Meeting history ---

  listMeetings(opts?: { status?: "active" | "completed" | "cancelled"; cursor?: string; limit?: number }): boolean {
    return this.send({ type: "meeting.history", ...opts });
  }

  getMeetingTranscript(meetingId: string): boolean {
    return this.send({ type: "meeting.transcript", meetingId });
  }

  // --- Directory ---

  listAgents(filter?: { departmentId?: string }): boolean {
    return this.send({ type: "directory.list", filter });
  }

  getAgent(agentId: string): boolean {
    return this.send({ type: "directory.get", agentId });
  }

  // --- Reconnect ---

  private scheduleReconnect(): void {
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, this.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
