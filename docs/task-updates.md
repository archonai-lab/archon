# Task Updates

This page documents the task update concurrency contract used by the hub protocol.

## Conditional Updates

Agents may send `expectedTaskVersion` on `task.update` when an update belongs to a specific observed task attempt.

```json
{
  "type": "task.update",
  "taskId": "task_123",
  "attemptId": "attempt_abc",
  "expectedTaskVersion": 2,
  "status": "done",
  "result": "Completed."
}
```

When `expectedTaskVersion` is present, the hub writes with a database-level `taskId + version` guard. Exactly one concurrent writer can win for a given version. A losing writer receives `task.update.rejected`; the hub does not broadcast `task.updated` for the rejected update.

```json
{
  "type": "task.update.rejected",
  "accepted": false,
  "code": "STALE_ATTEMPT",
  "taskId": "task_123",
  "attemptId": "attempt_abc",
  "currentStatus": "done",
  "currentVersion": 3,
  "attemptClosed": true
}
```

If `expectedTaskVersion` is omitted, `task.update` keeps the existing non-conditional behavior and terminal-state immutability still applies.

## Attempt IDs

`attemptId` is currently a correlation token. The hub echoes it in `task.update.rejected` when provided so an agent can close the right local attempt.

PR1 does not make `attemptId` an authority boundary. A later slice should decide whether the hub owns attempt identity validation and duplicate-attempt rejection.

## Failure Behavior

- Stale conditional writes return `STALE_ATTEMPT`.
- Conditional writes against already terminal tasks return `STALE_ATTEMPT`.
- Non-conditional writes against terminal tasks return a client error.
- Rejected stale writes do not mutate task state and do not emit `task.updated`.
