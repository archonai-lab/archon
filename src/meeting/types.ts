import { z } from "zod";

// --- Phase & Relevance enums ---

/** Phase is now a free-form string — methodology defines the valid phases. */
export const Phase = z.string().min(1);
export type Phase = string;

export const MeetingStatus = z.enum(["active", "completed", "cancelled"]);
export type MeetingStatus = z.infer<typeof MeetingStatus>;

export const RelevanceLevel = z.enum(["must_speak", "could_add", "pass"]);
export type RelevanceLevel = z.infer<typeof RelevanceLevel>;

// --- Inbound meeting messages (agent → hub) ---

export const MeetingCreateMessage = z.object({
  type: z.literal("meeting.create"),
  title: z.string().min(1),
  projectId: z.string().optional(),
  invitees: z.array(z.string().min(1)).min(1),
  tokenBudget: z.number().int().positive().optional(),
  agenda: z.string().optional(),
  methodology: z.string().optional(),
  approvalRequired: z.boolean().optional(),
  summaryMode: z.enum(["off", "structured", "llm"]).optional(),
});

export const MeetingJoinMessage = z.object({
  type: z.literal("meeting.join"),
  meetingId: z.string().min(1),
});

export const MeetingLeaveMessage = z.object({
  type: z.literal("meeting.leave"),
  meetingId: z.string().min(1),
});

export const MeetingSpeakMessage = z.object({
  type: z.literal("meeting.speak"),
  meetingId: z.string().min(1),
  content: z.string().min(1).max(100_000),
});

export const MeetingRelevanceMessage = z.object({
  type: z.literal("meeting.relevance"),
  meetingId: z.string().min(1),
  level: RelevanceLevel,
  reason: z.string().optional(),
});

export const MeetingAdvanceMessage = z.object({
  type: z.literal("meeting.advance"),
  meetingId: z.string().min(1),
});

export const MeetingProposeMessage = z.object({
  type: z.literal("meeting.propose"),
  meetingId: z.string().min(1),
  proposal: z.string().min(1),
});

export const MeetingVoteMessage = z.object({
  type: z.literal("meeting.vote"),
  meetingId: z.string().min(1),
  proposalIndex: z.number().int().min(0),
  vote: z.enum(["approve", "reject", "abstain"]),
  reason: z.string().optional(),
});

export const MeetingAssignMessage = z.object({
  type: z.literal("meeting.assign"),
  meetingId: z.string().min(1),
  task: z.string().min(1),
  assigneeId: z.string().min(1),
  deadline: z.string().optional(),
});

export const MeetingAcknowledgeMessage = z.object({
  type: z.literal("meeting.acknowledge"),
  meetingId: z.string().min(1),
  taskIndex: z.number().int().min(0),
});

export const MeetingApproveMessage = z.object({
  type: z.literal("meeting.approve"),
  meetingId: z.string().min(1),
});

export const MeetingCancelMessage = z.object({
  type: z.literal("meeting.cancel"),
  meetingId: z.string().min(1),
  reason: z.string().optional(),
});

// --- All inbound meeting message types ---

export const MeetingInboundMessage = z.discriminatedUnion("type", [
  MeetingCreateMessage,
  MeetingJoinMessage,
  MeetingLeaveMessage,
  MeetingSpeakMessage,
  MeetingRelevanceMessage,
  MeetingAdvanceMessage,
  MeetingProposeMessage,
  MeetingVoteMessage,
  MeetingAssignMessage,
  MeetingAcknowledgeMessage,
  MeetingApproveMessage,
  MeetingCancelMessage,
]);

export type MeetingCreateMessage = z.infer<typeof MeetingCreateMessage>;
export type MeetingJoinMessage = z.infer<typeof MeetingJoinMessage>;
export type MeetingLeaveMessage = z.infer<typeof MeetingLeaveMessage>;
export type MeetingSpeakMessage = z.infer<typeof MeetingSpeakMessage>;
export type MeetingRelevanceMessage = z.infer<typeof MeetingRelevanceMessage>;
export type MeetingAdvanceMessage = z.infer<typeof MeetingAdvanceMessage>;
export type MeetingProposeMessage = z.infer<typeof MeetingProposeMessage>;
export type MeetingVoteMessage = z.infer<typeof MeetingVoteMessage>;
export type MeetingAssignMessage = z.infer<typeof MeetingAssignMessage>;
export type MeetingAcknowledgeMessage = z.infer<typeof MeetingAcknowledgeMessage>;
export type MeetingApproveMessage = z.infer<typeof MeetingApproveMessage>;
export type MeetingCancelMessage = z.infer<typeof MeetingCancelMessage>;
export type MeetingInboundMessage = z.infer<typeof MeetingInboundMessage>;

// --- Outbound meeting messages (hub → agent) ---

export interface MeetingInviteOut {
  type: "meeting.invite";
  meetingId: string;
  title: string;
  initiator: string;
  agenda?: string;
}

export interface MeetingPhaseChangeOut {
  type: "meeting.phase_change";
  meetingId: string;
  phase: string;
  budgetRemaining: number;
  phaseDescription?: string;
  capabilities?: string[];
}

export interface MeetingMessageOut {
  type: "meeting.message";
  meetingId: string;
  agentId: string;
  content: string;
  phase: string;
  tokenCount: number;
  budgetRemaining: number;
}

export interface MeetingRelevanceCheckOut {
  type: "meeting.relevance_check";
  meetingId: string;
  lastMessage: { agentId: string; content: string };
  phase: string;
  contextSummary: string;
}

export interface MeetingYourTurnOut {
  type: "meeting.your_turn";
  meetingId: string;
  phase: string;
  budgetRemaining: number;
}

export interface MeetingProposalOut {
  type: "meeting.proposal";
  meetingId: string;
  proposalIndex: number;
  agentId: string;
  proposal: string;
}

export interface MeetingVoteResultOut {
  type: "meeting.vote_result";
  meetingId: string;
  proposalIndex: number;
  agentId: string;
  vote: "approve" | "reject" | "abstain";
  reason?: string;
}

export interface MeetingActionItemOut {
  type: "meeting.action_item";
  meetingId: string;
  taskIndex: number;
  task: string;
  assigneeId: string;
  assignedBy: string;
  deadline?: string;
}

export interface MeetingCompletedOut {
  type: "meeting.completed";
  meetingId: string;
  decisions: unknown[];
  actionItems: unknown[];
  summary?: string;
}

export interface MeetingAwaitingApprovalOut {
  type: "meeting.awaiting_approval";
  meetingId: string;
  currentPhase: string;
  nextPhase: string | null;
  summary: {
    messagesInPhase: number;
    tokensUsed: number;
    tokenBudget: number;
  };
}

export interface MeetingCancelledOut {
  type: "meeting.cancelled";
  meetingId: string;
  reason: string;
}

// --- Proposal & ActionItem data structures ---

export interface Proposal {
  agentId: string;
  proposal: string;
  votes: Array<{
    agentId: string;
    vote: "approve" | "reject" | "abstain";
    reason?: string;
  }>;
}

export interface ActionItem {
  task: string;
  assigneeId: string;
  assignedBy: string;
  deadline?: string;
  acknowledged: boolean;
}
