import { describe, expect, it } from "vitest";
import { EventFeedStore } from "../../src/operator/event-feed.js";

describe("operator event feed beta story reconstruction", () => {
  it("reconstructs latest, by-task, by-meeting, and detail without terminal logs", () => {
    const feed = new EventFeedStore({ capacity: 20 });

    const created = feed.append({
      actor: { id: "ceo", type: "agent" },
      source: "beta",
      kind: "meeting_status",
      meetingId: "meeting-86",
      payload: { status: "created", title: "Operator feed planning" },
    });
    feed.append({
      actor: { id: "rune", type: "agent" },
      source: "beta",
      kind: "meeting_membership",
      meetingId: "meeting-86",
      payload: { action: "joined" },
    });
    feed.append({
      actor: { id: "ceo", type: "agent" },
      source: "beta",
      kind: "lifecycle",
      taskId: "task-86",
      meetingId: "meeting-86",
      payload: { action: "created", title: "Implement Operator Event Feed MVP" },
    });
    feed.append({
      actor: { id: "rune", type: "agent" },
      source: "beta",
      kind: "progress",
      taskId: "task-86",
      meetingId: "meeting-86",
      payload: { status: "in_progress" },
    });
    const result = feed.append({
      actor: { id: "rune", type: "agent" },
      source: "beta",
      kind: "result",
      taskId: "task-86",
      meetingId: "meeting-86",
      payload: { status: "done" },
    });

    expect(feed.latest({ limit: 5 }).map((event) => event.summary)).toEqual([
      created.summary,
      "rune changed membership for meeting meeting-86",
      "ceo changed task task-86 lifecycle",
      "rune reported progress on task task-86",
      "rune completed task task-86 with done",
    ]);
    expect(feed.byTaskId("task-86", { limit: 10 }).map((event) => event.kind)).toEqual([
      "lifecycle",
      "progress",
      "result",
    ]);
    expect(feed.byMeetingId("meeting-86", { limit: 10 })).toHaveLength(5);
    expect(feed.detail(result.eventId)?.summary).toBe("rune completed task task-86 with done");
  });
});
