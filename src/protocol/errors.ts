export const ErrorCode = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_FAILED: "AUTH_FAILED",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  UNKNOWN_TYPE: "UNKNOWN_TYPE",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  MEETING_NOT_FOUND: "MEETING_NOT_FOUND",
  MEETING_FULL: "MEETING_FULL",
  NOT_IN_MEETING: "NOT_IN_MEETING",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  ALREADY_IN_MEETING: "ALREADY_IN_MEETING",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  AGENT_PROCESS_ERROR: "AGENT_PROCESS_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Static error messages — the ONLY strings ever sent to clients. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "Authentication required",
  AUTH_FAILED: "Authentication failed",
  INVALID_MESSAGE: "Invalid message format",
  UNKNOWN_TYPE: "Unsupported message type",
  AGENT_NOT_FOUND: "Agent not found",
  PERMISSION_DENIED: "Permission denied",
  MEETING_NOT_FOUND: "Meeting not found",
  MEETING_FULL: "Meeting is full",
  NOT_IN_MEETING: "Not in a meeting",
  NOT_YOUR_TURN: "Action not available in current phase",
  ALREADY_IN_MEETING: "Already in a meeting",
  INTERNAL_ERROR: "Internal error",
  AGENT_PROCESS_ERROR: "Agent process terminated unexpectedly",
};

export interface ErrorMessage {
  type: "error";
  code: ErrorCode;
  message: string;
}

/**
 * Create a client-facing error. Message is derived solely from ERROR_MESSAGES —
 * no freeform strings ever reach the wire.
 */
export function createError(code: ErrorCode): ErrorMessage {
  return { type: "error", code, message: ERROR_MESSAGES[code] };
}
