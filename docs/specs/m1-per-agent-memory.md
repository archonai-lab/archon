# M1 Per-Agent Memory Spec

**Status:** Final — closed in diverge meeting 2026-03-24
**Owner:** CEO (Vex)
**Applies to:** Hub source, M1 scope only

---

## Seven Constraints

### 1. Hardcoded format
Block structure is fixed in hub source, not configurable. No database row, no environment variable, no config file controls the block shape.

### 2. Symmetric extraction
The same logic writes and reads. No asymmetric parsing paths — the code that produces a block is the reference for the code that consumes it.

### 3. Advisory placement, structurally anchored
The memory block appears **after** all instruction-bearing segments. Placement is enforced at the structural level by the hub, not by a position heuristic or convention.

### 4. Delimiter escaping at write time
The hub sanitizes the delimiter out of block content before storage. Escaping happens on the write path, unconditionally.

### 5. Fail-closed on extraction failure
A malformed block is dropped. The hub logs `{ agentId, timestamp, blockHash, failureType }` and returns an error to the caller. No partial content is exposed.

**Tradeoff (explicit):** `blockHash` is a content fingerprint. An attacker with log access who controls block content and knows the hash function can probe by brute-force correlation. This is accepted in M1 because logs are not a public surface. If that assumption changes, replace `blockHash` with a structural failure code.

### 6. Compile-time constant
`INSTRUCTION_SEGMENT_MARKER` is a compile-time constant in hub source. No config-loading path can shadow it. A runtime assertion in CI verifies the runtime value matches the compiled literal.

### 7. Delimiter freeze for M1
The delimiter does not rotate in M1. Any rotation requires a separate migration spec — written and reviewed — before activation. The migration spec must address: re-escaping existing stored blocks under the new delimiter before the new extraction logic activates, atomically. No rotation without that spec.

---

## Versioning constraint

Delimiter value, escaping rule, and extraction regex are a **versioned triple** — they can only change together, tested together. Changing one without the others is a breaking change.

---

## Acceptance test cases

Three test cases are required before M1 ships. These are not optional.

### TC-1: Delimiter smuggling
Parameterized against the current delimiter value (not hardcoded to a specific string). A write that includes the delimiter in block content must produce a stored value where extraction cannot misread the boundary. Verify extraction returns the correct content, not a split or corrupt block.

### TC-2: Extraction failure — no content leak
Force an extraction failure (malformed block). Verify: (a) the error is returned to the caller, (b) no content from the block appears in the response, (c) the failure is logged with the correct shape.

### TC-3: Compile-time constant — runtime assertion
Assert `INSTRUCTION_SEGMENT_MARKER === compiledConstant` at runtime. CI must verify no config-loading path produces a divergent value. This is a positive assertion — not "prove absence of a setter" but "assert the value matches."

---

## Out of scope for M1

- Delimiter rotation protocol
- Log access controls (separate security surface)
- Salting `blockHash` (deferred — not needed while logs are non-public)
