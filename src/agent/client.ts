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

  createMeeting(title: string, invitees: string[], opts?: { agenda?: string; tokenBudget?: number; projectId?: string; methodology?: string }): boolean {
    return this.send({
      type: "meeting.create",
      title,
      invitees,
      ...opts,
    });
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
