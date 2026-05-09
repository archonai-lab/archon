# Operator Event Feed

The operator event feed is the hub-owned audit stream for MVP operator surfaces. It is not a terminal log mirror. Events are structured records that let the operator UI reconstruct task, meeting, validation, and retention history without scraping process output.

## Contract

Each event has:

- `eventId`: unique event identifier.
- `sequence`: monotonically increasing store sequence.
- `timestamp`: ISO timestamp assigned by the hub.
- `actor`: `{ id, type }`, where `type` is `agent`, `hub`, or `system`.
- `source`: subsystem that emitted the event.
- `kind`: one of `lifecycle`, `progress`, `result`, `meeting_membership`, `meeting_status`, `validation_error`, `retention_drop`, or `feed_reset`.
- `taskId`, `meetingId`, `runId`, `correlationId`: nullable trace fields.
- `severity`: `info`, `warn`, or `error`.
- `summary`: hub-generated human-readable summary.
- `payload`: kind-specific structured metadata.

Traceable kinds (`lifecycle`, `progress`, `result`, `meeting_membership`, `meeting_status`) must include at least one of `taskId`, `meetingId`, or `runId`. Invalid intents are stored as `validation_error` events instead of being silently dropped.

Retention is explicit. When capacity pressure drops old records, the store emits one aggregate `retention_drop` event with `droppedCount`, `firstDroppedSequence`, `lastDroppedSequence`, `droppedEventIds`, and `capacity`. Consumers must read `droppedEventIds`; the older singular `droppedEventId` shape is not part of the contract.

## Hub Protocol

Live broadcasts use:

- `operator.event`: sent only to sessions that can view the feed.

Historical reads use:

- `operator.feed.latest`
- `operator.feed.by_task`
- `operator.feed.by_meeting`
- `operator.feed.detail`

Each read returns a matching `*.result` message for authorized sessions. Unauthorized sessions receive `PERMISSION_DENIED` and do not receive historical events.

## Permissions

The MVP gate is:

- `ceo`: allowed through the temporary operator-board bridge.
- `levia`: allowed through the temporary operator-board bridge.
- Any agent with `operator:*` `read`: allowed through the durable permission path.

All other sessions are denied both live `operator.event` broadcasts and historical feed reads. The bridge is intentionally narrow and should be removed when operator roles are seeded durably.

## Operator Workflow

Operators subscribe to live `operator.event` messages while using historical reads to hydrate or repair local state:

1. Load `operator.feed.latest` on connect.
2. Use `operator.feed.by_task` or `operator.feed.by_meeting` for focused drill-down.
3. Use `operator.feed.detail` when a UI row needs the full payload.
4. Treat `retention_drop` as a visible gap marker, not as an error.
5. Treat `validation_error` as hub evidence that an inbound message was rejected or normalized into an operator-visible failure.
