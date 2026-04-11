import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSpawner } from "../../src/hub/agent-spawner.js";

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock("child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock DB
vi.mock("../../src/db/connection.js", () => ({
  db: {
    query: {
      agents: {
        findFirst: vi.fn().mockResolvedValue({
          modelConfig: { provider: "openai", model: "gpt-4o" },
          status: "active",
        }),
      },
    },
  },
}));

function createMockProcess() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const stdout = {
    on: vi.fn(),
  };
  const stderr = {
    on: vi.fn(),
  };
  return {
    pid: 12345,
    stdout,
    stderr,
    kill: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    _handlers: handlers,
  };
}

describe("AgentSpawner", () => {
  let spawner: AgentSpawner;
  let originalRunnerPath: string | undefined;

  beforeEach(() => {
    originalRunnerPath = process.env.ARCHON_RUNNER_PATH;
    spawner = new AgentSpawner("ws://127.0.0.1:9500");
    mockSpawn.mockReturnValue(createMockProcess());
  });

  afterEach(() => {
    if (originalRunnerPath === undefined) {
      delete process.env.ARCHON_RUNNER_PATH;
    } else {
      process.env.ARCHON_RUNNER_PATH = originalRunnerPath;
    }
    spawner.killAll();
    vi.clearAllMocks();
  });

  it("spawns agents for a meeting", async () => {
    process.env.ARCHON_RUNNER_PATH = "/tmp/archon-agent/scripts/runner.ts";
    const result = await spawner.spawnForMeeting(["alice", "bob"], "m1");
    expect(result.spawned).toEqual(["alice", "bob"]);
    expect(result.failed).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(spawner.isSpawned("alice")).toBe(true);
    expect(spawner.isSpawned("bob")).toBe(true);

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--lifetime");
    expect(spawnArgs).toContain("long");
  });

  it("skips excluded agents (ceo)", async () => {
    const result = await spawner.spawnForMeeting(["ceo", "alice"], "m1");
    expect(result.spawned).toEqual(["alice"]);
    expect(result.failed).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it("skips already-spawned agents", async () => {
    await spawner.spawnForMeeting(["alice"], "m1");
    mockSpawn.mockClear();

    const result = await spawner.spawnForMeeting(["alice"], "m2");
    expect(result.spawned).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(mockSpawn).not.toHaveBeenCalled();
    // But alice should now be tracked for both meetings
    expect(spawner.isSpawned("alice")).toBe(true);
  });

  it("despawns agents when meeting ends", async () => {
    await spawner.spawnForMeeting(["alice", "bob"], "m1");
    const despawned = spawner.despawnForMeeting("m1");
    expect(despawned).toContain("alice");
    expect(despawned).toContain("bob");
    expect(spawner.isSpawned("alice")).toBe(false);
    expect(spawner.isSpawned("bob")).toBe(false);
  });

  it("keeps agent alive if in multiple meetings", async () => {
    await spawner.spawnForMeeting(["alice"], "m1");
    await spawner.spawnForMeeting(["alice"], "m2");

    const despawned = spawner.despawnForMeeting("m1");
    expect(despawned).toEqual([]);
    expect(spawner.isSpawned("alice")).toBe(true);

    const despawned2 = spawner.despawnForMeeting("m2");
    expect(despawned2).toEqual(["alice"]);
    expect(spawner.isSpawned("alice")).toBe(false);
  });

  it("killAll stops all agents", async () => {
    await spawner.spawnForMeeting(["alice", "bob"], "m1");
    spawner.killAll();
    expect(spawner.getSpawnedIds()).toEqual([]);
  });

  it("passes model config to spawn args", async () => {
    await spawner.spawnForMeeting(["alice"], "m1");
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--provider");
    expect(spawnArgs).toContain("openai");
    expect(spawnArgs).toContain("--model");
    expect(spawnArgs).toContain("gpt-4o");
  });

  it("defaults provider to cli-codex when agent config omits it", async () => {
    const { db } = await import("../../src/db/connection.js");
    vi.mocked(db.query.agents.findFirst).mockResolvedValueOnce({
      modelConfig: {},
      status: "active",
    });

    await spawner.spawnForMeeting(["alice"], "m1");
    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("--provider");
    expect(spawnArgs).toContain("cli-codex");
  });

  it("spawns long-lived archon-agent runner for assigned offline tasks", async () => {
    process.env.ARCHON_RUNNER_PATH = "/tmp/archon-agent/scripts/runner.ts";

    const result = await spawner.spawnForTask("alice", "task-1");
    expect(result.ok).toBe(true);

    const spawnArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain("/tmp/archon-agent/scripts/runner.ts");
    expect(spawnArgs).toContain("--lifetime");
    expect(spawnArgs).toContain("long");
    expect(spawnArgs).not.toContain("--meeting");
  });

  it("rejects task auto-spawn when only the legacy runner is available", async () => {
    delete process.env.ARCHON_RUNNER_PATH;

    const result = await spawner.spawnForTask("alice", "task-2");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ARCHON_RUNNER_PATH");
    }
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("keeps a task-spawned agent alive while tasks remain", async () => {
    process.env.ARCHON_RUNNER_PATH = "/tmp/archon-agent/scripts/runner.ts";

    await spawner.spawnForTask("alice", "task-1");
    await spawner.spawnForTask("alice", "task-2");

    const despawned = spawner.despawnForTask("task-1");
    expect(despawned).toEqual([]);
    expect(spawner.isSpawned("alice")).toBe(true);

    const despawnedFinal = spawner.despawnForTask("task-2");
    expect(despawnedFinal).toEqual(["alice"]);
    expect(spawner.isSpawned("alice")).toBe(false);
  });
});
