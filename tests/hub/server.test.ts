import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { HubServer } from "../../src/hub/server.js";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents } from "../../src/db/schema.js";
import { logger } from "../../src/utils/logger.js";

const TEST_PORT = 9599;
const WS_URL = `ws://localhost:${TEST_PORT}`;

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
  // Ensure test agent exists in DB
  await db
    .insert(agents)
    .values({
      id: "test-agent",
      displayName: "Test Agent",
      workspacePath: "~/.archon/agents/test-agent",
      status: "active",
    })
    .onConflictDoNothing();

  hub = new HubServer();
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
  await hub.stop();
  // Clean up test data
  await db.delete(agents).where(eq(agents.id, "test-agent"));
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
  });
});
