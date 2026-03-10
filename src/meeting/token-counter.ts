/**
 * Simple token counter.
 *
 * For MVP we use a character-based heuristic (~4 chars per token).
 * TODO: Replace with tiktoken for accurate counting when needed.
 */

const CHARS_PER_TOKEN = 4;

export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
