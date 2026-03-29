import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface IdentityResult {
  agentId: string;
  soul: string;
  identity: string;
}

/**
 * Resolve the workspace path for an agent.
 * Agents live at ~/.archon/agents/<id>/
 */
export function resolveAgentWorkspace(agentId: string): string {
  return join(homedir(), '.archon', 'agents', agentId);
}

/**
 * Load SOUL.md and IDENTITY.md from an agent's workspace.
 * Throws if either file is missing — identity is not optional.
 */
export async function loadIdentity(agentId: string): Promise<IdentityResult> {
  const workspace = resolveAgentWorkspace(agentId);

  const [soul, identity] = await Promise.all([
    readFile(join(workspace, 'SOUL.md'), 'utf-8').catch(() => {
      throw new Error(`SOUL.md not found at ${workspace}/SOUL.md`);
    }),
    readFile(join(workspace, 'IDENTITY.md'), 'utf-8').catch(() => {
      throw new Error(`IDENTITY.md not found at ${workspace}/IDENTITY.md`);
    }),
  ]);

  return { agentId, soul, identity };
}
