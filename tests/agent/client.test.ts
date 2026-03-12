import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { AgentClient } from "../../src/agent/client.js";
import { HubServer } from "../../src/hub/server.js";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, meetingParticipants, meetingMessages, meetings } from "../../src/db/schema.js";
import { inArray } from "drizzle-orm";

const TEST_PORT = 9598;
const WS_URL = `ws://localhost:${TEST_PORT}`;

let hub: HubServer;
const clients: AgentClient[] = [];

function createClient(
  agentId: string,
  opts?: Partial<ConstructorParameters<typeof AgentClient>[0]>,
): AgentClient {
  const client = new AgentClient({
    agentId,
    hubUrl: WS_URL,
    reconnect: false, // disable reconnect by default in tests
    pingInterval: 60_000, // slow down pings so they don't interfere
    ...opts,
  });
  clients.push(client);
  return client;
}

function waitForEvent<T>(
  client: AgentClient,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    client.once(event as any, ((...args: any[]) => {
      clearTimeout(timer);
      resolve(args[0] as T);
    }) as any);
  });
}

beforeAll(async () => {
  // Ensure test agents exist
  await db
    .insert(agents)
    .values([
      {
        id: "client-test-a",
        displayName: "Client Test A",
        workspacePath: "~/.archon/agents/client-test-a",
        status: "active",
      },
      {
        id: "client-test-b",
        displayName: "Client Test B",
        workspacePath: "~/.archon/agents/client-test-b",
        status: "active",
      },
    ])
    .onConflictDoNothing();

  hub = new HubServer();
  await hub.start(TEST_PORT);
});

afterEach(() => {
  for (const c of clients) {
    c.disconnect();
  }
  clients.length = 0;
});

afterAll(async () => {
  await hub.stop();
  // Clean up meeting data before agents (FK constraints)
  const testAgentIds = ["client-test-a", "client-test-b"];
  await db.delete(meetingMessages).where(inArray(meetingMessages.agentId, testAgentIds));
  await db.delete(meetingParticipants).where(inArray(meetingParticipants.agentId, testAgentIds));
  await db.delete(meetings).where(inArray(meetings.initiatorId, testAgentIds));
  await db.delete(agents).where(inArray(agents.id, testAgentIds));
  await closeConnection();
});

describe("AgentClient", () => {
  describe("connection & auth", () => {
    it("should connect and authenticate", async () => {
      const client = createClient("client-test-a");
      const authPromise = waitForEvent(client, "auth.ok");
      client.connect();

      const msg = (await authPromise) as any;
      expect(msg.type).toBe("auth.ok");
      expect(msg.pendingInvites).toEqual([]);
      expect(client.connected).toBe(true);
    });

    it("should emit connected event on auth success", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();

      await connPromise; // should not throw
      expect(client.connected).toBe(true);
    });

    it("should emit hub.error for invalid token", async () => {
      const client = createClient("client-test-a", { token: "wrong-token" });
      const errPromise = waitForEvent(client, "hub.error");
      client.connect();

      const msg = (await errPromise) as any;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("AUTH_FAILED");
    });

    it("should emit hub.error for nonexistent agent", async () => {
      const client = createClient("nonexistent-agent-xyz");
      const errPromise = waitForEvent(client, "hub.error");
      client.connect();

      const msg = (await errPromise) as any;
      expect(msg.type).toBe("error");
      expect(msg.code).toBe("AUTH_FAILED");
    });

    it("should report connected=false before connecting", () => {
      const client = createClient("client-test-a");
      expect(client.connected).toBe(false);
    });

    it("should report connected=false after disconnect", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;
      expect(client.connected).toBe(true);

      client.disconnect();
      expect(client.connected).toBe(false);
    });
  });

  describe("ping/pong", () => {
    it("should respond to server pong on ping", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      // Manually send a ping and wait for pong
      const pongPromise = waitForEvent(client, "pong");
      client.send({ type: "ping" });
      const msg = (await pongPromise) as any;
      expect(msg.type).toBe("pong");
    });
  });

  describe("send helpers", () => {
    it("should return false when not connected", () => {
      const client = createClient("client-test-a");
      expect(client.send({ type: "ping" })).toBe(false);
    });

    it("should return true when connected", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      expect(client.send({ type: "ping" })).toBe(true);
    });
  });

  describe("meeting helpers", () => {
    it("should send meeting.join", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      // Will get a hub error (no such meeting), but the message should be sent
      const errPromise = waitForEvent(client, "hub.error");
      client.joinMeeting("fake-meeting-id");
      const msg = (await errPromise) as any;
      expect(msg.code).toBe("MEETING_NOT_FOUND");
    });

    it("should send meeting.create and receive meeting.created", async () => {
      // Set up two clients — initiator and invitee
      const initiator = createClient("client-test-a");
      const invitee = createClient("client-test-b");

      const connA = waitForEvent(initiator, "connected");
      const connB = waitForEvent(invitee, "connected");
      initiator.connect();
      invitee.connect();
      await Promise.all([connA, connB]);

      // Listen for the created response on initiator
      const createdPromise = waitForEvent(initiator, "message");
      // Listen for invite on invitee
      const invitePromise = waitForEvent(invitee, "meeting.invite");

      initiator.createMeeting("Test Meeting", ["client-test-b"], {
        agenda: "Test the agent client",
        tokenBudget: 5000,
      });

      const created = (await createdPromise) as any;
      expect(created.type).toBe("meeting.created");
      expect(created.title).toBe("Test Meeting");
      expect(created.participants).toContain("client-test-a");
      expect(created.participants).toContain("client-test-b");

      const invite = (await invitePromise) as any;
      expect(invite.type).toBe("meeting.invite");
      expect(invite.title).toBe("Test Meeting");
      expect(invite.initiator).toBe("client-test-a");
    });

    it("should send relevance response", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      // Absorb the hub error from fake meeting ID
      const errPromise = waitForEvent(client, "hub.error");
      const sent = client.sendRelevance("some-meeting", "must_speak", "I know about this");
      expect(sent).toBe(true);
      const msg = (await errPromise) as any;
      expect(msg.code).toBe("MEETING_NOT_FOUND");
    });

    it("should send vote", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      const errPromise = waitForEvent(client, "hub.error");
      const sent = client.vote("some-meeting", 0, "approve", "Looks good");
      expect(sent).toBe(true);
      const msg = (await errPromise) as any;
      expect(msg.code).toBe("MEETING_NOT_FOUND");
    });

    it("should send assignTask", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      const errPromise = waitForEvent(client, "hub.error");
      const sent = client.assignTask("some-meeting", "Write docs", "client-test-b", "2026-03-15");
      expect(sent).toBe(true);
      const msg = (await errPromise) as any;
      expect(msg.code).toBe("MEETING_NOT_FOUND");
    });
  });

  describe("reconnect", () => {
    it("should reconnect on unexpected close when enabled", async () => {
      const client = createClient("client-test-a", {
        reconnect: true,
        maxReconnectDelay: 1000,
      });

      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      // Force-close the underlying socket to simulate a drop
      const disconnectPromise = waitForEvent(client, "disconnected");
      (client as any).ws.close();
      await disconnectPromise;

      // Should reconnect and emit connected again
      const reconnPromise = waitForEvent(client, "connected", 5000);
      await reconnPromise;
      expect(client.connected).toBe(true);
    });

    it("should NOT reconnect after intentional disconnect", async () => {
      const client = createClient("client-test-a", { reconnect: true });
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      client.disconnect();

      // Wait a bit — should NOT reconnect
      await new Promise((r) => setTimeout(r, 1500));
      expect(client.connected).toBe(false);
    });

    it("should use exponential backoff", async () => {
      const client = createClient("client-test-a", {
        reconnect: true,
        maxReconnectDelay: 5000,
      });

      // Access private field to check backoff
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      // Force close
      (client as any).ws.close();
      await waitForEvent(client, "disconnected");

      // After first disconnect, reconnectAttempts should be 1 (incremented in scheduleReconnect)
      // The delay was 1000 * 2^0 = 1000ms
      expect((client as any).reconnectAttempts).toBe(1);
    });
  });

  describe("disconnect", () => {
    it("should emit disconnected event", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      const disconnPromise = waitForEvent<number>(client, "disconnected");
      client.disconnect();
      // Should resolve without error
      await disconnPromise;
    });

    it("should clean up timers on disconnect", async () => {
      const client = createClient("client-test-a", { pingInterval: 100 });
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      // Ping timer should be set
      expect((client as any).pingTimer).not.toBeNull();

      client.disconnect();

      // Timers should be cleared
      expect((client as any).pingTimer).toBeNull();
      expect((client as any).reconnectTimer).toBeNull();
    });
  });

  describe("directory helpers", () => {
    it("should send directory.list and receive result", async () => {
      const client = createClient("client-test-a");
      const connPromise = waitForEvent(client, "connected");
      client.connect();
      await connPromise;

      const resultPromise = waitForEvent(client, "directory.result");
      client.listAgents();

      const msg = (await resultPromise) as any;
      expect(msg.type).toBe("directory.result");
      expect(Array.isArray(msg.agents)).toBe(true);
    });
  });
});
