import { describe, expect, it } from "vitest";
import { EventFeedStore } from "../../src/operator/event-feed.js";

describe("EventFeedStore", () => {
  it("assigns monotonic sequence numbers in append order", () => {
    const feed = new EventFeedStore({ capacity: 10 });

    const first = feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "lifecycle",
      taskId: "task-1",
      payload: { action: "created" },
    });
    const second = feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "progress",
      taskId: "task-1",
      payload: { status: "in_progress" },
    });

    expect(second.sequence).toBe(first.sequence + 1);
    expect(feed.latest({ limit: 2 }).map((event) => event.eventId)).toEqual([first.eventId, second.eventId]);
  });

  it("emits retention_drop instead of silently losing history", () => {
    const feed = new EventFeedStore({ capacity: 3 });

    feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "lifecycle",
      taskId: "task-1",
      payload: { action: "created" },
    });
    feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "progress",
      taskId: "task-1",
      payload: { status: "in_progress" },
    });
    feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "result",
      taskId: "task-1",
      payload: { status: "done" },
    });

    const overflow = feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "lifecycle",
      taskId: "task-2",
      payload: { action: "created" },
    });

    const events = feed.latest({ limit: 10 });
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.kind)).toEqual(["result", "retention_drop", "lifecycle"]);
    expect(events.at(-1)?.eventId).toBe(overflow.eventId);
    expect(events[1].payload).toMatchObject({
      droppedCount: 2,
      firstDroppedSequence: expect.any(Number),
      lastDroppedSequence: expect.any(Number),
      droppedEventIds: expect.arrayContaining([expect.any(String)]),
      capacity: 3,
    });
    expect(events[1].summary).toBe("Operator feed dropped 2 event(s) due to retention");
  });

  it("reset clears prior history and leaves a feed_reset marker", () => {
    const feed = new EventFeedStore({ capacity: 5 });
    feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "progress",
      taskId: "task-1",
      payload: { status: "in_progress" },
    });

    const reset = feed.reset("operator requested reset");

    expect(feed.latest({ limit: 10 })).toEqual([reset]);
    expect(reset.kind).toBe("feed_reset");
    expect(reset.summary).toContain("operator requested reset");
  });

  it("rejects traceable events without task, meeting, or run ids as validation_error", () => {
    const feed = new EventFeedStore({ capacity: 10 });

    const event = feed.append({
      actor: { id: "rune", type: "agent" },
      source: "unit",
      kind: "progress",
      payload: { status: "in_progress" },
    });

    expect(event.kind).toBe("validation_error");
    expect(event.severity).toBe("error");
    expect(event.summary).toContain("requires taskId");
    expect(feed.latest({ limit: 1 })[0].eventId).toBe(event.eventId);
  });

  it("all MVP kinds produce human-readable summaries", () => {
    const feed = new EventFeedStore({ capacity: 20 });
    const events = [
      feed.append({ actor: { id: "rune", type: "agent" }, source: "unit", kind: "lifecycle", taskId: "task-1" }),
      feed.append({ actor: { id: "rune", type: "agent" }, source: "unit", kind: "progress", taskId: "task-1" }),
      feed.append({ actor: { id: "rune", type: "agent" }, source: "unit", kind: "result", taskId: "task-1", payload: { status: "done" } }),
      feed.append({ actor: { id: "rune", type: "agent" }, source: "unit", kind: "meeting_membership", meetingId: "meeting-1" }),
      feed.append({ actor: { id: "rune", type: "agent" }, source: "unit", kind: "meeting_status", meetingId: "meeting-1" }),
      feed.append({ actor: { id: "hub", type: "hub" }, source: "unit", kind: "validation_error", payload: { reason: "bad payload" } }),
      feed.append({
        actor: { id: "hub", type: "hub" },
        source: "unit",
        kind: "retention_drop",
        payload: { droppedCount: 1, droppedEventIds: ["old"] },
      }),
      feed.reset("summary check"),
    ];

    for (const event of events) {
      expect(event.summary.trim().length).toBeGreaterThan(0);
      expect(event.summary).not.toMatch(/undefined|null/);
    }
  });
});
