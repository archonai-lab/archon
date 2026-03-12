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

  beforeEach(() => {
    spawner = new AgentSpawner("ws://127.0.0.1:9500");
    mockSpawn.mockReturnValue(createMockProcess());
  });

  afterEach(() => {
    spawner.killAll();
    vi.clearAllMocks();
  });

  it("spawns agents for a meeting", async () => {
    const result = await spawner.spawnForMeeting(["alice", "bob"], "m1");
    expect(result.spawned).toEqual(["alice", "bob"]);
    expect(result.failed).toEqual([]);
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(spawner.isSpawned("alice")).toBe(true);
    expect(spawner.isSpawned("bob")).toBe(true);
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
});
