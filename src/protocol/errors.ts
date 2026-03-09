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
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ErrorMessage {
  type: "error";
  code: ErrorCode;
  message: string;
}

export function createError(code: ErrorCode, message: string): ErrorMessage {
  return { type: "error", code, message };
}
