import { describe, it, expect, vi, afterEach } from "vitest";
import { TurnManager } from "../../src/meeting/turn-manager.js";

describe("TurnManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should order MUST_SPEAK before COULD_ADD", async () => {
    const tm = new TurnManager();
    const promise = tm.collect(["a", "b", "c"]);

    tm.addResponse("a", "could_add");
    tm.addResponse("b", "must_speak");
    tm.addResponse("c", "could_add");

    const queue = await promise;
    expect(queue).toEqual(["b", "a", "c"]);
  });

  it("should return empty queue when all pass", async () => {
    const tm = new TurnManager();
    const promise = tm.collect(["a", "b"]);

    tm.addResponse("a", "pass");
    tm.addResponse("b", "pass");

    const queue = await promise;
    expect(queue).toEqual([]);
  });

  it("should exclude PASS agents from queue", async () => {
    const tm = new TurnManager();
    const promise = tm.collect(["a", "b", "c"]);

    tm.addResponse("a", "must_speak");
    tm.addResponse("b", "pass");
    tm.addResponse("c", "could_add");

    const queue = await promise;
    expect(queue).toEqual(["a", "c"]);
  });

  it("should ignore responses from unexpected agents", async () => {
    const tm = new TurnManager();
    const promise = tm.collect(["a"]);

    tm.addResponse("unknown", "must_speak"); // ignored
    tm.addResponse("a", "could_add");

    const queue = await promise;
    expect(queue).toEqual(["a"]);
  });

  it("should timeout non-respondents after 120s", async () => {
    vi.useFakeTimers();
    const tm = new TurnManager();
    const promise = tm.collect(["a", "b"]);

    tm.addResponse("a", "must_speak");
    // b never responds

    vi.advanceTimersByTime(120_000);
    const queue = await promise;
    expect(queue).toEqual(["a"]); // b treated as PASS
    vi.useRealTimers();
  });

  it("should finalize early when all respond", async () => {
    const tm = new TurnManager();
    const start = Date.now();
    const promise = tm.collect(["a", "b"]);

    tm.addResponse("a", "must_speak");
    tm.addResponse("b", "could_add");

    const queue = await promise;
    const elapsed = Date.now() - start;
    expect(queue).toEqual(["a", "b"]);
    expect(elapsed).toBeLessThan(100); // should be near-instant
  });
});
