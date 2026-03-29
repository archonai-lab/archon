# M1 Per-Agent Memory Spec — Seven Constraints

**Status:** Draft — output of meeting, DIVERGE phase
**Owner:** CEO
**Date:** 2026-03-24

---

## Constraints

1. **Hardcoded format** — block structure is fixed in hub source, not configurable.

2. **Symmetric extraction** — same logic writes and reads; no asymmetric parsing paths.

3. **Advisory placement, structurally anchored** — block appears after all instruction-bearing segments; placement defined by hub at the structural level, not by position heuristic.

4. **Delimiter escaping at write time** — hub sanitizes delimiter out of block content before storage.

5. **Fail-closed on extraction failure** — malformed block is dropped, logged as `{ agentId, timestamp, truncatedHMAC, failureType }` (first 128 bits of HMAC-SHA256, keyed per-agent-per-timestamp — structurally opaque to an observer without the key; prevents hash-oracle attack on log), error returned to caller, no content exposed.

6. **Compile-time constant** — `INSTRUCTION_SEGMENT_MARKER` is a compile-time constant in hub source. No config-loading path may shadow it. Runtime assertion in CI: `assert INSTRUCTION_SEGMENT_MARKER === compiledConstant`.

7. **Delimiter frozen for M1** — delimiter does not rotate without a separate migration spec written and reviewed before activation. Rotation requires: re-escape existing content, atomic switchover of extraction logic, migration spec reviewed by security agent. No rotation permitted in M1 scope.

---

## Acceptance Tests

| Test | What it verifies |
|------|-----------------|
| Delimiter smuggling — parameterized against current delimiter value | Constraint 4: escaped content cannot break extraction |
| Extraction failure with malformed block | Constraint 5: no content in error path, first-128-bit HMAC-SHA256 logged (keyed per-agent-per-timestamp), not raw hash |
| Runtime constant assertion | Constraint 6: `INSTRUCTION_SEGMENT_MARKER` equals compile-time value in CI |
| Write + read round-trip with adversarial content | Constraint 2: symmetric logic, no asymmetric parsing divergence |
| Block position in assembled context | Constraint 3: block always after instruction-bearing segments |

---

## Out of Scope for M1

- Delimiter rotation protocol (requires separate spec)
- Migration tooling for re-escaping existing content
- Log access control / audit trail threat model (flagged — who can read logs affects exposure risk of truncatedHMAC)
