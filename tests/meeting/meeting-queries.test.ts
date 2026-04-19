import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closeConnection } from "../../src/db/connection.js";
import { agents, meetings, meetingParticipants, meetingMessages } from "../../src/db/schema.js";
import {
  listMeetings,
  getMeetingTranscript,
  assertStructuralProvenance,
} from "../../src/meeting/meeting-queries.js";

const INITIATOR = "mq-test-initiator";
const PARTICIPANT = "mq-test-participant";
const MEETING_1 = "mq-test-meeting-1";
const MEETING_2 = "mq-test-meeting-2";

beforeAll(async () => {
  // Set up agents
  await db.insert(agents).values([
    { id: INITIATOR, displayName: "Initiator", workspacePath: "/tmp/mq-init" },
    { id: PARTICIPANT, displayName: "Participant", workspacePath: "/tmp/mq-part" },
  ]).onConflictDoNothing();

  // Create two meetings
  await db.insert(meetings).values([
    {
      id: MEETING_1,
      title: "Query Test Meeting 1",
      initiatorId: INITIATOR,
      status: "completed",
      phase: "assign",
      tokensUsed: 1000,
      decisions: [{ proposal: "Use TypeScript" }],
      actionItems: [{ task: "Migrate to TS", assigneeId: PARTICIPANT }],
    },
    {
      id: MEETING_2,
      title: "Query Test Meeting 2",
      initiatorId: INITIATOR,
      status: "active",
      phase: "discuss",
      tokensUsed: 500,
    },
  ]).onConflictDoNothing();

  // Add participants
  await db.insert(meetingParticipants).values([
    { meetingId: MEETING_1, agentId: INITIATOR },
    { meetingId: MEETING_1, agentId: PARTICIPANT },
    { meetingId: MEETING_2, agentId: INITIATOR },
  ]).onConflictDoNothing();

  // Add messages
  await db.insert(meetingMessages).values([
    {
      meetingId: MEETING_1,
      agentId: INITIATOR,
      phase: "present",
      content: "Let's discuss TypeScript migration",
      provenanceKnown: true,
      speakerRole: "initiator",
      authorityScope: "meeting:initiator",
      contentType: "statement",
      tokenCount: 10,
    },
    {
      meetingId: MEETING_1,
      agentId: PARTICIPANT,
      phase: "discuss",
      content: "I think we should do it",
      provenanceKnown: true,
      speakerRole: "participant",
      authorityScope: "phase:open_discussion",
      contentType: "statement",
      tokenCount: 8,
    },
    {
      meetingId: MEETING_1,
      agentId: INITIATOR,
      phase: "discuss",
      content: "Agreed, let's proceed",
      provenanceKnown: true,
      speakerRole: "initiator",
      authorityScope: "meeting:initiator",
      contentType: "statement",
      tokenCount: 6,
    },
    {
      meetingId: MEETING_2,
      agentId: INITIATOR,
      phase: "present",
      content: "Legacy transcript row with unknown provenance",
      provenanceKnown: false,
      speakerRole: "participant",
      authorityScope: "meeting:participant",
      contentType: "statement",
      tokenCount: 7,
    },
  ]);
});

afterAll(async () => {
  await db.delete(meetingMessages).where(eq(meetingMessages.meetingId, MEETING_1));
  await db.delete(meetingMessages).where(eq(meetingMessages.meetingId, MEETING_2));
  await db.delete(meetingParticipants).where(eq(meetingParticipants.meetingId, MEETING_1));
  await db.delete(meetingParticipants).where(eq(meetingParticipants.meetingId, MEETING_2));
  await db.delete(meetings).where(eq(meetings.id, MEETING_1));
  await db.delete(meetings).where(eq(meetings.id, MEETING_2));
  await db.delete(agents).where(eq(agents.id, INITIATOR));
  await db.delete(agents).where(eq(agents.id, PARTICIPANT));
  await closeConnection();
});

describe("Meeting Queries", () => {
  describe("listMeetings", () => {
    it("should list all meetings", async () => {
      const result = await listMeetings();
      const ids = result.map((m) => m.id);
      expect(ids).toContain(MEETING_1);
      expect(ids).toContain(MEETING_2);
    });

    it("should filter by status", async () => {
      const completed = await listMeetings({ status: "completed" });
      expect(completed.some((m) => m.id === MEETING_1)).toBe(true);
      expect(completed.some((m) => m.id === MEETING_2)).toBe(false);

      const active = await listMeetings({ status: "active" });
      expect(active.some((m) => m.id === MEETING_2)).toBe(true);
      expect(active.some((m) => m.id === MEETING_1)).toBe(false);
    });

    it("should include participant and message counts", async () => {
      const result = await listMeetings();
      const m1 = result.find((m) => m.id === MEETING_1);
      expect(m1).toBeDefined();
      expect(m1!.participantCount).toBe(2);
      expect(m1!.messageCount).toBe(3);
    });

    it("should respect limit", async () => {
      const result = await listMeetings({ limit: 1 });
      expect(result.length).toBeLessThanOrEqual(1);
    });
  });

  describe("getMeetingTranscript", () => {
    it("should return full transcript for a meeting", async () => {
      const result = await getMeetingTranscript(MEETING_1);
      expect(result).not.toBeNull();
      expect(result!.meeting.id).toBe(MEETING_1);
      expect(result!.meeting.title).toBe("Query Test Meeting 1");
      expect(result!.messages).toHaveLength(3);
      expect(result!.participants).toContain(INITIATOR);
      expect(result!.participants).toContain(PARTICIPANT);
    });

    it("should include agent display names in messages", async () => {
      const result = await getMeetingTranscript(MEETING_1);
      expect(result!.messages[0].displayName).toBe("Initiator");
      expect(result!.messages[1].displayName).toBe("Participant");
    });

    it("should surface structural provenance fields in one hop", async () => {
      const result = await getMeetingTranscript(MEETING_1);
      expect(result!.messages[0]).toMatchObject({
        agentId: INITIATOR,
        speakerId: INITIATOR,
        speakerRole: "initiator",
        authorityScope: "meeting:initiator",
        contentType: "statement",
      });
      expect(result!.messages[1]).toMatchObject({
        agentId: PARTICIPANT,
        speakerId: PARTICIPANT,
        speakerRole: "participant",
        authorityScope: "phase:open_discussion",
        contentType: "statement",
      });
    });

    it("should preserve legacy unknown provenance instead of inventing structure", async () => {
      const result = await getMeetingTranscript(MEETING_2);
      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
      expect(result!.messages[0]).toMatchObject({
        agentId: INITIATOR,
        speakerId: INITIATOR,
        speakerRole: null,
        authorityScope: null,
        contentType: null,
      });
    });

    it("should include decisions and action items", async () => {
      const result = await getMeetingTranscript(MEETING_1);
      expect(result!.meeting.decisions).toHaveLength(1);
      expect(result!.meeting.actionItems).toHaveLength(1);
    });

    it("should return null for non-existent meeting", async () => {
      const result = await getMeetingTranscript("nonexistent");
      expect(result).toBeNull();
    });

    it("should order messages chronologically", async () => {
      const result = await getMeetingTranscript(MEETING_1);
      const ids = result!.messages.map((m) => m.id);
      // IDs are serial, so should be ascending
      expect(ids[0]).toBeLessThan(ids[1]);
      expect(ids[1]).toBeLessThan(ids[2]);
    });

    it("should keep speaker identity strict even when legacy provenance is unknown", () => {
      expect(() => assertStructuralProvenance({
        id: 999,
        agentId: "",
        provenanceKnown: false,
        speakerRole: null,
        authorityScope: null,
        contentType: null,
        displayName: "Initiator",
        phase: "present",
        content: "missing speaker",
        tokenCount: 1,
        relevance: null,
        createdAt: new Date(),
      })).toThrow(/speaker_id/);
    });
  });
});
