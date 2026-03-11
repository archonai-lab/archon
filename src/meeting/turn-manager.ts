import type { RelevanceLevel } from "./types.js";
import { logger } from "../utils/logger.js";

const RELEVANCE_TIMEOUT_MS = 120_000; // 2 min — CLI tools (claude, gemini) can be slow

interface RelevanceResponse {
  agentId: string;
  level: RelevanceLevel;
  receivedAt: number;
}

/**
 * Collects relevance responses from meeting participants and determines
 * speaking order: MUST_SPEAK first (by response time), then COULD_ADD.
 * If ALL agents PASS → returns empty queue (signals phase auto-advance).
 */
export class TurnManager {
  private expected = new Set<string>();
  private responses: RelevanceResponse[] = [];
  private resolveWait: ((queue: string[]) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Start collecting relevance from a set of participant agent IDs.
   * Returns a promise that resolves with the ordered speaking queue.
   */
  collect(participantIds: string[]): Promise<string[]> {
    this.reset();
    for (const id of participantIds) {
      this.expected.add(id);
    }

    return new Promise<string[]>((resolve) => {
      this.resolveWait = resolve;

      // Timeout: treat non-respondents as PASS
      this.timer = setTimeout(() => {
        logger.warn(
          { missing: [...this.expected] },
          "Relevance timeout — treating non-respondents as PASS"
        );
        this.finalize();
      }, RELEVANCE_TIMEOUT_MS);
    });
  }

  /**
   * Record a relevance response from an agent.
   */
  addResponse(agentId: string, level: RelevanceLevel): void {
    if (!this.expected.has(agentId)) return; // not expected

    this.expected.delete(agentId);
    this.responses.push({ agentId, level, receivedAt: Date.now() });

    // All responses collected → finalize early
    if (this.expected.size === 0) {
      this.finalize();
    }
  }

  private finalize(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const queue = buildSpeakingQueue(this.responses);
    this.resolveWait?.(queue);
    this.resolveWait = null;
  }

  private reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.expected.clear();
    this.responses = [];
    this.resolveWait = null;
    this.timer = null;
  }
}

/**
 * Build ordered speaking queue:
 * 1. MUST_SPEAK agents, sorted by response time (fastest first)
 * 2. COULD_ADD agents, sorted by response time
 * PASS agents are excluded.
 * Empty queue = all passed → phase should auto-advance.
 */
function buildSpeakingQueue(responses: RelevanceResponse[]): string[] {
  const mustSpeak = responses
    .filter((r) => r.level === "must_speak")
    .sort((a, b) => a.receivedAt - b.receivedAt);

  const couldAdd = responses
    .filter((r) => r.level === "could_add")
    .sort((a, b) => a.receivedAt - b.receivedAt);

  return [...mustSpeak.map((r) => r.agentId), ...couldAdd.map((r) => r.agentId)];
}
