/**
 * Server-side reference implementation for the relevance prompt builder.
 *
 * Builds the prompt sent to agents during relevance checks (meeting.relevance_check)
 * and parses their responses into a structured RelevanceLevel.
 *
 * See PLAN.md §7.3 for the relevance prompt template design.
 */

import type { Phase, RelevanceLevel } from "./types.js";

// --- Prompt builder ---

export interface BuildRelevancePromptOptions {
  agentName: string;
  strengths: string[];
  weaknesses: string[];
  phase: Phase;
  contextSummary: string;
  lastMessage: { agentId: string; content: string };
}

/**
 * Builds the relevance prompt sent to an agent to determine if they should speak.
 *
 * Follows the template from PLAN.md §7.3:
 *   - Agent identity (name, strengths, weaknesses)
 *   - Meeting phase
 *   - Context summary
 *   - Last message
 *   - Response format instructions
 */
export function buildRelevancePrompt(opts: BuildRelevancePromptOptions): string {
  const strengths = opts.strengths.length > 0
    ? opts.strengths.join(", ")
    : "general";
  const weaknesses = opts.weaknesses.length > 0
    ? opts.weaknesses.join(", ")
    : "none specified";

  return `You are ${opts.agentName}. Your expertise: ${strengths}. Your weaknesses: ${weaknesses}.

Meeting phase: ${opts.phase.toUpperCase()}
Meeting context so far: ${opts.contextSummary}
Last message (by ${opts.lastMessage.agentId}): ${opts.lastMessage.content}

Based on your expertise and the current discussion, should you speak?

Respond with EXACTLY one of:
- MUST_SPEAK: Critical info, strong objection, or expertise directly needed
- COULD_ADD: Useful but not essential
- PASS: Nothing to add, or others are better suited

Answer: [MUST_SPEAK|COULD_ADD|PASS]
Reason: [one sentence]`;
}

// --- Response parser ---

export interface ParsedRelevanceResponse {
  level: RelevanceLevel;
  reason?: string;
}

/**
 * Parses an LLM response into a RelevanceLevel.
 *
 * Looks for MUST_SPEAK, COULD_ADD, or PASS in the first line.
 * Extracts an optional reason from subsequent lines or after "Reason:" on any line.
 *
 * Defaults to "pass" if the response cannot be parsed.
 */
export function parseRelevanceResponse(response: string): ParsedRelevanceResponse {
  const lines = response.trim().split("\n");
  if (lines.length === 0) {
    return { level: "pass" };
  }

  const firstLine = lines[0].toUpperCase().trim();

  let level: RelevanceLevel;
  if (firstLine.includes("MUST_SPEAK")) {
    level = "must_speak";
  } else if (firstLine.includes("COULD_ADD")) {
    level = "could_add";
  } else if (firstLine.includes("PASS")) {
    level = "pass";
  } else {
    // Unrecognized response — default to pass
    level = "pass";
  }

  // Extract reason: check for "Reason:" prefix in remaining lines, or use rest of text
  let reason: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const reasonMatch = line.match(/^Reason:\s*(.+)/i);
    if (reasonMatch) {
      reason = reasonMatch[1].trim();
      break;
    }
  }

  // If no "Reason:" prefix found, use the second line as reason (if non-empty)
  if (!reason && lines.length > 1) {
    const secondLine = lines[1].trim();
    if (secondLine.length > 0) {
      reason = secondLine;
    }
  }

  return reason ? { level, reason } : { level };
}
