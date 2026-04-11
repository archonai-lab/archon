import { z } from "zod";
import {
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
} from "../meeting/types.js";
import { taskMetadataSchema } from "../tasks/task-metadata.js";

// --- Auth ---

export const AuthMessage = z.object({
  type: z.literal("auth"),
  agentId: z.string().min(1),
  token: z.string().min(1),
});

export const AuthOkMessage = z.object({
  type: z.literal("auth.ok"),
  agentCard: z.record(z.unknown()),
  pendingInvites: z.array(z.string()),
});

export const AuthErrorMessage = z.object({
  type: z.literal("auth.error"),
  code: z.string(),
  message: z.string(),
});

// --- Directory ---

export const DirectoryListMessage = z.object({
  type: z.literal("directory.list"),
  filter: z
    .object({
      departmentId: z.string().optional(),
    })
    .optional(),
});

export const DirectoryGetMessage = z.object({
  type: z.literal("directory.get"),
  agentId: z.string().min(1),
});

export const DirectoryResultMessage = z.object({
  type: z.literal("directory.result"),
  agents: z.array(z.record(z.unknown())),
});

// --- Agent Status ---

export const AgentStatusMessage = z.object({
  type: z.literal("agent.status"),
  status: z.enum(["online", "offline", "busy"]),
});

// --- Agent CRUD ---

export const AgentCreateMessage = z.object({
  type: z.literal("agent.create"),
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, "Must be lowercase alphanumeric with hyphens/underscores"),
  displayName: z.string().min(1).max(128),
  departments: z.array(z.object({
    departmentId: z.string().min(1),
    roleId: z.string().min(1),
  })).optional(),
  role: z.string().optional(),
  modelConfig: z.record(z.unknown()).optional(),
  ephemeral: z.boolean().optional(),
});

export const AgentUpdateMessage = z.object({
  type: z.literal("agent.update"),
  agentId: z.string().min(1),
  displayName: z.string().min(1).max(128).optional(),
  departments: z.array(z.object({
    departmentId: z.string().min(1),
    roleId: z.string().min(1),
  })).optional(),
  modelConfig: z.record(z.unknown()).optional(),
});

export const AgentDeleteMessage = z.object({
  type: z.literal("agent.delete"),
  agentId: z.string().min(1),
});

export const AgentReactivateMessage = z.object({
  type: z.literal("agent.reactivate"),
  agentId: z.string().min(1),
});

export const AgentEnrichMessage = z.object({
  type: z.literal("agent.enrich"),
  agentId: z.string().min(1),
  identity: z.string().min(1).max(10_000).optional(),
  soul: z.string().min(1).max(10_000).optional(),
});

// --- Department CRUD ---

export const DepartmentListMessage = z.object({
  type: z.literal("department.list"),
});

export const DepartmentCreateMessage = z.object({
  type: z.literal("department.create"),
  name: z.string().min(1).max(128),
  description: z.string().optional(),
});

export const DepartmentUpdateMessage = z.object({
  type: z.literal("department.update"),
  departmentId: z.string().min(1),
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
});

export const DepartmentDeleteMessage = z.object({
  type: z.literal("department.delete"),
  departmentId: z.string().min(1),
});

// --- Role CRUD ---

export const RoleListMessage = z.object({
  type: z.literal("role.list"),
  departmentId: z.string().min(1).optional(),
});

export const RoleCreateMessage = z.object({
  type: z.literal("role.create"),
  departmentId: z.string().min(1),
  name: z.string().min(1).max(128),
  permissions: z.array(z.string()).optional(),
});

export const RoleUpdateMessage = z.object({
  type: z.literal("role.update"),
  roleId: z.string().min(1),
  name: z.string().min(1).max(128).optional(),
  permissions: z.array(z.string()).optional(),
});

export const RoleDeleteMessage = z.object({
  type: z.literal("role.delete"),
  roleId: z.string().min(1),
});

// --- Active Meetings ---

export const MeetingActiveListMessage = z.object({
  type: z.literal("meeting.active_list"),
});

// --- Meeting History ---

export const MeetingHistoryMessage = z.object({
  type: z.literal("meeting.history"),
  status: z.enum(["active", "completed", "cancelled"]).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const MeetingTranscriptMessage = z.object({
  type: z.literal("meeting.transcript"),
  meetingId: z.string().min(1),
});

// --- Hub Config ---

export const ConfigGetMessage = z.object({
  type: z.literal("config.get"),
});

export const ConfigSetMessage = z.object({
  type: z.literal("config.set"),
  key: z.string().min(1),
  value: z.unknown(),
});


// --- Task CRUD ---

export const TaskCreateMessage = z.object({
  type: z.literal('task.create'),
  title: z.string().min(1).max(256),
  description: z.string().optional(),
  assignedTo: z.string().min(1).optional(),
  meetingId: z.string().min(1).optional(),
  taskMetadata: taskMetadataSchema.optional(),
});

export const TaskListMessage = z.object({
  type: z.literal('task.list'),
});

export const TaskGetMessage = z.object({
  type: z.literal('task.get'),
  taskId: z.string().min(1),
});

export const TaskUpdateMessage = z.object({
  type: z.literal('task.update'),
  taskId: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'done', 'failed']).optional(),
  result: z.string().optional(),
});

// --- Ping/Pong ---

export const PingMessage = z.object({ type: z.literal("ping") });
export const PongMessage = z.object({ type: z.literal("pong") });

// --- Envelope: any inbound message from an agent ---

export const InboundMessage = z.discriminatedUnion("type", [
  AuthMessage,
  DirectoryListMessage,
  DirectoryGetMessage,
  AgentStatusMessage,
  PingMessage,
  // Agent CRUD
  AgentCreateMessage,
  AgentUpdateMessage,
  AgentDeleteMessage,
  AgentReactivateMessage,
  AgentEnrichMessage,
  // Department CRUD
  DepartmentListMessage,
  DepartmentCreateMessage,
  DepartmentUpdateMessage,
  DepartmentDeleteMessage,
  // Role CRUD
  RoleListMessage,
  RoleCreateMessage,
  RoleUpdateMessage,
  RoleDeleteMessage,
  // Meeting messages
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
  // Active meetings
  MeetingActiveListMessage,
  // Meeting history
  MeetingHistoryMessage,
  MeetingTranscriptMessage,
  // Task CRUD
  TaskCreateMessage,
  TaskListMessage,
  TaskGetMessage,
  TaskUpdateMessage,
  // Hub config
  ConfigGetMessage,
  ConfigSetMessage,
]);

// --- Type exports ---

export type AuthMessage = z.infer<typeof AuthMessage>;
export type AuthOkMessage = z.infer<typeof AuthOkMessage>;
export type AuthErrorMessage = z.infer<typeof AuthErrorMessage>;
export type DirectoryListMessage = z.infer<typeof DirectoryListMessage>;
export type DirectoryGetMessage = z.infer<typeof DirectoryGetMessage>;
export type DirectoryResultMessage = z.infer<typeof DirectoryResultMessage>;
export type AgentStatusMessage = z.infer<typeof AgentStatusMessage>;
export type AgentCreateMessage = z.infer<typeof AgentCreateMessage>;
export type AgentUpdateMessage = z.infer<typeof AgentUpdateMessage>;
export type AgentDeleteMessage = z.infer<typeof AgentDeleteMessage>;
export type AgentReactivateMessage = z.infer<typeof AgentReactivateMessage>;
export type AgentEnrichMessage = z.infer<typeof AgentEnrichMessage>;
export type DepartmentListMessage = z.infer<typeof DepartmentListMessage>;
export type DepartmentCreateMessage = z.infer<typeof DepartmentCreateMessage>;
export type DepartmentUpdateMessage = z.infer<typeof DepartmentUpdateMessage>;
export type DepartmentDeleteMessage = z.infer<typeof DepartmentDeleteMessage>;
export type RoleListMessage = z.infer<typeof RoleListMessage>;
export type RoleCreateMessage = z.infer<typeof RoleCreateMessage>;
export type RoleUpdateMessage = z.infer<typeof RoleUpdateMessage>;
export type RoleDeleteMessage = z.infer<typeof RoleDeleteMessage>;
export type MeetingActiveListMessage = z.infer<typeof MeetingActiveListMessage>;
export type MeetingHistoryMessage = z.infer<typeof MeetingHistoryMessage>;
export type MeetingTranscriptMessage = z.infer<typeof MeetingTranscriptMessage>;
export type ConfigGetMessage = z.infer<typeof ConfigGetMessage>;
export type ConfigSetMessage = z.infer<typeof ConfigSetMessage>;
export type TaskCreateMessage = z.infer<typeof TaskCreateMessage>;
export type TaskListMessage = z.infer<typeof TaskListMessage>;
export type TaskGetMessage = z.infer<typeof TaskGetMessage>;
export type TaskUpdateMessage = z.infer<typeof TaskUpdateMessage>;
export type InboundMessage = z.infer<typeof InboundMessage>;
