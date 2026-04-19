import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  compileContractToml,
  evaluateLegacyReviewResult,
  validateCompiledOutput,
} from "../../src/contracts/compiler.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../defaults/contracts/codebase_review_task.toml",
);

describe("review parity scaffold", () => {
  const compiled = compileContractToml(readFileSync(fixturePath, "utf-8"));

  it("shows the false-green heading-only case passes the legacy checker", () => {
    const legacy = evaluateLegacyReviewResult([
      "No findings: no merge blockers found.",
      "Verdict: safe to merge with normal caution.",
      "Verification: reviewed the branch diff and targeted tests.",
    ].join("\n"));
    expect(legacy.ok).toBe(true);
  });

  it("fails the heading-only case under the compiled checker", () => {
    const compiledResult = validateCompiledOutput(compiled, {
      report: [
        "No findings: no merge blockers found.",
        "Verdict: safe to merge with normal caution.",
        "Verification: reviewed the branch diff and targeted tests.",
      ].join("\n"),
    });
    expect(compiledResult.ok).toBe(false);
    expect(compiledResult.issues.map((issue) => issue.path)).toContain("output.verdict");
    expect(compiledResult.issues.map((issue) => issue.path)).toContain("output.self_check");
    expect(compiledResult.issues.map((issue) => issue.path)).toContain("output.verification");
  });

  it("fails when repo scope proof is missing", () => {
    const result = validateCompiledOutput(compiled, {
      verdict: "needs_changes",
      findings: [
        {
          severity: "warning",
          file: "scripts/review-meeting.sh",
          problem: "Missing branch in target block",
          fix: "Print current branch",
        },
      ],
      verification: [{ kind: "diff_review", evidence: "reviewed branch diff" }],
      risks: [],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toContain("output.self_check");
  });

  it("passes the structured no-findings trust-repaired case", () => {
    const result = validateCompiledOutput(compiled, {
      verdict: "pass_with_notes",
      self_check: {
        repo_root: "/tmp/archon-contract-slice-1a",
        branch: "feat/contract-slice-1a",
        diff_files: [
          "scripts/review-meeting.sh",
          "tests/scripts/review-meeting.test.ts",
        ],
      },
      findings: [],
      verification: [
        { kind: "repo_scope_check", evidence: "reviewed only current execution repo" },
        { kind: "diff_review", evidence: "reviewed branch diff" },
        { kind: "test_run", evidence: "npx vitest run tests/scripts/review-meeting.test.ts passed" },
      ],
      risks: [
        "Still checker/parity slice only; prompt generation remains out of scope.",
      ],
    });
    expect(result.ok).toBe(true);
  });
});
