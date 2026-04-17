/**
 * Regression tests for scripts/review-meeting.sh.
 *
 * This script is shell-driven, so we lock the expected workflow behavior by
 * asserting on the source text.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const SOURCE_PATH = resolve(import.meta.dirname, "../../scripts/review-meeting.sh");
const source = readFileSync(SOURCE_PATH, "utf-8");

describe("review-meeting.sh — review target hardening", () => {
  it("prefers origin/main for branch diff scope", () => {
    expect(source).toContain("refs/remotes/origin/main");
    expect(source).toContain('BASE_REF="origin/main"');
  });

  it("adds explicit review target metadata to the agenda", () => {
    expect(source).toContain("Review target:");
    expect(source).toContain("Target repo:");
    expect(source).toContain("Workspace path:");
    expect(source).toContain("Current branch:");
    expect(source).toContain("Base ref:");
    expect(source).toContain("Head ref:");
  });

  it("includes reviewer self-check instructions and invalid surface guard", () => {
    expect(source).toContain("Reviewer self-check:");
    expect(source).toContain("git rev-parse --show-toplevel");
    expect(source).toContain("git branch --show-current");
    expect(source).toContain("INVALID REVIEW SURFACE");
  });

  it("does not paste the old key-changes diff excerpt into the agenda", () => {
    expect(source).not.toContain("Key changes (first 80 lines):");
    expect(source).not.toContain('head -80');
  });
});
