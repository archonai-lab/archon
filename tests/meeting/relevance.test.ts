import { describe, it, expect } from "vitest";
import {
  buildRelevancePrompt,
  parseRelevanceResponse,
  type BuildRelevancePromptOptions,
} from "../../src/meeting/relevance.js";

// --- buildRelevancePrompt ---

describe("buildRelevancePrompt", () => {
  const baseOpts: BuildRelevancePromptOptions = {
    agentName: "Vex",
    strengths: ["TypeScript", "system design"],
    weaknesses: ["frontend CSS"],
    phase: "discuss",
    contextSummary: "Discussing the new auth system architecture.",
    lastMessage: { agentId: "satra", content: "We should use JWT tokens for auth." },
  };

  it("includes the agent name", () => {
    const prompt = buildRelevancePrompt(baseOpts);
    expect(prompt).toContain("You are Vex.");
  });

  it("includes strengths", () => {
    const prompt = buildRelevancePrompt(baseOpts);
    expect(prompt).toContain("TypeScript, system design");
  });

  it("includes weaknesses", () => {
    const prompt = buildRelevancePrompt(baseOpts);
    expect(prompt).toContain("frontend CSS");
  });

  it("includes the phase in uppercase", () => {
    const prompt = buildRelevancePrompt(baseOpts);
    expect(prompt).toContain("DISCUSS");
  });

  it("includes the context summary", () => {
    const prompt = buildRelevancePrompt(baseOpts);
    expect(prompt).toContain("Discussing the new auth system architecture.");
  });

  it("includes the last message with speaker", () => {
    const prompt = buildRelevancePrompt(baseOpts);
    expect(prompt).toContain("by satra");
    expect(prompt).toContain("We should use JWT tokens for auth.");
  });

  it("includes all three response options", () => {
    const prompt = buildRelevancePrompt(baseOpts);
    expect(prompt).toContain("MUST_SPEAK");
    expect(prompt).toContain("COULD_ADD");
    expect(prompt).toContain("PASS");
  });

  it("uses 'general' when strengths are empty", () => {
    const prompt = buildRelevancePrompt({ ...baseOpts, strengths: [] });
    expect(prompt).toContain("Your expertise: general.");
  });

  it("uses 'none specified' when weaknesses are empty", () => {
    const prompt = buildRelevancePrompt({ ...baseOpts, weaknesses: [] });
    expect(prompt).toContain("Your weaknesses: none specified.");
  });

  it("handles all four phases", () => {
    for (const phase of ["present", "discuss", "decide", "assign"] as const) {
      const prompt = buildRelevancePrompt({ ...baseOpts, phase });
      expect(prompt).toContain(phase.toUpperCase());
    }
  });
});

// --- parseRelevanceResponse ---

describe("parseRelevanceResponse", () => {
  it("parses MUST_SPEAK from the first line", () => {
    const result = parseRelevanceResponse("MUST_SPEAK\nI have critical context.");
    expect(result.level).toBe("must_speak");
    expect(result.reason).toBe("I have critical context.");
  });

  it("parses COULD_ADD from the first line", () => {
    const result = parseRelevanceResponse("COULD_ADD\nI have a minor suggestion.");
    expect(result.level).toBe("could_add");
    expect(result.reason).toBe("I have a minor suggestion.");
  });

  it("parses PASS from the first line", () => {
    const result = parseRelevanceResponse("PASS\nOthers are better suited.");
    expect(result.level).toBe("pass");
    expect(result.reason).toBe("Others are better suited.");
  });

  it("is case-insensitive on the first line", () => {
    expect(parseRelevanceResponse("must_speak").level).toBe("must_speak");
    expect(parseRelevanceResponse("Must_Speak").level).toBe("must_speak");
    expect(parseRelevanceResponse("could_add").level).toBe("could_add");
    expect(parseRelevanceResponse("pass").level).toBe("pass");
  });

  it("handles 'Answer: MUST_SPEAK' format on first line", () => {
    const result = parseRelevanceResponse("Answer: MUST_SPEAK\nReason: My expertise is needed.");
    expect(result.level).toBe("must_speak");
    expect(result.reason).toBe("My expertise is needed.");
  });

  it("extracts reason with Reason: prefix", () => {
    const result = parseRelevanceResponse("COULD_ADD\nReason: I know about this topic.");
    expect(result.level).toBe("could_add");
    expect(result.reason).toBe("I know about this topic.");
  });

  it("extracts reason from second line without prefix", () => {
    const result = parseRelevanceResponse("PASS\nNothing relevant to add here.");
    expect(result.level).toBe("pass");
    expect(result.reason).toBe("Nothing relevant to add here.");
  });

  it("defaults to pass for unrecognized responses", () => {
    const result = parseRelevanceResponse("I'm not sure what to do.");
    expect(result.level).toBe("pass");
  });

  it("defaults to pass for empty response", () => {
    const result = parseRelevanceResponse("");
    expect(result.level).toBe("pass");
  });

  it("returns no reason when only the level is provided", () => {
    const result = parseRelevanceResponse("MUST_SPEAK");
    expect(result.level).toBe("must_speak");
    expect(result.reason).toBeUndefined();
  });

  it("handles response with extra whitespace", () => {
    const result = parseRelevanceResponse("  COULD_ADD  \n  Reason:  I have thoughts.  ");
    expect(result.level).toBe("could_add");
    expect(result.reason).toBe("I have thoughts.");
  });

  it("handles multi-line response and picks Reason: line", () => {
    const result = parseRelevanceResponse(
      "MUST_SPEAK\nSome preamble text.\nReason: The actual reason here."
    );
    expect(result.level).toBe("must_speak");
    expect(result.reason).toBe("The actual reason here.");
  });

  it("prefers Reason: prefix over plain second line", () => {
    const result = parseRelevanceResponse(
      "PASS\nThis is not the reason.\nReason: This is the real reason."
    );
    expect(result.level).toBe("pass");
    expect(result.reason).toBe("This is the real reason.");
  });

  it("handles MUST_SPEAK embedded in a longer first line", () => {
    const result = parseRelevanceResponse("I think MUST_SPEAK because I have context.");
    expect(result.level).toBe("must_speak");
  });
});
