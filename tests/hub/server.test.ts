import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { HubServer } from "../../src/hub/server.js";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, permissions, tasks } from "../../src/db/schema.js";
import { grantPermission } from "../../src/hub/permissions.js";

const TEST_PORT = 9599;
const WS_URL = `ws://localhost:${TEST_PORT}`;
const TEST_AGENT = "test-agent";
const TASK_ADMIN = "task-admin";
const TASK_ASSIGNEE = "task-assignee";
const TASK_OBSERVER = "task-observer";

let hub: HubServer;
const openSockets: WebSocket[] = [];

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

beforeAll(async () => {
  // Ensure test agents exist in DB
  await db
    .insert(agents)
    .values([
      {
        id: TEST_AGENT,
        displayName: "Test Agent",
        workspacePath: "~/.archon/agents/test-agent",
        status: "active",
      },
      {
        id: TASK_ADMIN,
        displayName: "Task Admin",
        workspacePath: "~/.archon/agents/task-admin",
        status: "active",
      },
      {
        id: TASK_ASSIGNEE,
        displayName: "Task Assignee",
        workspacePath: "~/.archon/agents/task-assignee",
        status: "active",
      },
      {
        id: TASK_OBSERVER,
        displayName: "Task Observer",
        workspacePath: "~/.archon/agents/task-observer",
        status: "active",
      },
    ])
    .onConflictDoNothing();

  await grantPermission(TASK_ADMIN, "task:*", "admin");

  hub = new HubServer();
  await hub.start(TEST_PORT);
});

afterEach(async () => {
  // Close all sockets opened during the test
  for (const ws of openSockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  openSockets.length = 0;

  await db.delete(tasks).where(eq(tasks.assignedBy, TASK_ADMIN));
});

afterAll(async () => {
  if (hub) {
    await hub.stop();
  }
  // Clean up test data
  await db.delete(permissions).where(eq(permissions.agentId, TASK_ADMIN));
  await db.delete(agents).where(eq(agents.id, TEST_AGENT));
  await db.delete(agents).where(eq(agents.id, TASK_ADMIN));
  await db.delete(agents).where(eq(agents.id, TASK_ASSIGNEE));
  await db.delete(agents).where(eq(agents.id, TASK_OBSERVER));
  await closeConnection();
});

describe("HubServer", () => {
  describe("auth", () => {
    it("should authenticate a valid agent", async () => {
      const ws = await connect();
      const reply = await sendAndReceive(ws, {
        type: "auth",
        agentId: TEST_AGENT,
        token: TEST_AGENT,
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

      expect(reply).toMatchObject({
        type: "error",
        code: "AUTH_FAILED",
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
        agentId: TEST_AGENT,
        token: "wrong-token",
      });

      expect(reply).toMatchObject({
        type: "error",
        code: "AUTH_FAILED",
      });

      const closeCode = await closePromise;
      expect(closeCode).toBe(4001);
    });

    it("should require auth before other messages", async () => {
      const ws = await connect();
      const reply = await sendAndReceive(ws, { type: "ping" });

      expect(reply).toMatchObject({
        type: "error",
        code: "AUTH_REQUIRED",
      });
    });
  });

  describe("post-auth messages", () => {
    it("should respond to ping with pong", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: TEST_AGENT,
        token: TEST_AGENT,
      });

      const reply = await sendAndReceive(ws, { type: "ping" });
      expect(reply).toEqual({ type: "pong" });
    });

    it("should handle agent.status as no-op (deprecated)", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: TEST_AGENT,
        token: TEST_AGENT,
      });

      // Send status update — deprecated, should not error
      ws.send(JSON.stringify({ type: "agent.status", status: "busy" }));

      // Give it a moment to process — should not crash
      await new Promise((r) => setTimeout(r, 100));
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, TEST_AGENT),
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

      expect(result).toMatchObject({
        type: "error",
        code: "INVALID_MESSAGE",
      });
    });

    it("should reject unknown message types", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: TEST_AGENT,
        token: TEST_AGENT,
      });

      const reply = await sendAndReceive(ws, { type: "faketype" });
      expect(reply).toMatchObject({
        type: "error",
        code: "INVALID_MESSAGE",
      });
    });
  });

  describe("session management", () => {
    it("should clean up session on disconnect without changing DB status", async () => {
      const ws = await connect();
      await sendAndReceive(ws, {
        type: "auth",
        agentId: TEST_AGENT,
        token: TEST_AGENT,
      });

      // Disconnect
      ws.close();
      await new Promise((r) => setTimeout(r, 200));

      // Status in DB stays "active" (lifecycle, not presence)
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, TEST_AGENT),
      });
      expect(agent?.status).toBe("active");
    });

    it("should handle reconnect by closing old session", async () => {
      const ws1 = await connect();
      await sendAndReceive(ws1, {
        type: "auth",
        agentId: TEST_AGENT,
        token: TEST_AGENT,
      });

      const ws1ClosePromise = new Promise<number>((resolve) => {
        ws1.on("close", (code) => resolve(code));
      });

      // Connect again with same agent
      const ws2 = await connect();
      await sendAndReceive(ws2, {
        type: "auth",
        agentId: TEST_AGENT,
        token: TEST_AGENT,
      });

      // First socket should have been closed
      const closeCode = await ws1ClosePromise;
      expect(closeCode).toBe(1000);

      // Second socket should work
      const reply = await sendAndReceive(ws2, { type: "ping" });
      expect(reply).toEqual({ type: "pong" });
    });

    it("should expose task metadata fields on live task.created payloads", async () => {
      const adminWs = await connect();
      await sendAndReceive(adminWs, {
        type: "auth",
        agentId: TASK_ADMIN,
        token: TASK_ADMIN,
      });

      const assigneeWs = await connect();
      await sendAndReceive(assigneeWs, {
        type: "auth",
        agentId: TASK_ASSIGNEE,
        token: TASK_ASSIGNEE,
      });

      const observerWs = await connect();
      await sendAndReceive(observerWs, {
        type: "auth",
        agentId: TASK_OBSERVER,
        token: TASK_OBSERVER,
      });

      const observerMessages: unknown[] = [];
      observerWs.on("message", (raw) => observerMessages.push(JSON.parse(raw.toString())));

      const assigneeEventPromise = waitForMessage(assigneeWs);
      const requesterReply = await sendAndReceive(adminWs, {
        type: "task.create",
        title: "Websocket metadata regression",
        assignedTo: TASK_ASSIGNEE,
        taskMetadata: {
          taskType: "implementation",
          completionContract: {
            taskType: "implementation",
            artifactRequired: true,
            requiredSections: ["verification"],
          },
          attempt: {
            number: 3,
            kind: "retry",
            previousTaskId: "task-prev-2",
          },
          repoScope: {
            targetRepo: "/tmp/archon",
            relatedRepos: ["/tmp/archon-agent"],
            crossRepoPolicy: "explicit_related_only",
          },
        },
      });
      const assigneeEvent = await assigneeEventPromise;
      await new Promise((r) => setTimeout(r, 100));

      for (const message of [requesterReply, assigneeEvent]) {
        expect(message).toMatchObject({
          type: "task.created",
          task: {
            title: "Websocket metadata regression",
            assignedTo: TASK_ASSIGNEE,
            assignedBy: TASK_ADMIN,
            taskType: "implementation",
            completionContract: {
              taskType: "implementation",
              artifactRequired: true,
              requiredSections: ["verification"],
            },
            attempt: {
              number: 3,
              kind: "retry",
              previousTaskId: "task-prev-2",
            },
            repoScope: {
              targetRepo: "/tmp/archon",
              relatedRepos: ["/tmp/archon-agent"],
              crossRepoPolicy: "explicit_related_only",
            },
          },
        });
      }

      expect(observerMessages).toEqual([]);
    });
  });
});
