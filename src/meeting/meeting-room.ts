import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { meetings, meetingParticipants, meetingMessages } from "../db/schema.js";
import { logger } from "../utils/logger.js";
import { countTokens, TOKEN_SAFETY_MARGIN } from "./token-counter.js";
import { generateMeetingSummary, type SummaryMode } from "./summarizer.js";
import { TurnManager } from "./turn-manager.js";
import type { Methodology, PhaseCapability } from "./methodology.js";
import { DEFAULT_METHODOLOGY } from "./methodology-parser.js";
import {
  type Proposal,
  type ActionItem,
  type MeetingMessageOut,
  type MeetingPhaseChangeOut,
  type MeetingInviteOut,
  type MeetingRelevanceCheckOut,
  type MeetingYourTurnOut,
  type MeetingProposalOut,
  type MeetingVoteResultOut,
  type MeetingActionItemOut,
  type MeetingCompletedOut,
  type MeetingCancelledOut,
  type MeetingAwaitingApprovalOut,
  type PhaseEndReason,
} from "./types.js";

export interface SendFn {
  (agentId: string, message: unknown): boolean;
}

export interface MeetingRoomOptions {
  id?: string;
  title: string;
  initiatorId: string;
  projectId?: string;
  invitees: string[];
  tokenBudget?: number;
  agenda?: string;
  send: SendFn;
  methodology?: Methodology;
  approvalRequired?: boolean;
  summaryMode?: SummaryMode;
  /** Called when meeting completes or is cancelled. */
  onEnd?: (meetingId: string) => void;
}

export class MeetingRoom {
  readonly id: string;
  readonly title: string;
  readonly initiatorId: string;
  readonly projectId: string | undefined;
  readonly tokenBudget: number;
  readonly agenda: string | undefined;
  readonly methodology: Methodology;
  readonly approvalRequired: boolean;
  readonly summaryMode: SummaryMode;

  private phase: string;
  private phaseIndex: number = 0;
  private status: "active" | "completed" | "cancelled" = "active";
  private awaitingApproval = false;
  private tokensUsed = 0;
  private phaseBudgets: Map<string, number>;
  private phaseTokensUsed: Map<string, number>;

  private participants = new Set<string>();
  private joined = new Set<string>();

  private proposals: Proposal[] = [];
  private actionItems: ActionItem[] = [];
  private messageLog: Array<{ agentId: string; phase: string; content: string }> = [];

  private turnManager = new TurnManager();
  private speakingQueue: string[] = [];
  private currentSpeaker: string | null = null;
  private consecutivePasses = 0;
  private lastMessage: { agentId: string; content: string } | null = null;

  private send: SendFn;
  private onEnd?: (meetingId: string) => void;

  constructor(opts: MeetingRoomOptions) {
    this.id = opts.id ?? nanoid(12);
    this.title = opts.title;
    this.initiatorId = opts.initiatorId;
    this.projectId = opts.projectId;
    this.tokenBudget = opts.tokenBudget ?? 50_000;
    this.agenda = opts.agenda;
    this.send = opts.send;
    this.methodology = opts.methodology ?? DEFAULT_METHODOLOGY;
    this.approvalRequired = opts.approvalRequired ?? false;
    this.summaryMode = opts.summaryMode ?? "off";
    this.onEnd = opts.onEnd;

    // Init phase to first methodology phase
    this.phase = this.methodology.phases[0].name;
    this.phaseIndex = 0;

    // Calculate per-phase budgets from methodology.
    // Apply safety margin because chars/4 underestimates real token counts.
    this.phaseBudgets = new Map();
    this.phaseTokensUsed = new Map();
    for (const phaseDef of this.methodology.phases) {
      this.phaseBudgets.set(
        phaseDef.name,
        Math.floor(this.tokenBudget * phaseDef.budget * TOKEN_SAFETY_MARGIN),
      );
      this.phaseTokensUsed.set(phaseDef.name, 0);
    }

    // Add initiator + invitees as participants
    this.participants.add(opts.initiatorId);
    for (const id of opts.invitees) {
      this.participants.add(id);
    }
  }

  // --- Capability helpers ---

  private currentPhaseDef() {
    return this.methodology.phases[this.phaseIndex];
  }

  private currentPhaseHas(cap: PhaseCapability): boolean {
    return this.currentPhaseDef().capabilities.has(cap);
  }

  // --- Lifecycle ---

  async persist(): Promise<void> {
    await db.insert(meetings).values({
      id: this.id,
      title: this.title,
      initiatorId: this.initiatorId,
      projectId: this.projectId ?? null,
      phase: this.phase,
      status: this.status,
      tokenBudget: this.tokenBudget,
      tokensUsed: this.tokensUsed,
      agenda: this.agenda ?? null,
      methodology: this.methodology.id,
    });

    // Insert participant records
    const rows = [...this.participants].map((agentId) => ({
      meetingId: this.id,
      agentId,
    }));
    if (rows.length > 0) {
      await db.insert(meetingParticipants).values(rows);
    }
  }

  sendInvites(): void {
    for (const agentId of this.participants) {
      if (agentId === this.initiatorId) continue;
      const invite: MeetingInviteOut = {
        type: "meeting.invite",
        meetingId: this.id,
        title: this.title,
        initiator: this.initiatorId,
        agenda: this.agenda,
      };
      this.send(agentId, invite);
    }
  }

  // --- Join/Leave ---

  /** Add an agent as a participant (for admin/CEO joining mid-meeting). */
  addParticipant(agentId: string): void {
    this.participants.add(agentId);
  }

  join(agentId: string): boolean {
    if (!this.participants.has(agentId)) return false;
    if (this.status !== "active") return false;

    this.joined.add(agentId);

    // Update DB
    db.update(meetingParticipants)
      .set({ joinedAt: new Date() })
      .where(and(
        eq(meetingParticipants.meetingId, this.id),
        eq(meetingParticipants.agentId, agentId),
      ))
      .then(() => {})
      .catch((e) => logger.error({ error: e }, "Failed to update participant join"));

    // If all participants joined, notify phase
    if (this.joined.size === this.participants.size) {
      this.broadcastPhaseChange();
    }

    return true;
  }

  leave(agentId: string): void {
    this.joined.delete(agentId);
  }

  // --- Speaking ---

  async speak(agentId: string, content: string): Promise<boolean> {
    if (this.status !== "active") return false;
    if (!this.joined.has(agentId)) return false;

    // Initiator can always speak freely (they're the human driving the meeting)
    const isInitiator = agentId === this.initiatorId;

    if (this.awaitingApproval) {
      if (!isInitiator) return false;
    } else if (!isInitiator) {
      // Non-initiator agents follow turn rules
      if (this.currentPhaseHas("initiator_only")) return false;
      if (this.currentSpeaker !== agentId) return false;
    }

    const tokens = countTokens(content);
    const currentUsed = this.phaseTokensUsed.get(this.phase) ?? 0;
    const currentBudget = this.phaseBudgets.get(this.phase) ?? 0;

    // Check phase budget
    if (currentUsed + tokens > currentBudget) {
      // Budget exhausted → auto-advance
      await this.advancePhase("budget_exhausted");
      return false;
    }

    // Track tokens
    this.phaseTokensUsed.set(this.phase, currentUsed + tokens);
    this.tokensUsed += tokens;
    this.consecutivePasses = 0;
    this.lastMessage = { agentId, content };

    // Persist message
    await db.insert(meetingMessages).values({
      meetingId: this.id,
      agentId,
      phase: this.phase,
      content,
      tokenCount: tokens,
    });
    this.messageLog.push({ agentId, phase: this.phase, content });

    // Broadcast to all participants
    const msg: MeetingMessageOut = {
      type: "meeting.message",
      meetingId: this.id,
      agentId,
      content,
      phase: this.phase,
      tokenCount: tokens,
      budgetRemaining: currentBudget - (currentUsed + tokens),
    };
    this.broadcastToParticipants(msg);

    // After speaking in initiator_only phase, auto-advance to next phase
    if (this.currentPhaseHas("initiator_only")) {
      await this.advancePhase("initiator_only");
    } else {
      // In open phases, start next relevance round
      this.currentSpeaker = null;
      await this.startRelevanceRound();
    }

    return true;
  }

  // --- Relevance ---

  recordRelevance(agentId: string, level: "must_speak" | "could_add" | "pass"): void {
    this.turnManager.addResponse(agentId, level);
  }

  private async startRelevanceRound(): Promise<void> {
    // Guard: don't start rounds on completed/cancelled meetings (e.g., from delayed setTimeout)
    if (this.status !== "active") return;

    // Send relevance check to all joined participants (except initiator and last speaker)
    // Initiator is the facilitator — they don't participate in relevance rounds
    const checkTargets = [...this.joined].filter(
      (id) => id !== this.initiatorId && id !== this.lastMessage?.agentId
    );

    if (checkTargets.length === 0) {
      await this.advancePhase("no_targets");
      return;
    }

    // Build context summary (last few messages)
    const contextSummary = this.lastMessage
      ? `Last message by ${this.lastMessage.agentId}: "${this.lastMessage.content.slice(0, 200)}"`
      : "Meeting just started.";

    // Send relevance checks (skip disconnected agents)
    const reachable: string[] = [];
    for (const agentId of checkTargets) {
      const check: MeetingRelevanceCheckOut = {
        type: "meeting.relevance_check",
        meetingId: this.id,
        lastMessage: this.lastMessage ?? { agentId: "", content: "" },
        phase: this.phase,
        contextSummary,
      };
      if (this.send(agentId, check)) {
        reachable.push(agentId);
      } else {
        logger.warn({ meetingId: this.id, agentId }, "Agent disconnected, treating as pass");
      }
    }

    if (reachable.length === 0) {
      // All agents unreachable — advance immediately (no one to wait for)
      await this.advancePhase("all_passed");
      return;
    }

    // Collect responses (with 10s timeout)
    const queue = await this.turnManager.collect(reachable);

    if (queue.length === 0) {
      // All passed → increment consecutive passes
      this.consecutivePasses++;
      if (this.consecutivePasses >= 2) {
        // Two consecutive all-pass rounds → auto-advance
        await this.advancePhase("all_passed");
      } else {
        // Not enough consecutive passes yet — start another round
        setTimeout(() => this.startRelevanceRound(), 100);
      }
      return;
    }

    this.consecutivePasses = 0;
    this.speakingQueue = queue;
    await this.giveNextTurn();
  }

  private async giveNextTurn(): Promise<void> {
    // Loop instead of recursion to avoid unbounded stack growth
    // when multiple queued agents are disconnected
    while (this.speakingQueue.length > 0) {
      const next = this.speakingQueue.shift()!;
      this.currentSpeaker = next;

      const currentUsed = this.phaseTokensUsed.get(this.phase) ?? 0;
      const currentBudget = this.phaseBudgets.get(this.phase) ?? 0;

      const turn: MeetingYourTurnOut = {
        type: "meeting.your_turn",
        meetingId: this.id,
        phase: this.phase,
        budgetRemaining: currentBudget - currentUsed,
      };

      if (this.send(next, turn)) return; // delivered, wait for agent to speak

      // Agent disconnected — skip their turn, try next
      logger.warn({ meetingId: this.id, agentId: next }, "Agent disconnected, skipping turn");
      this.currentSpeaker = null;
    }

    // Queue exhausted → new relevance round
    await this.startRelevanceRound();
  }

  // --- Phase advancement ---

  /** Check if all proposals have been voted on by all joined participants. */
  private allProposalsVoted(): boolean {
    if (this.proposals.length === 0) return true; // no proposals = nothing to block on
    return this.proposals.every((p) => p.votes.length >= this.joined.size);
  }

  async advance(agentId: string): Promise<boolean> {
    // Only initiator can manually advance
    if (agentId !== this.initiatorId) return false;

    // If awaiting approval, treat advance as approve
    if (this.awaitingApproval) {
      return this.approve(agentId);
    }

    // In DECIDE phase, cannot advance until all proposals are voted on
    if (this.currentPhaseHas("proposals") && !this.allProposalsVoted()) {
      return false;
    }

    await this.advancePhase();
    return true;
  }

  private async advancePhase(
    reason: PhaseEndReason = "manual",
    skipApprovalGate = false,
  ): Promise<void> {
    // If approval is required, pause and ask initiator before advancing
    if (!skipApprovalGate && this.approvalRequired && !this.awaitingApproval) {
      this.awaitingApproval = true;
      this.currentSpeaker = null;
      this.speakingQueue = [];

      const isLastPhase = this.phaseIndex >= this.methodology.phases.length - 1;
      const nextPhase = isLastPhase
        ? null
        : this.methodology.phases[this.phaseIndex + 1].name;

      const currentUsed = this.phaseTokensUsed.get(this.phase) ?? 0;
      const currentBudget = this.phaseBudgets.get(this.phase) ?? 0;

      const msg: MeetingAwaitingApprovalOut = {
        type: "meeting.awaiting_approval",
        meetingId: this.id,
        currentPhase: this.phase,
        nextPhase,
        summary: {
          messagesInPhase: 0, // TODO: track per-phase message count
          tokensUsed: currentUsed,
          tokenBudget: currentBudget,
        },
      };
      // Broadcast to all participants (initiator + agents)
      this.broadcastToParticipants(msg);

      logger.info({ meetingId: this.id, currentPhase: this.phase, nextPhase }, "Awaiting initiator approval to advance phase");
      return;
    }

    // Use methodology phases array for next phase
    if (this.phaseIndex >= this.methodology.phases.length - 1) {
      await this.completeMeeting(reason);
      return;
    }

    const prevPhase = this.phase;
    this.phaseIndex++;
    this.phase = this.methodology.phases[this.phaseIndex].name;
    this.currentSpeaker = null;
    this.speakingQueue = [];
    this.consecutivePasses = 0;
    this.awaitingApproval = false;

    logger.info(
      { meetingId: this.id, from: prevPhase, to: this.phase, reason },
      "Phase advanced",
    );

    // Update DB
    await db
      .update(meetings)
      .set({ phase: this.phase, tokensUsed: this.tokensUsed })
      .where(eq(meetings.id, this.id));

    this.broadcastPhaseChange();

    // Auto-start relevance round for non-initiator_only phases
    if (!this.currentPhaseHas("initiator_only")) {
      // Small delay to let clients process phase change
      setTimeout(() => this.startRelevanceRound(), 100);
    }
  }

  /** Initiator approves advancing to the next phase */
  async approve(agentId: string): Promise<boolean> {
    if (agentId !== this.initiatorId) return false;
    if (!this.awaitingApproval) return false;

    // Skip the approval gate — this IS the approval
    await this.advancePhase("approval", /* skipApprovalGate */ true);
    return true;
  }

  // --- DECIDE phase: proposals & voting (requires "proposals" capability) ---

  async propose(agentId: string, proposal: string): Promise<boolean> {
    if (!this.currentPhaseHas("proposals")) return false;
    if (!this.joined.has(agentId)) return false;

    const idx = this.proposals.length;
    this.proposals.push({ agentId, proposal, votes: [] });

    // Persist as message
    await db.insert(meetingMessages).values({
      meetingId: this.id,
      agentId,
      phase: this.phase,
      content: `[PROPOSAL] ${proposal}`,
      tokenCount: countTokens(proposal),
    });

    // Broadcast
    const out: MeetingProposalOut = {
      type: "meeting.proposal",
      meetingId: this.id,
      proposalIndex: idx,
      agentId,
      proposal,
    };
    this.broadcastToParticipants(out);

    return true;
  }

  async vote(
    agentId: string,
    proposalIndex: number,
    vote: "approve" | "reject" | "abstain",
    reason?: string
  ): Promise<boolean> {
    if (!this.currentPhaseHas("proposals")) return false;
    if (!this.joined.has(agentId)) return false;
    if (proposalIndex < 0 || proposalIndex >= this.proposals.length) return false;

    const prop = this.proposals[proposalIndex];

    // Prevent double-voting
    if (prop.votes.some((v) => v.agentId === agentId)) return false;

    prop.votes.push({ agentId, vote, reason });

    // Broadcast
    const out: MeetingVoteResultOut = {
      type: "meeting.vote_result",
      meetingId: this.id,
      proposalIndex,
      agentId,
      vote,
      reason,
    };
    this.broadcastToParticipants(out);

    // Check if all proposals fully voted
    const allVoted = this.proposals.every(
      (p) => p.votes.length >= this.joined.size
    );
    if (allVoted) {
      await this.advancePhase("all_voted");
    }

    return true;
  }

  // --- ASSIGN phase: action items (requires "assignments" capability) ---

  async assignTask(
    agentId: string,
    task: string,
    assigneeId: string,
    deadline?: string
  ): Promise<boolean> {
    if (!this.currentPhaseHas("assignments")) return false;
    if (!this.joined.has(agentId)) return false;

    const idx = this.actionItems.length;
    this.actionItems.push({
      task,
      assigneeId,
      assignedBy: agentId,
      deadline,
      acknowledged: false,
    });

    // Broadcast
    const out: MeetingActionItemOut = {
      type: "meeting.action_item",
      meetingId: this.id,
      taskIndex: idx,
      task,
      assigneeId,
      assignedBy: agentId,
      deadline,
    };
    this.broadcastToParticipants(out);

    return true;
  }

  async acknowledge(agentId: string, taskIndex: number): Promise<boolean> {
    if (!this.joined.has(agentId)) return false;
    if (!this.currentPhaseHas("assignments")) return false;
    if (taskIndex < 0 || taskIndex >= this.actionItems.length) return false;

    const item = this.actionItems[taskIndex];
    if (item.assigneeId !== agentId) return false;

    item.acknowledged = true;

    // Check if all items acknowledged → complete
    const allAcked = this.actionItems.every((i) => i.acknowledged);
    if (allAcked && this.actionItems.length > 0) {
      await this.advancePhase("all_acknowledged");
    }

    return true;
  }

  // --- Completion & cancellation ---

  private async completeMeeting(reason?: PhaseEndReason): Promise<void> {
    this.status = "completed";

    // Build decisions from approved proposals
    const decisions = this.proposals
      .filter((p) => {
        const approves = p.votes.filter((v) => v.vote === "approve").length;
        return approves > p.votes.length / 2;
      })
      .map((p) => ({
        proposal: p.proposal,
        proposedBy: p.agentId,
        votes: p.votes,
      }));

    // Generate meeting summary (if enabled for this meeting)
    let summary: string | null = null;
    try {
      summary = await generateMeetingSummary(this.summaryMode, {
        title: this.title,
        agenda: this.agenda,
        participants: [...this.participants],
        messages: this.messageLog,
        decisions,
        actionItems: this.actionItems,
        tokensUsed: this.tokensUsed,
        methodology: this.methodology.id,
      });
    } catch (err) {
      logger.warn({ meetingId: this.id, error: (err as Error).message }, "Failed to generate meeting summary");
    }

    // Persist
    await db
      .update(meetings)
      .set({
        status: "completed",
        tokensUsed: this.tokensUsed,
        decisions,
        actionItems: this.actionItems,
        summary: summary ?? null,
        completedAt: new Date(),
      })
      .where(eq(meetings.id, this.id));

    // Broadcast completion
    const totalBudget = [...this.phaseBudgets.values()].reduce((a, b) => a + b, 0);
    const out: MeetingCompletedOut = {
      type: "meeting.completed",
      meetingId: this.id,
      decisions,
      actionItems: this.actionItems,
      summary: summary ?? undefined,
      reason,
      finalPhase: this.phase,
      budgetRemaining: totalBudget - this.tokensUsed,
    };
    this.broadcastToParticipants(out);

    logger.info({ meetingId: this.id, decisions: decisions.length, actionItems: this.actionItems.length, hasSummary: !!summary }, "Meeting completed");
    this.onEnd?.(this.id);
  }

  async cancel(reason: string): Promise<void> {
    this.status = "cancelled";

    await db
      .update(meetings)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(meetings.id, this.id));

    const out: MeetingCancelledOut = {
      type: "meeting.cancelled",
      meetingId: this.id,
      reason,
    };
    this.broadcastToParticipants(out);

    logger.info({ meetingId: this.id, reason }, "Meeting cancelled");
    this.onEnd?.(this.id);
  }

  // --- Utilities ---

  private broadcastToParticipants(message: unknown): void {
    for (const agentId of this.joined) {
      this.send(agentId, message);
    }
  }

  private broadcastPhaseChange(): void {
    const phaseDef = this.currentPhaseDef();
    const currentUsed = this.phaseTokensUsed.get(this.phase) ?? 0;
    const currentBudget = this.phaseBudgets.get(this.phase) ?? 0;

    const msg: MeetingPhaseChangeOut = {
      type: "meeting.phase_change",
      meetingId: this.id,
      phase: this.phase,
      budgetRemaining: currentBudget - currentUsed,
      phaseDescription: phaseDef.description,
      capabilities: [...phaseDef.capabilities],
    };
    this.broadcastToParticipants(msg);
  }

  // --- Getters ---

  getPhase(): string {
    return this.phase;
  }

  getStatus(): "active" | "completed" | "cancelled" {
    return this.status;
  }

  getParticipants(): string[] {
    return [...this.participants];
  }

  getJoined(): string[] {
    return [...this.joined];
  }

  getTokensUsed(): number {
    return this.tokensUsed;
  }

  getPhaseTokensUsed(phase: string): number {
    return this.phaseTokensUsed.get(phase) ?? 0;
  }

  getPhaseBudget(phase: string): number {
    return this.phaseBudgets.get(phase) ?? 0;
  }

  getProposals(): readonly Proposal[] {
    return this.proposals;
  }

  getActionItems(): readonly ActionItem[] {
    return this.actionItems;
  }

  getCurrentSpeaker(): string | null {
    return this.currentSpeaker;
  }

  isActive(): boolean {
    return this.status === "active";
  }

  getMethodology(): Methodology {
    return this.methodology;
  }
}
