import { describe, it, expect } from "vitest";
import { nextPhase, isValidPhase, phaseIndex, PHASES } from "../../src/meeting/phases.js";

describe("Phase State Machine", () => {
  it("should follow PRESENT → DISCUSS → DECIDE → ASSIGN → completed", () => {
    expect(nextPhase("present")).toBe("discuss");
    expect(nextPhase("discuss")).toBe("decide");
    expect(nextPhase("decide")).toBe("assign");
    expect(nextPhase("assign")).toBe("completed");
  });

  it("should validate phase strings", () => {
    expect(isValidPhase("present")).toBe(true);
    expect(isValidPhase("discuss")).toBe(true);
    expect(isValidPhase("decide")).toBe(true);
    expect(isValidPhase("assign")).toBe(true);
    expect(isValidPhase("invalid")).toBe(false);
    expect(isValidPhase("")).toBe(false);
  });

  it("should return correct phase indices", () => {
    expect(phaseIndex("present")).toBe(0);
    expect(phaseIndex("discuss")).toBe(1);
    expect(phaseIndex("decide")).toBe(2);
    expect(phaseIndex("assign")).toBe(3);
  });

  it("should export all phases in order", () => {
    expect(PHASES).toEqual(["present", "discuss", "decide", "assign"]);
  });
});
