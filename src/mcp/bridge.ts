import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

let _client: Client | null = null;
let _transport: StdioClientTransport | null = null;

/**
 * Spawns nmem-mcp as a child process, connects via StdioClientTransport,
 * performs a health check via listTools(), and registers each tool on the
 * provided McpServer instance.
 *
 * Throws — and crashes the process — if spawn or health check fails.
 * An agent without memory is broken, not degraded.
 */
export async function connect(server: McpServer): Promise<void> {
  _transport = new StdioClientTransport({
    command: 'uvx',
    args: ['--from', 'neural-memory', 'nmem-mcp'],
    stderr: 'inherit',
  });

  _client = new Client(
    { name: 'archon-agent', version: '0.1.0' },
    { capabilities: {} },
  );

  await _client.connect(_transport);

  // Health check — fail fast if nmem-mcp is not responsive
  let tools: Awaited<ReturnType<Client['listTools']>>;
  try {
    tools = await _client.listTools();
  } catch (err) {
    throw new Error(`nmem-mcp health check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Register each neural memory tool on the MCP server, forwarding calls
  // through the bridge. No filtering — that's a future tier concern.
  for (const tool of tools.tools) {
    const toolName = tool.name;
    const toolDescription = tool.description ?? '';
    server.tool(
      toolName,
      toolDescription,
      async (args: Record<string, unknown>) => {
        return callTool(toolName, args);
      },
    );
  }
}

/**
 * Forward a tool call to the nmem-mcp child process.
 * Does not filter or restrict — dumb passthrough by design.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!_client) {
    throw new Error('Bridge not connected. Call connect() first.');
  }
  const result = await _client.callTool({ name, arguments: args });
  return result as CallToolResult;
}

/**
 * Close the client connection and kill the child process.
 */
export async function shutdown(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
  _transport = null;
}

/**
 * Expose the underlying Client for testing.
 */
export function getClient(): Client {
  if (!_client) {
    throw new Error('Bridge not connected.');
  }
  return _client;
}
