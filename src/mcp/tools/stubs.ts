import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

function notImplemented(toolName: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: `${toolName}: not yet implemented`,
      },
    ],
  };
}

export function contextGet(): CallToolResult {
  return notImplemented('context_get');
}

export function meetingJoin(): CallToolResult {
  return notImplemented('meeting_join');
}

export function statusReport(): CallToolResult {
  return notImplemented('status_report');
}
