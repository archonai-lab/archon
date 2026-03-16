/**
 * Simple token counter.
 *
 * For MVP we use a character-based heuristic (~4 chars per token).
 * A safety margin is applied because chars/4 underestimates real
 * tokenization by 30-50% on code-heavy or structured text.
 * TODO: Replace with tiktoken for accurate counting when needed.
 */

const CHARS_PER_TOKEN = 4;

/**
 * Safety margin multiplier for budget calculations.
 * chars/4 underestimates real token counts — this compensates.
 * Remove when tiktoken is integrated.
 */
export const TOKEN_SAFETY_MARGIN = 0.6;

export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
