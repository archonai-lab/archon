#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadIdentity } from './tools/identity.js';
import { contextGet, meetingJoin, statusReport } from './tools/stubs.js';
import { connect, shutdown } from './bridge.js';

const agentId = process.env.ARCHON_AGENT_ID;
if (!agentId) {
  console.error('Fatal: ARCHON_AGENT_ID environment variable is required.');
  process.exit(1);
}

const server = new McpServer({
  name: 'archon-agent',
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

// Clean shutdown on process exit
async function handleShutdown(): Promise<void> {
  await shutdown();
  process.exit(0);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

async function main() {
  // Connect the neural memory bridge before accepting any tool calls.
  // Fail fast: if nmem-mcp won't spawn, the agent cannot function.
  await connect(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('archon-agent failed to start:', err);
  process.exit(1);
});
