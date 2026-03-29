import { describe, it, expect } from "vitest";
import {
  contextGet,
  meetingJoin,
  statusReport,
} from "../../src/mcp/tools/stubs.js";

describe("stub tools", () => {
  it("contextGet returns isError: true", () => {
    const result = contextGet();
    expect(result.isError).toBe(true);
  });

  it("meetingJoin returns isError: true", () => {
    const result = meetingJoin();
    expect(result.isError).toBe(true);
  });

  it("statusReport returns isError: true", () => {
    const result = statusReport();
    expect(result.isError).toBe(true);
  });
});
