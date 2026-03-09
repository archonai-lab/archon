import { z } from "zod";

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

export const DirectoryResultMessage = z.object({
  type: z.literal("directory.result"),
  agents: z.array(z.record(z.unknown())),
});

// --- Agent Status ---

export const AgentStatusMessage = z.object({
  type: z.literal("agent.status"),
  status: z.enum(["online", "offline", "busy"]),
});

// --- Ping/Pong ---

export const PingMessage = z.object({ type: z.literal("ping") });
export const PongMessage = z.object({ type: z.literal("pong") });

// --- Envelope: any inbound message from an agent ---

export const InboundMessage = z.discriminatedUnion("type", [
  AuthMessage,
  DirectoryListMessage,
  AgentStatusMessage,
  PingMessage,
]);

// --- Type exports ---

export type AuthMessage = z.infer<typeof AuthMessage>;
export type AuthOkMessage = z.infer<typeof AuthOkMessage>;
export type AuthErrorMessage = z.infer<typeof AuthErrorMessage>;
export type DirectoryListMessage = z.infer<typeof DirectoryListMessage>;
export type DirectoryResultMessage = z.infer<typeof DirectoryResultMessage>;
export type AgentStatusMessage = z.infer<typeof AgentStatusMessage>;
export type InboundMessage = z.infer<typeof InboundMessage>;
