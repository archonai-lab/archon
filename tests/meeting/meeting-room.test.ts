import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, meetings, meetingParticipants, meetingMessages } from "../../src/db/schema.js";
import { MeetingRoom } from "../../src/meeting/meeting-room.js";

// Collect messages sent to agents
type SentMessage = { agentId: string; message: unknown };
let sent: SentMessage[] = [];
const mockSend = (agentId: string, message: unknown): boolean => {
  sent.push({ agentId, message: message as Record<string, unknown> });
  return true;
};

function messagesOfType(type: string) {
  return sent.filter((s) => (s.message as { type: string }).type === type);
}

function lastMessageOfType(type: string) {
  const msgs = messagesOfType(type);
  return msgs[msgs.length - 1];
}

// Test agent IDs
const INITIATOR = "meeting-test-initiator";
const AGENT_A = "meeting-test-a";
const AGENT_B = "meeting-test-b";

describe("MeetingRoom", () => {
  beforeAll(async () => {
    // Create test agents
    for (const id of [INITIATOR, AGENT_A, AGENT_B]) {
      await db
        .insert(agents)
        .values({
          id,
          displayName: id,
          workspacePath: `~/.archon/agents/${id}`,
          status: "online",
        })
        .onConflictDoNothing();
    }
  });

  afterAll(async () => {
    // Clean up test data
    const testMeetingIds = [
      "test-meeting-1", "test-meeting-budget", "present-test",
      "broadcast-test", "token-test", "decide-test", "complete-test",
      "persist-jsonb-test",
    ];
    for (const id of testMeetingIds) {
      await db.delete(meetingMessages).where(eq(meetingMessages.meetingId, id));
      await db.delete(meetingParticipants).where(eq(meetingParticipants.meetingId, id));
      await db.delete(meetings).where(eq(meetings.id, id));
    }
    for (const id of [INITIATOR, AGENT_A, AGENT_B]) {
      await db.delete(agents).where(eq(agents.id, id));
    }
    await closeConnection();
  });

  it("should create a meeting and persist to DB", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "test-meeting-1",
      title: "Test Meeting",
      initiatorId: INITIATOR,
      invitees: [AGENT_A, AGENT_B],
      tokenBudget: 10_000,
      agenda: "Test agenda",
      send: mockSend,
    });

    await room.persist();

    // Verify DB record
    const dbMeeting = await db.query.meetings.findFirst({
      where: eq(meetings.id, "test-meeting-1"),
    });
    expect(dbMeeting).toBeDefined();
    expect(dbMeeting!.title).toBe("Test Meeting");
    expect(dbMeeting!.phase).toBe("present");
    expect(dbMeeting!.status).toBe("active");
    expect(dbMeeting!.tokenBudget).toBe(10_000);

    // Verify participants
    expect(room.getParticipants()).toHaveLength(3);
    expect(room.getParticipants()).toContain(INITIATOR);
    expect(room.getParticipants()).toContain(AGENT_A);
    expect(room.getParticipants()).toContain(AGENT_B);
  });

  it("should send invites to non-initiator participants", () => {
    sent = [];
    const room = new MeetingRoom({
      id: "invite-test",
      title: "Invite Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A, AGENT_B],
      send: mockSend,
    });

    room.sendInvites();

    const invites = messagesOfType("meeting.invite");
    expect(invites).toHaveLength(2);
    expect(invites.map((i) => i.agentId).sort()).toEqual([AGENT_A, AGENT_B]);

    // Initiator should NOT get an invite
    expect(invites.find((i) => i.agentId === INITIATOR)).toBeUndefined();
  });

  it("should allow participants to join", () => {
    const room = new MeetingRoom({
      id: "join-test",
      title: "Join Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      send: mockSend,
    });

    expect(room.join(INITIATOR)).toBe(true);
    expect(room.join(AGENT_A)).toBe(true);
    expect(room.getJoined()).toHaveLength(2);

    // Non-participant cannot join
    expect(room.join("random-agent")).toBe(false);
  });

  it("should only allow initiator to speak in PRESENT phase", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "present-test",
      title: "Present Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      send: mockSend,
    });
    await room.persist();
    room.join(INITIATOR);
    room.join(AGENT_A);

    // Initiator can speak
    const ok = await room.speak(INITIATOR, "Here is my presentation");
    expect(ok).toBe(true);

    // Non-initiator cannot speak in PRESENT
    const fail = await room.speak(AGENT_A, "I want to talk");
    expect(fail).toBe(false);
  });

  it("should broadcast messages to all joined participants", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "broadcast-test",
      title: "Broadcast Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A, AGENT_B],
      send: mockSend,
    });
    await room.persist();
    room.join(INITIATOR);
    room.join(AGENT_A);
    room.join(AGENT_B);

    await room.speak(INITIATOR, "Hello everyone");

    const msgs = messagesOfType("meeting.message");
    expect(msgs).toHaveLength(3); // broadcast to all 3 joined
  });

  it("should track token usage", async () => {
    const room = new MeetingRoom({
      id: "token-test",
      title: "Token Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      tokenBudget: 10_000,
      send: mockSend,
    });
    await room.persist();
    room.join(INITIATOR);

    await room.speak(INITIATOR, "a".repeat(100)); // 25 tokens

    expect(room.getTokensUsed()).toBe(25);
    expect(room.getPhaseTokensUsed("present")).toBe(25);
  });

  it("should auto-advance phase when budget exhausted", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "test-meeting-budget",
      title: "Budget Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      tokenBudget: 100, // Very small: PRESENT gets 20 tokens
      send: mockSend,
    });
    await room.persist();
    room.join(INITIATOR);
    room.join(AGENT_A);

    // Clear phase_change from join
    sent = [];

    // Speak with content that exceeds PRESENT budget (20 tokens)
    // 100 chars = 25 tokens, but budget is 20
    await room.speak(INITIATOR, "a".repeat(100));

    // Should have auto-advanced to DISCUSS
    expect(room.getPhase()).toBe("discuss");
  });

  it("should handle proposals and voting in DECIDE phase", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "decide-test",
      title: "Decide Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A, AGENT_B],
      send: mockSend,
    });
    await room.persist();
    room.join(INITIATOR);
    room.join(AGENT_A);
    room.join(AGENT_B);

    // Proposals not allowed outside DECIDE phase
    expect(await room.propose(INITIATOR, "Bad timing")).toBe(false);

    // Manually advance to DECIDE
    await room.advance(INITIATOR); // PRESENT → DISCUSS
    await room.advance(INITIATOR); // DISCUSS → DECIDE

    expect(room.getPhase()).toBe("decide");

    // Now propose
    expect(await room.propose(AGENT_A, "Use TypeScript")).toBe(true);
    expect(room.getProposals()).toHaveLength(1);

    // Vote
    expect(await room.vote(INITIATOR, 0, "approve")).toBe(true);
    expect(await room.vote(AGENT_A, 0, "approve")).toBe(true);
    expect(await room.vote(AGENT_B, 0, "reject", "I prefer Rust")).toBe(true);

    // Prevent double-voting
    expect(await room.vote(INITIATOR, 0, "reject")).toBe(false);

    // Broadcast vote results
    const voteResults = messagesOfType("meeting.vote_result");
    expect(voteResults).toHaveLength(3 * 3); // 3 votes × 3 participants
  });

  it("should handle task assignment in ASSIGN phase", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "assign-test",
      title: "Assign Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      send: mockSend,
    });
    room.join(INITIATOR);
    room.join(AGENT_A);

    // Can't assign outside ASSIGN phase
    expect(await room.assignTask(INITIATOR, "Do stuff", AGENT_A)).toBe(false);

    // Advance to ASSIGN
    await room.advance(INITIATOR); // → DISCUSS
    await room.advance(INITIATOR); // → DECIDE
    await room.advance(INITIATOR); // → ASSIGN

    expect(room.getPhase()).toBe("assign");

    // Assign task
    expect(await room.assignTask(INITIATOR, "Implement auth", AGENT_A, "2026-03-15")).toBe(true);
    expect(room.getActionItems()).toHaveLength(1);
    expect(room.getActionItems()[0].task).toBe("Implement auth");
    expect(room.getActionItems()[0].assigneeId).toBe(AGENT_A);

    // Only assignee can acknowledge
    expect(await room.acknowledge(INITIATOR, 0)).toBe(false); // wrong agent
    expect(await room.acknowledge(AGENT_A, 0)).toBe(true);

    // All acknowledged → meeting completes
    expect(room.getStatus()).toBe("completed");
  });

  it("should complete meeting and persist decisions", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "complete-test",
      title: "Complete Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      send: mockSend,
    });
    await room.persist();
    room.join(INITIATOR);
    room.join(AGENT_A);

    // Go through all phases
    await room.advance(INITIATOR); // → DISCUSS
    await room.advance(INITIATOR); // → DECIDE

    // Add a proposal and approve it
    await room.propose(INITIATOR, "Ship it");
    await room.vote(INITIATOR, 0, "approve");
    // All voted → auto-advances to ASSIGN
    await room.vote(AGENT_A, 0, "approve");

    expect(room.getPhase()).toBe("assign");

    // Advance past ASSIGN → completed
    await room.advance(INITIATOR);
    expect(room.getStatus()).toBe("completed");

    // Should broadcast completion
    const completed = messagesOfType("meeting.completed");
    expect(completed.length).toBeGreaterThan(0);
  });

  it("should cancel a meeting", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "cancel-test",
      title: "Cancel Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      send: mockSend,
    });
    room.join(INITIATOR);
    room.join(AGENT_A);

    await room.cancel("Changed plans");
    expect(room.getStatus()).toBe("cancelled");

    const cancelled = messagesOfType("meeting.cancelled");
    expect(cancelled).toHaveLength(2); // sent to both participants
  });

  it("should persist decisions and action items as JSONB in Postgres", async () => {
    sent = [];
    const room = new MeetingRoom({
      id: "persist-jsonb-test",
      title: "Persistence JSONB Test",
      initiatorId: INITIATOR,
      invitees: [AGENT_A, AGENT_B],
      tokenBudget: 50_000,
      send: mockSend,
    });
    await room.persist();
    room.join(INITIATOR);
    room.join(AGENT_A);
    room.join(AGENT_B);

    // PRESENT → DISCUSS → DECIDE
    await room.advance(INITIATOR);
    await room.advance(INITIATOR);
    expect(room.getPhase()).toBe("decide");

    // Add a proposal and approve it (majority)
    await room.propose(AGENT_A, "Adopt TypeScript strict mode");
    await room.vote(INITIATOR, 0, "approve");
    await room.vote(AGENT_A, 0, "approve");
    // Third vote completes voting → auto-advances to ASSIGN
    await room.vote(AGENT_B, 0, "reject", "Too strict");

    expect(room.getPhase()).toBe("assign");

    // Assign an action item
    await room.assignTask(INITIATOR, "Enable strict mode in tsconfig", AGENT_A, "2026-03-20");

    // Complete the meeting by advancing past ASSIGN
    await room.advance(INITIATOR);
    expect(room.getStatus()).toBe("completed");

    // Query Postgres to verify JSONB columns
    const dbMeeting = await db.query.meetings.findFirst({
      where: eq(meetings.id, "persist-jsonb-test"),
    });
    expect(dbMeeting).toBeDefined();
    expect(dbMeeting!.status).toBe("completed");
    expect(dbMeeting!.completedAt).toBeInstanceOf(Date);

    // Verify decisions JSONB
    const decisions = dbMeeting!.decisions as Array<{
      proposal: string;
      proposedBy: string;
      votes: Array<{ agentId: string; vote: string; reason?: string }>;
    }>;
    expect(decisions).toHaveLength(1);
    expect(decisions[0].proposal).toBe("Adopt TypeScript strict mode");
    expect(decisions[0].proposedBy).toBe(AGENT_A);
    expect(decisions[0].votes).toHaveLength(3);

    const approves = decisions[0].votes.filter((v) => v.vote === "approve");
    const rejects = decisions[0].votes.filter((v) => v.vote === "reject");
    expect(approves).toHaveLength(2);
    expect(rejects).toHaveLength(1);
    expect(rejects[0].reason).toBe("Too strict");

    // Verify actionItems JSONB
    const items = dbMeeting!.actionItems as Array<{
      task: string;
      assigneeId: string;
      assignedBy: string;
      deadline?: string;
      acknowledged: boolean;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].task).toBe("Enable strict mode in tsconfig");
    expect(items[0].assigneeId).toBe(AGENT_A);
    expect(items[0].assignedBy).toBe(INITIATOR);
    expect(items[0].deadline).toBe("2026-03-20");
  });

  it("should not allow speaking after meeting is completed", async () => {
    const room = new MeetingRoom({
      id: "post-complete-test",
      title: "Post Complete",
      initiatorId: INITIATOR,
      invitees: [AGENT_A],
      send: mockSend,
    });
    room.join(INITIATOR);

    // Advance to completion
    await room.advance(INITIATOR); // → DISCUSS
    await room.advance(INITIATOR); // → DECIDE
    await room.advance(INITIATOR); // → ASSIGN
    await room.advance(INITIATOR); // → completed

    expect(room.getStatus()).toBe("completed");
    expect(await room.speak(INITIATOR, "Too late")).toBe(false);
  });
});
