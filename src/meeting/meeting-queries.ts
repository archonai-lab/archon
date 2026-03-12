import { eq, desc, lt, and, sql } from "drizzle-orm";
import { db } from "../db/connection.js";
import { meetings, meetingMessages, meetingParticipants, agents } from "../db/schema.js";

export interface MeetingHistoryOpts {
  status?: "active" | "completed" | "cancelled";
  cursor?: string; // meeting ID for cursor-based pagination
  limit?: number;
}

export interface MeetingSummary {
  id: string;
  title: string;
  status: string;
  phase: string;
  methodology: string;
  initiatorId: string;
  tokensUsed: number;
  tokenBudget: number;
  createdAt: Date;
  completedAt: Date | null;
  participantCount: number;
  messageCount: number;
}

export interface TranscriptEntry {
  id: number;
  agentId: string;
  displayName: string;
  phase: string;
  content: string;
  tokenCount: number;
  relevance: string | null;
  createdAt: Date;
}

export interface MeetingTranscriptResult {
  meeting: {
    id: string;
    title: string;
    status: string;
    methodology: string;
    initiatorId: string;
    agenda: unknown;
    decisions: unknown[];
    actionItems: unknown[];
    createdAt: Date;
    completedAt: Date | null;
  };
  messages: TranscriptEntry[];
  participants: string[];
}

export async function listMeetings(opts: MeetingHistoryOpts = {}): Promise<MeetingSummary[]> {
  const limit = opts.limit ?? 20;

  const conditions = [];
  if (opts.status) {
    conditions.push(eq(meetings.status, opts.status));
  }
  if (opts.cursor) {
    // Get the createdAt of the cursor meeting for pagination
    const cursorMeeting = await db.query.meetings.findFirst({
      where: eq(meetings.id, opts.cursor),
    });
    if (cursorMeeting) {
      conditions.push(lt(meetings.createdAt, cursorMeeting.createdAt));
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.query.meetings.findMany({
    where,
    orderBy: [desc(meetings.createdAt)],
    limit,
  });

  // Get participant and message counts
  const results: MeetingSummary[] = [];
  for (const row of rows) {
    const [participantResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, row.id));

    const [messageResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(meetingMessages)
      .where(eq(meetingMessages.meetingId, row.id));

    results.push({
      id: row.id,
      title: row.title,
      status: row.status,
      phase: row.phase,
      methodology: row.methodology,
      initiatorId: row.initiatorId,
      tokensUsed: row.tokensUsed,
      tokenBudget: row.tokenBudget,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      participantCount: participantResult?.count ?? 0,
      messageCount: messageResult?.count ?? 0,
    });
  }

  return results;
}

export async function getMeetingTranscript(meetingId: string): Promise<MeetingTranscriptResult | null> {
  const meeting = await db.query.meetings.findFirst({
    where: eq(meetings.id, meetingId),
  });

  if (!meeting) return null;

  // Get messages with agent display names
  const messages = await db
    .select({
      id: meetingMessages.id,
      agentId: meetingMessages.agentId,
      displayName: agents.displayName,
      phase: meetingMessages.phase,
      content: meetingMessages.content,
      tokenCount: meetingMessages.tokenCount,
      relevance: meetingMessages.relevance,
      createdAt: meetingMessages.createdAt,
    })
    .from(meetingMessages)
    .innerJoin(agents, eq(meetingMessages.agentId, agents.id))
    .where(eq(meetingMessages.meetingId, meetingId))
    .orderBy(meetingMessages.id);

  // Get participants
  const participantRows = await db.query.meetingParticipants.findMany({
    where: eq(meetingParticipants.meetingId, meetingId),
  });

  return {
    meeting: {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      methodology: meeting.methodology,
      initiatorId: meeting.initiatorId,
      agenda: meeting.agenda,
      decisions: meeting.decisions ?? [],
      actionItems: meeting.actionItems ?? [],
      createdAt: meeting.createdAt,
      completedAt: meeting.completedAt,
    },
    messages,
    participants: participantRows.map((p) => p.agentId),
  };
}
