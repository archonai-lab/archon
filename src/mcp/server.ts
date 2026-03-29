#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadIdentity } from './tools/identity.js';
import { contextGet, meetingJoin, statusReport } from './tools/stubs.js';

const agentId = process.env.ARCHON_AGENT_ID;
if (!agentId) {
  console.error('Fatal: ARCHON_AGENT_ID environment variable is required.');
  process.exit(1);
}

const server = new McpServer({
  name: 'archon-brain',
  version: '0.1.0',
});

// Live tool: loads agent identity from ~/.archon/agents/<id>/
server.tool(
  'identity_load',
  'Load this agent\'s SOUL.md and IDENTITY.md from its workspace',
  async () => {
    const result = await loadIdentity(agentId);
    return {
      content: [
        { type: 'text', text: `# Soul\n\n${result.soul}` },
        { type: 'text', text: `# Identity\n\n${result.identity}` },
      ],
    };
  },
);

// Stub tools — return explicit "not yet implemented" errors
server.tool(
  'context_get',
  'Get the current context for this agent (meeting state, active tasks, etc.)',
  () => contextGet(),
);

server.tool(
  'meeting_join',
  'Join an active meeting room',
  () => meetingJoin(),
);

server.tool(
  'status_report',
  'Report current status to the hub',
  () => statusReport(),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('archon-brain failed to start:', err);
  process.exit(1);
});
