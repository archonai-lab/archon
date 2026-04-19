import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { eq, inArray, or } from "drizzle-orm";
import { HubServer } from "../../src/hub/server.js";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, meetingMessages, meetingParticipants, meetings, permissions, tasks } from "../../src/db/schema.js";
import { logger } from "../../src/utils/logger.js";

const TEST_PORT = 9599;
const WS_URL = `ws://localhost:${TEST_PORT}`;
const TEST_AGENT_ID = "test-agent";
const TEST_INVITEE_ID = "test-agent-2";
const TEST_OBSERVER_ID = "test-agent-3";
const TEST_GLOBAL_VIEWER_ID = "levia";
const DISCONNECT_GRACE_MS = 200;
const TEST_AGENT_IDS = [TEST_AGENT_ID, TEST_INVITEE_ID, TEST_OBSERVER_ID, TEST_GLOBAL_VIEWER_ID];

let hub: HubServer;
const openSockets: WebSocket[] = [];

async function cleanupTestMeetings(): Promise<void> {
  const meetingRows = await db.query.meetings.findMany({
    columns: { id: true },
    where: or(
      eq(meetings.initiatorId, TEST_AGENT_ID),
      inArray(
        meetings.id,
        db
          .select({ meetingId: meetingParticipants.meetingId })
          .from(meetingParticipants)
          .where(inArray(meetingParticipants.agentId, TEST_AGENT_IDS)),
      ),
    ),
  });
  const meetingIds = meetingRows.map((row) => row.id);

  if (meetingIds.length > 0) {
    await db.delete(meetingMessages).where(inArray(meetingMessages.meetingId, meetingIds));
    await db.delete(meetingParticipants).where(inArray(meetingParticipants.meetingId, meetingIds));
    await db.delete(meetings).where(inArray(meetings.id, meetingIds));
  }

  await db.delete(meetingParticipants).where(inArray(meetingParticipants.agentId, TEST_AGENT_IDS));
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    openSockets.push(ws);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function sendAndReceive(ws: WebSocket, msg: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    ws.send(JSON.stringify(msg));
  });
}

function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
  });
}

function waitForMessageType(
  ws: WebSocket,
  type: string,
  timeoutMs = 2_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);

    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(message);
    };

    ws.on("message", onMessage);
  });
}

function expectNoMessageType(
  ws: WebSocket,
  type: string,
  timeoutMs = 300,
): Promise<"timeout"> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      resolve("timeout");
    }, timeoutMs);

    const onMessage = (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (message.type !== type) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      reject(new Error(`Unexpected ${type}`));
    };

    ws.on("message", onMessage);
  });
}

beforeAll(async () => {
  // Ensure test agents exist in DB
  await db
    .insert(agents)
    .values({
      id: TEST_AGENT_ID,
      displayName: "Test Agent",
      workspacePath: "~/.archon/agents/test-agent",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(agents)
    .values({
      id: TEST_INVITEE_ID,
      displayName: "Test Agent 2",
      workspacePath: "~/.archon/agents/test-agent-2",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(agents)
    .values({
      id: TEST_OBSERVER_ID,
      displayName: "Test Agent 3",
      workspacePath: "~/.archon/agents/test-agent-3",
      status: "active",
    })
    .onConflictDoNothing();

  await db
    .insert(agents)
    .values({
      id: TEST_GLOBAL_VIEWER_ID,
      displayName: "Levia",
      workspacePath: "~/.archon/agents/levia",
      status: "active",
    })
    .onConflictDoNothing();

  await db.insert(permissions).values({
    agentId: TEST_AGENT_ID,
    resource: "task:*",
    action: "admin",
  }).onConflictDoNothing();

  hub = new HubServer({ disconnectGraceMs: DISCONNECT_GRACE_MS });
  await hub.start(TEST_PORT);
});

afterEach(() => {
  // Close all sockets opened during the test
  for (const ws of openSockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  openSockets.length = 0;
});

afterAll(async () => {
  if (hub) {
    await hub.stop();
  }
  // Clean up test data
  await cleanupTestMeetings();
  await db.delete(tasks).where(inArray(tasks.assignedTo, TEST_AGENT_IDS));
  await db.delete(tasks).where(eq(tasks.assignedBy, TEST_AGENT_ID));
  await db.delete(permissions).where(eq(permissions.agentId, TEST_AGENT_ID));
  await db.delete(agents).where(inArray(agents.id, TEST_AGENT_IDS));
  await closeConnection();
});

describe("HubServer", () => {
  describe("auth", () => {
    it("should authenticate a valid agent", async () => {
      const ws = await connect();
      const reply = await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      expect(reply).toMatchObject({
        type: "auth.ok",
        agentCard: expect.anything(),
        pendingInvites: [],
      });
    });

    it("should reject unknown agent", async () => {
      const ws = await connect();
      const closePromise = new Promise<number>((resolve) => {
        ws.on("close", (code) => resolve(code));
      });

      const reply = await sendAndReceive(ws, {
        type: "auth",
        agentId: "nonexistent",
        token: "nonexistent",
      });

      expect(reply).toEqual({
        type: "error",
        code: "AUTH_FAILED",
        message: "Authentication failed",
      });

      const closeCode = await closePromise;
      expect(closeCode).toBe(4001);
    });

    it("should reject invalid token", async () => {
      const ws = await connect();
      const closePromise = new Promise<number>((resolve) => {
        ws.on("close", (code) => resolve(code));
      });

      const reply = await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "wrong-token",
      });

      expect(reply).toEqual({
        type: "error",
        code: "AUTH_FAILED",
        message: "Authentication failed",
      });

      const closeCode = await closePromise;
      expect(closeCode).toBe(4001);
    });

    it("should require auth before other messages", async () => {
      const ws = await connect();
      const reply = await sendAndReceive(ws, { type: "ping" });

      expect(reply).toEqual({
        type: "error",
        code: "AUTH_REQUIRED",
        message: "Authentication required",
      });
    });
  });

  describe("post-auth messages", () => {
    it("should respond to ping with pong", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      const reply = await sendAndReceive(ws, { type: "ping" });
      expect(reply).toEqual({ type: "pong" });
    });

    it("should handle agent.status as no-op (deprecated)", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      // Send status update — deprecated, should not error
      ws.send(JSON.stringify({ type: "agent.status", status: "busy" }));

      // Give it a moment to process — should not crash
      await new Promise((r) => setTimeout(r, 100));
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, "test-agent"),
      });
      // Status stays "active" (lifecycle field, not presence)
      expect(agent?.status).toBe("active");
    });

    it("should reject invalid JSON", async () => {
      const ws = await connect();
      const reply = new Promise<unknown>((resolve) => {
        ws.once("message", (raw) => resolve(JSON.parse(raw.toString())));
      });

      ws.send("not json{{{");
      const result = await reply;

      expect(result).toEqual({
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Invalid message format",
      });
    });

    it("should reject unknown message types", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      const reply = await sendAndReceive(ws, { type: "faketype" });
      expect(reply).toEqual({
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Invalid message format",
      });
    });
  });

  describe("session management", () => {
    it("should clean up session on disconnect without changing DB status", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      // Disconnect
      ws.close();
      await new Promise((r) => setTimeout(r, 200));

      // Status in DB stays "active" (lifecycle, not presence)
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, "test-agent"),
      });
      expect(agent?.status).toBe("active");
    });

    it("should handle reconnect by closing old session", async () => {
      const ws1 = await connect();
      await sendAndReceive(ws1, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      const ws1ClosePromise = new Promise<number>((resolve) => {
        ws1.on("close", (code) => resolve(code));
      });

      // Connect again with same agent
      const ws2 = await connect();
      await sendAndReceive(ws2, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      // First socket should have been closed
      const closeCode = await ws1ClosePromise;
      expect(closeCode).toBe(1000);

      // Second socket should work
      const reply = await sendAndReceive(ws2, { type: "ping" });
      expect(reply).toEqual({ type: "pong" });
    });

    it("sends task.created and task.updated only to the requester and assignee, not unrelated sessions", async () => {
      const requester = await connect();
      const assignee = await connect();
      const observer = await connect();

      await sendAndReceive(requester, {
        type: "auth",
        agentId: TEST_AGENT_ID,
        token: TEST_AGENT_ID,
      });
      await sendAndReceive(assignee, {
        type: "auth",
        agentId: TEST_INVITEE_ID,
        token: TEST_INVITEE_ID,
      });
      await sendAndReceive(observer, {
        type: "auth",
        agentId: TEST_OBSERVER_ID,
        token: TEST_OBSERVER_ID,
      });

      const observerCreated = expectNoMessageType(observer, "task.created", 300);

      const createdForRequester = await sendAndReceive(requester, {
        type: "task.create",
        title: "Visibility check task",
        assignedTo: TEST_INVITEE_ID,
      }) as { type: string; task: { id: string } };
      const createdForObserver = await observerCreated;

      expect(createdForRequester).toMatchObject({ type: "task.created" });
      expect(createdForObserver).toBe("timeout");

      const requesterUpdated = waitForMessageType(requester, "task.updated");
      const observerUpdated = expectNoMessageType(observer, "task.updated", 300);

      const updatedForAssignee = await sendAndReceive(assignee, {
        type: "task.update",
        taskId: createdForRequester.task.id,
        status: "in_progress",
      });

      expect(await requesterUpdated).toMatchObject({ type: "task.updated" });
      expect(updatedForAssignee).toMatchObject({ type: "task.updated" });
      expect(await observerUpdated).toBe("timeout");
    });

    it("allows global task-board viewers to fetch tasks with task.get", async () => {
      const requester = await connect();
      const globalViewer = await connect();

      await sendAndReceive(requester, {
        type: "auth",
        agentId: TEST_AGENT_ID,
        token: TEST_AGENT_ID,
      });
      await sendAndReceive(globalViewer, {
        type: "auth",
        agentId: TEST_GLOBAL_VIEWER_ID,
        token: TEST_GLOBAL_VIEWER_ID,
      });

      const created = await sendAndReceive(requester, {
        type: "task.create",
        title: "Task.get visibility check",
        assignedTo: TEST_INVITEE_ID,
      }) as { type: string; task: { id: string } };

      const fetched = await sendAndReceive(globalViewer, {
        type: "task.get",
        taskId: created.task.id,
      });

      expect(fetched).toMatchObject({
        type: "task.get.result",
        task: {
          id: created.task.id,
          assignedTo: TEST_INVITEE_ID,
          title: "Task.get visibility check",
        },
      });
    });
  });
});

describe("task router error mapping", () => {
  it("returns INVALID_MESSAGE with the task error text for invalid task updates", async () => {
    const requester = await connect();
    await sendAndReceive(requester, {
      type: "auth",
      agentId: TEST_AGENT_ID,
      token: TEST_AGENT_ID,
    });

    const created = await sendAndReceive(requester, {
      type: "task.create",
      title: "Transition mapping task",
      assignedTo: TEST_AGENT_ID,
    }) as { type: string; task: { id: string } };

    const reply = await sendAndReceive(requester, {
      type: "task.update",
      taskId: created.task.id,
      status: "done",
    });

    expect(reply).toEqual({
      type: "error",
      code: "INVALID_MESSAGE",
      message: 'Invalid status transition: pending → done',
    });
  });
});

  describe("heartbeat — zombie socket eviction", () => {
    it("should evict a session when the socket does not respond to ping", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      const sessions = hub.getSessionManager();
      expect(sessions.isOnline("test-agent")).toBe(true);

      // Simulate the socket going silent: mark isAlive = false as the
      // previous heartbeat cycle would have done, then tick again without
      // a pong arriving in between.
      const session = sessions.get("test-agent")!;
      session.isAlive = false;

      // Tick the heartbeat — no pong was received, so the session should be evicted
      hub.tickHeartbeat();

      // Allow the terminate() → close event to propagate
      await new Promise((r) => setTimeout(r, 100));

      expect(sessions.isOnline("test-agent")).toBe(false);
      expect(sessions.get("test-agent")).toBeUndefined();
    });

    it("should keep a session alive when the socket responds to ping", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      const sessions = hub.getSessionManager();

      // First tick: session.isAlive is true (freshly connected), so no eviction.
      // The tick marks isAlive = false and sends a ping.
      hub.tickHeartbeat();

      // Wait for the ws client to auto-respond with a pong, which sets isAlive = true
      await new Promise((r) => setTimeout(r, 200));

      // Second tick: isAlive should be true (pong was received), so no eviction.
      hub.tickHeartbeat();
      await new Promise((r) => setTimeout(r, 100));

      expect(sessions.isOnline("test-agent")).toBe(true);
    });

    it("isOnline should return false for a session with a non-OPEN socket", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: "test-agent",
        token: "test-agent",
      });

      const sessions = hub.getSessionManager();
      expect(sessions.isOnline("test-agent")).toBe(true);

      // Close the socket from the client side — TCP close propagates
      ws.close();
      await new Promise((r) => setTimeout(r, 200));

      // After close event fires, session is removed entirely
      expect(sessions.isOnline("test-agent")).toBe(false);
    });

    it("cancels an active meeting after heartbeat zombie eviction and clears meeting state", async () => {
      const initiator = await connect();
      const invitee = await connect();

      await sendAndReceive(initiator, {
        type: "auth",
        agentId: TEST_AGENT_ID,
        token: TEST_AGENT_ID,
      });
      await sendAndReceive(invitee, {
        type: "auth",
        agentId: TEST_INVITEE_ID,
        token: TEST_INVITEE_ID,
      });

      const invitePromise = waitForMessageType(invitee, "meeting.invite");
      const created = await sendAndReceive(initiator, {
        type: "meeting.create",
        title: "Heartbeat Cleanup Regression",
        invitees: [TEST_INVITEE_ID],
      }) as { meetingId: string };
      const invite = await invitePromise;
      const meetingId = created.meetingId;

      expect(invite).toMatchObject({
        type: "meeting.invite",
        meetingId,
      });

      await sendAndReceive(invitee, {
        type: "meeting.join",
        meetingId,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sessions = hub.getSessionManager();
      expect(hub.getActiveMeetingsCount()).toBe(1);
      expect(sessions.get(TEST_AGENT_ID)?.currentMeetingId).toBe(meetingId);
      expect(sessions.get(TEST_INVITEE_ID)?.currentMeetingId).toBe(meetingId);

      const cancelledPromise = waitForMessageType(invitee, "meeting.cancelled");

      const zombie = sessions.get(TEST_AGENT_ID);
      expect(zombie).toBeDefined();
      zombie!.isAlive = false;
      hub.tickHeartbeat();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sessions.get(TEST_AGENT_ID)).toBeUndefined();
      expect(hub.getActiveMeetingsCount()).toBe(1);

      const cancelled = await cancelledPromise;
      expect(cancelled).toMatchObject({
        type: "meeting.cancelled",
        meetingId,
      });

      await new Promise((resolve) => setTimeout(resolve, DISCONNECT_GRACE_MS + 50));

      expect(hub.getActiveMeetingsCount()).toBe(0);
      expect(sessions.get(TEST_INVITEE_ID)?.currentMeetingId).toBeNull();

      const reauth = await connect();
      const authReply = await sendAndReceive(reauth, {
        type: "auth",
        agentId: TEST_AGENT_ID,
        token: TEST_AGENT_ID,
      });

      expect(authReply).toMatchObject({
        type: "auth.ok",
        pendingInvites: [],
        activeMeetings: [],
      });
    });
  });
