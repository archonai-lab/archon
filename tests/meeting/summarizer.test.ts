import { describe, it, expect } from "vitest";
import { validateLLMBaseUrl } from "../../src/meeting/summarizer.js";

describe("validateLLMBaseUrl", () => {
  it("should accept HTTPS URLs", () => {
    expect(validateLLMBaseUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1"
    );
  });

  it("should reject HTTP URLs and fall back to default", () => {
    expect(validateLLMBaseUrl("http://api.example.com/v1")).toBe(
      "https://openrouter.ai/api/v1"
    );
  });

  it("should return default when undefined", () => {
    expect(validateLLMBaseUrl(undefined)).toBe(
      "https://openrouter.ai/api/v1"
    );
  });

  it("should return default when empty string", () => {
    expect(validateLLMBaseUrl("")).toBe("https://openrouter.ai/api/v1");
  });
});
