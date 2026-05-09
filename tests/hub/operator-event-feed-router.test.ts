import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { Router } from "../../src/hub/router.js";
import { SessionManager } from "../../src/hub/session.js";
import { EventFeedStore } from "../../src/operator/event-feed.js";
import { hasPermission } from "../../src/hub/permissions.js";

vi.mock("../../src/hub/permissions.js", () => ({
  hasPermission: vi.fn(async () => false),
}));

class FakeSocket {
  OPEN = 1;
  readyState = 1;
  sent: unknown[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = 3;
  }
}

const mockedHasPermission = vi.mocked(hasPermission);
const flushAsyncBroadcasts = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("Router operator event feed integration", () => {
  beforeEach(() => {
    mockedHasPermission.mockReset();
    mockedHasPermission.mockResolvedValue(false);
  });

  it("surfaces malformed task progress to MVP operator viewers over broadcast and read APIs", async () => {
    const sessions = new SessionManager();
    const feed = new EventFeedStore({ capacity: 20 });
    const router = new Router(sessions, { eventFeed: feed });
    const socket = new FakeSocket();
    sessions.add("ceo", socket as unknown as WebSocket);

    await router.handleRaw(socket as unknown as WebSocket, JSON.stringify({
      type: "task.update",
      taskId: "task-malformed-progress",
      status: "working",
    }));

    expect(socket.sent).toEqual([
      expect.objectContaining({ type: "error" }),
      expect.objectContaining({
        type: "operator.event",
        event: expect.objectContaining({
          kind: "validation_error",
          taskId: "task-malformed-progress",
          severity: "error",
        }),
      }),
    ]);

    await router.handleRaw(socket as unknown as WebSocket, JSON.stringify({
      type: "operator.feed.by_task",
      taskId: "task-malformed-progress",
    }));

    expect(socket.sent.at(-1)).toMatchObject({
      type: "operator.feed.by_task.result",
      taskId: "task-malformed-progress",
      events: [
        expect.objectContaining({
          kind: "validation_error",
          taskId: "task-malformed-progress",
        }),
      ],
    });
  });

  it("returns latest and detail from appended hub-owned events", async () => {
    const sessions = new SessionManager();
    const feed = new EventFeedStore({ capacity: 20 });
    const router = new Router(sessions, { eventFeed: feed });
    const socket = new FakeSocket();
    sessions.add("levia", socket as unknown as WebSocket);

    const event = feed.append({
      actor: { id: "rune", type: "agent" },
      source: "router-test",
      kind: "progress",
      taskId: "task-readable",
      payload: { status: "in_progress" },
    });

    await router.handleRaw(socket as unknown as WebSocket, JSON.stringify({
      type: "operator.feed.latest",
      limit: 5,
    }));
    expect(socket.sent.at(-1)).toMatchObject({
      type: "operator.feed.latest.result",
      events: expect.arrayContaining([
        expect.objectContaining({ eventId: event.eventId }),
      ]),
    });

    await router.handleRaw(socket as unknown as WebSocket, JSON.stringify({
      type: "operator.feed.detail",
      eventId: event.eventId,
    }));
    expect(socket.sent.at(-1)).toMatchObject({
      type: "operator.feed.detail.result",
      event: expect.objectContaining({
        eventId: event.eventId,
        summary: "rune reported progress on task task-readable",
      }),
    });
  });

  it("allows operator:* read sessions through the permission gate", async () => {
    mockedHasPermission.mockImplementation(async (agentId, resource, action) => {
      return agentId === "operator-reader" && resource === "operator:*" && action === "read";
    });

    const sessions = new SessionManager();
    const feed = new EventFeedStore({ capacity: 20 });
    const router = new Router(sessions, { eventFeed: feed });
    const socket = new FakeSocket();
    sessions.add("operator-reader", socket as unknown as WebSocket);

    const event = feed.append({
      actor: { id: "rune", type: "agent" },
      source: "router-test",
      kind: "progress",
      taskId: "task-permissioned",
      payload: { status: "in_progress" },
    });
    await flushAsyncBroadcasts();

    expect(socket.sent).toEqual([
      expect.objectContaining({
        type: "operator.event",
        event: expect.objectContaining({ eventId: event.eventId }),
      }),
    ]);

    await router.handleRaw(socket as unknown as WebSocket, JSON.stringify({
      type: "operator.feed.latest",
      limit: 5,
    }));

    expect(socket.sent.at(-1)).toMatchObject({
      type: "operator.feed.latest.result",
      events: expect.arrayContaining([
        expect.objectContaining({ eventId: event.eventId }),
      ]),
    });
  });

  it("denies non-operator sessions live broadcasts and historical feed reads", async () => {
    const sessions = new SessionManager();
    const feed = new EventFeedStore({ capacity: 20 });
    const router = new Router(sessions, { eventFeed: feed });
    const operatorSocket = new FakeSocket();
    const nonOperatorSocket = new FakeSocket();
    sessions.add("ceo", operatorSocket as unknown as WebSocket);
    sessions.add("rune", nonOperatorSocket as unknown as WebSocket);

    const event = feed.append({
      actor: { id: "hub", type: "hub" },
      source: "router-test",
      kind: "progress",
      taskId: "task-private",
      payload: { status: "in_progress" },
    });
    await flushAsyncBroadcasts();

    expect(operatorSocket.sent).toEqual([
      expect.objectContaining({
        type: "operator.event",
        event: expect.objectContaining({ eventId: event.eventId }),
      }),
    ]);
    expect(nonOperatorSocket.sent).toEqual([]);

    await router.handleRaw(nonOperatorSocket as unknown as WebSocket, JSON.stringify({
      type: "operator.feed.latest",
      limit: 5,
    }));
    await router.handleRaw(nonOperatorSocket as unknown as WebSocket, JSON.stringify({
      type: "operator.feed.by_task",
      taskId: "task-private",
      limit: 5,
    }));

    expect(nonOperatorSocket.sent).toEqual([
      expect.objectContaining({ type: "error", code: "PERMISSION_DENIED" }),
      expect.objectContaining({ type: "error", code: "PERMISSION_DENIED" }),
    ]);
  });
});
