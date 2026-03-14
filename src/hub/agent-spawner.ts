/**
 * AgentSpawner — Hub-managed lifecycle for ephemeral agent processes.
 *
 * When a meeting is created, the hub spawns agent processes for each invitee
 * that isn't already connected. Agents are killed when the meeting completes
 * or is cancelled. Agents are ephemeral — spawned on demand, despawned when done.
 */

import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { agents } from "../db/schema.js";
import { logger } from "../utils/logger.js";

interface ModelConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

interface SpawnedAgent {
  agentId: string;
  process: ChildProcess;
  meetingIds: Set<string>;
  spawnedAt: Date;
}

export interface SpawnResult {
  spawned: string[];
  failed: Array<{ agentId: string; reason: string }>;
}

export interface AgentSpawnerCallbacks {
  /** Called when an agent process crashes or exits unexpectedly. */
  onProcessExit?: (agentId: string, code: number | null, signal: string | null) => void;
}

export class AgentSpawner {
  private spawned = new Map<string, SpawnedAgent>();
  private hubUrl: string;
  private callbacks: AgentSpawnerCallbacks;

  /** Agent IDs that should never be auto-spawned (e.g., human-controlled agents). */
  private excludeIds = new Set<string>(["ceo"]);

  constructor(hubUrl = "ws://127.0.0.1:9500", callbacks: AgentSpawnerCallbacks = {}) {
    this.hubUrl = hubUrl;
    this.callbacks = callbacks;
  }

  /** Spawn agent processes for a meeting. Returns both successes and failures. */
  async spawnForMeeting(agentIds: string[], meetingId: string): Promise<SpawnResult> {
    const result: SpawnResult = { spawned: [], failed: [] };

    for (const agentId of agentIds) {
      if (this.excludeIds.has(agentId)) continue;

      const existing = this.spawned.get(agentId);
      if (existing) {
        // Agent already running — just track this meeting
        existing.meetingIds.add(meetingId);
        continue;
      }

      const spawnResult = await this.spawn(agentId, meetingId);
      if (spawnResult.ok) {
        result.spawned.push(agentId);
      } else {
        result.failed.push({ agentId, reason: spawnResult.reason });
      }
    }

    return result;
  }

  /** Despawn agents that were only in this meeting. Agents in multiple meetings stay alive. */
  despawnForMeeting(meetingId: string): string[] {
    const despawned: string[] = [];

    for (const [agentId, entry] of this.spawned) {
      entry.meetingIds.delete(meetingId);

      if (entry.meetingIds.size === 0) {
        this.kill(agentId);
        despawned.push(agentId);
      }
    }

    return despawned;
  }

  /** Kill all spawned agents (used during shutdown). */
  killAll(): void {
    for (const agentId of [...this.spawned.keys()]) {
      this.kill(agentId);
    }
  }

  /** Check if an agent is spawned. */
  isSpawned(agentId: string): boolean {
    return this.spawned.has(agentId);
  }

  /** Get all spawned agent IDs. */
  getSpawnedIds(): string[] {
    return [...this.spawned.keys()];
  }

  private async spawn(
    agentId: string,
    meetingId: string
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    // Look up model config from DB
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
      columns: { modelConfig: true, status: true },
    });

    if (!agent) {
      const reason = `Agent "${agentId}" not found`;
      logger.warn({ agentId }, reason);
      return { ok: false, reason };
    }

    if (agent.status === "deactivated") {
      const reason = `Agent "${agentId}" is deactivated`;
      logger.warn({ agentId }, reason);
      return { ok: false, reason };
    }

    const config = (agent.modelConfig as ModelConfig) ?? {};
    const provider = config.provider ?? "openai";

    const scriptPath = resolve(process.cwd(), "scripts/agent.ts");
    const args = [
      scriptPath,
      "--id", agentId,
      "--provider", provider,
      "--hub", this.hubUrl,
    ];

    if (config.model) args.push("--model", config.model);
    if (config.baseUrl) args.push("--base-url", config.baseUrl);

    try {
      // Use tsx from node_modules/.bin
      const tsxPath = resolve(process.cwd(), "node_modules/.bin/tsx");

      // Minimal env for spawned agents — don't leak hub secrets (DATABASE_URL, API keys)
      const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: process.env.NODE_ENV,
        TERM: process.env.TERM,
        LANG: process.env.LANG,
      };
      if (config.apiKey) env.AGENT_API_KEY = config.apiKey;

      const proc = spawn(tsxPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env,
        detached: false,
      });

      const entry: SpawnedAgent = {
        agentId,
        process: proc,
        meetingIds: new Set([meetingId]),
        spawnedAt: new Date(),
      };

      this.spawned.set(agentId, entry);

      // Log stdout
      proc.stdout?.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) logger.info({ agentId, source: "agent" }, line);
      });

      // Log stderr
      proc.stderr?.on("data", (data: Buffer) => {
        const line = data.toString().trim();
        if (line) logger.warn({ agentId, source: "agent" }, line);
      });

      // Handle exit — notify router so it can inform clients
      proc.on("exit", (code, signal) => {
        this.spawned.delete(agentId);
        logger.info({ agentId, code, signal }, "Agent process exited");
        this.callbacks.onProcessExit?.(agentId, code, signal);
      });

      proc.on("error", (err) => {
        this.spawned.delete(agentId);
        logger.error({ agentId, error: err.message }, "Agent process error");
        this.callbacks.onProcessExit?.(agentId, 1, null);
      });

      logger.info({ agentId, provider, meetingId, pid: proc.pid }, "Agent process spawned");
      return { ok: true };
    } catch (err) {
      const reason = (err as Error).message;
      logger.error({ agentId, error: reason }, "Failed to spawn agent");
      return { ok: false, reason };
    }
  }

  private kill(agentId: string): void {
    const entry = this.spawned.get(agentId);
    if (!entry) return;

    try {
      // Send SIGINT for graceful shutdown (agent handles this)
      entry.process.kill("SIGINT");
    } catch {
      // Process may already be dead
    }

    this.spawned.delete(agentId);
    logger.info({ agentId }, "Agent process killed");
  }
}
