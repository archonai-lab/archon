import { describe, it, expect } from "vitest";
import { countTokens } from "../../src/meeting/token-counter.js";

describe("Token Counter", () => {
  it("should count tokens at ~4 chars per token", () => {
    expect(countTokens("hello")).toBe(2); // 5 chars → ceil(5/4) = 2
    expect(countTokens("a".repeat(100))).toBe(25);
    expect(countTokens("a".repeat(7))).toBe(2); // ceil(7/4) = 2
  });

  it("should return 0 for empty or falsy input", () => {
    expect(countTokens("")).toBe(0);
  });

  it("should handle single character", () => {
    expect(countTokens("a")).toBe(1);
  });
});
