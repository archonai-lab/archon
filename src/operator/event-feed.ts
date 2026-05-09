import { nanoid } from "nanoid";

export type OperatorEventKind =
  | "lifecycle"
  | "progress"
  | "result"
  | "meeting_membership"
  | "meeting_status"
  | "validation_error"
  | "retention_drop"
  | "feed_reset";

export type OperatorEventSeverity = "info" | "warn" | "error";

export interface OperatorEventActor {
  id: string;
  type: "agent" | "hub" | "system";
}

export interface OperatorEvent {
  eventId: string;
  sequence: number;
  timestamp: string;
  actor: OperatorEventActor;
  source: string;
  kind: OperatorEventKind;
  taskId: string | null;
  meetingId: string | null;
  runId: string | null;
  correlationId: string | null;
  severity: OperatorEventSeverity;
  summary: string;
  payload: Record<string, unknown>;
}

export interface OperatorEventIntent {
  actor: OperatorEventActor;
  source: string;
  kind: OperatorEventKind;
  taskId?: string | null;
  meetingId?: string | null;
  runId?: string | null;
  correlationId?: string | null;
  severity?: OperatorEventSeverity;
  payload?: Record<string, unknown>;
}

export interface OperatorFeedQuery {
  limit?: number;
}

type EventListener = (event: OperatorEvent) => void;

const TRACEABLE_KINDS = new Set<OperatorEventKind>([
  "lifecycle",
  "progress",
  "result",
  "meeting_membership",
  "meeting_status",
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// CALIBRATION: 500 events covers ordinary task/meeting bursts while keeping the
// MVP in-memory feed small. Retention is explicit through retention_drop events.
export const DEFAULT_OPERATOR_EVENT_CAPACITY = 500;

export class EventFeedStore {
  private events: OperatorEvent[] = [];
  private sequence = 0;
  private listeners = new Set<EventListener>();
  private readonly capacity: number;

  constructor(options: { capacity?: number } = {}) {
    this.capacity = Math.max(2, options.capacity ?? DEFAULT_OPERATOR_EVENT_CAPACITY);
    this.reset("event feed store initialized");
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  append(intent: OperatorEventIntent): OperatorEvent {
    const invalidReason = this.validateIntent(intent);
    if (invalidReason) {
      return this.appendValidationError(intent, invalidReason);
    }

    const event = this.buildEvent(intent);
    this.appendWithRetention(event);
    return event;
  }

  reset(reason: string): OperatorEvent {
    this.events = [];
    return this.appendFinal(this.buildEvent({
      actor: { id: "hub", type: "hub" },
      source: "operator.event_feed",
      kind: "feed_reset",
      severity: "warn",
      payload: { reason },
    }));
  }

  latest(query: OperatorFeedQuery = {}): OperatorEvent[] {
    return this.takeLatest(this.events, query.limit);
  }

  byTaskId(taskId: string, query: OperatorFeedQuery = {}): OperatorEvent[] {
    return this.takeLatest(this.events.filter((event) => event.taskId === taskId), query.limit);
  }

  byMeetingId(meetingId: string, query: OperatorFeedQuery = {}): OperatorEvent[] {
    return this.takeLatest(this.events.filter((event) => event.meetingId === meetingId), query.limit);
  }

  detail(eventId: string): OperatorEvent | null {
    return this.events.find((event) => event.eventId === eventId) ?? null;
  }

  private validateIntent(intent: OperatorEventIntent): string | null {
    if (!intent.actor?.id || !intent.actor.type) return "operator event actor is required";
    if (!intent.source) return "operator event source is required";
    if (TRACEABLE_KINDS.has(intent.kind) && !intent.taskId && !intent.meetingId && !intent.runId) {
      return `${intent.kind} event requires taskId, meetingId, or runId`;
    }
    return null;
  }

  private appendValidationError(intent: OperatorEventIntent, reason: string): OperatorEvent {
    const event = this.buildEvent({
      actor: { id: "hub", type: "hub" },
      source: "operator.event_feed.validation",
      kind: "validation_error",
      taskId: intent.taskId,
      meetingId: intent.meetingId,
      runId: intent.runId,
      correlationId: intent.correlationId,
      severity: "error",
      payload: {
        reason,
        rejectedKind: intent.kind,
        rejectedSource: intent.source,
        rejectedActor: intent.actor,
      },
    });
    this.appendWithRetention(event);
    return event;
  }

  private appendWithRetention(event: OperatorEvent): void {
    if (this.events.length < this.capacity) {
      this.appendFinal(event);
      return;
    }

    // If we are at capacity, appending this event + its mandatory retention_drop
    // would push us over by 1. We must drop enough to make room for BOTH.
    // If the event itself is a retention_drop or reset, it shouldn't trigger its own drop record.
    const isMeta = event.kind === "retention_drop" || event.kind === "feed_reset";

    if (isMeta) {
      this.appendFinal(event);
      return;
    }

    // Aggregate drop: shift once for the new event, once for the retention_drop itself.
    const dropped: OperatorEvent[] = [];
    while (this.events.length >= this.capacity - 1) {
      const d = this.events.shift();
      if (d) dropped.push(d);
    }

    if (dropped.length > 0) {
      this.appendFinal(this.buildEvent({
        actor: { id: "hub", type: "hub" },
        source: "operator.event_feed.retention",
        kind: "retention_drop",
        severity: "warn",
        payload: {
          droppedCount: dropped.length,
          firstDroppedSequence: dropped[0].sequence,
          lastDroppedSequence: dropped[dropped.length - 1].sequence,
          droppedEventIds: dropped.map((d) => d.eventId),
          capacity: this.capacity,
        },
      }));
    }

    this.appendFinal(event);
  }

  private appendFinal(event: OperatorEvent): OperatorEvent {
    // Safety check: ensure we stay under capacity even if appendWithRetention logic has an edge case
    while (this.events.length >= this.capacity) {
      this.events.shift();
    }
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
    return event;
  }

  private buildEvent(intent: OperatorEventIntent): OperatorEvent {
    const event: OperatorEvent = {
      eventId: nanoid(),
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      actor: intent.actor,
      source: intent.source,
      kind: intent.kind,
      taskId: intent.taskId ?? null,
      meetingId: intent.meetingId ?? null,
      runId: intent.runId ?? null,
      correlationId: intent.correlationId ?? null,
      severity: intent.severity ?? "info",
      summary: "",
      payload: intent.payload ?? {},
    };
    event.summary = summarizeEvent(event);
    return event;
  }

  private takeLatest(events: OperatorEvent[], requestedLimit?: number): OperatorEvent[] {
    const limit = normalizeLimit(requestedLimit);
    return events.slice(-limit);
  }
}

function normalizeLimit(limit?: number): number {
  if (!limit) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export function summarizeEvent(event: OperatorEvent): string {
  const actor = event.actor.id;
  switch (event.kind) {
    case "lifecycle":
      return `${actor} changed task ${event.taskId ?? event.runId ?? "run"} lifecycle`;
    case "progress":
      return `${actor} reported progress on task ${event.taskId ?? "unknown"}`;
    case "result":
      return `${actor} completed task ${event.taskId ?? "unknown"} with ${stringPayload(event, "status", "result")}`;
    case "meeting_membership":
      return `${actor} changed membership for meeting ${event.meetingId ?? "unknown"}`;
    case "meeting_status":
      return `${actor} changed meeting ${event.meetingId ?? "unknown"} status`;
    case "validation_error":
      return `Hub rejected invalid operator event: ${stringPayload(event, "reason", "validation error")}`;
    case "retention_drop":
      return `Operator feed dropped ${numberPayload(event, "droppedCount", 0)} event(s) due to retention`;
    case "feed_reset":
      return `Operator feed reset: ${stringPayload(event, "reason", "history reset")}`;
  }
}

function stringPayload(event: OperatorEvent, key: string, fallback: string): string {
  const value = event.payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function numberPayload(event: OperatorEvent, key: string, fallback: number): number {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
