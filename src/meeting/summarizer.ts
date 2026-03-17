import OpenAI from "openai";
import { logger } from "../utils/logger.js";

export type SummaryMode = "off" | "structured" | "llm";

export interface LLMConfig {
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
}

const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Validate a base URL at startup. Non-HTTPS custom URLs are rejected
 * to prevent sending API keys in plaintext. Returns the validated URL
 * or the default if the custom URL is invalid.
 */
export function validateLLMBaseUrl(url: string | undefined): string {
  const resolved = url || DEFAULT_LLM_BASE_URL;
  if (!resolved.startsWith("https://")) {
    logger.warn(
      { providedUrl: resolved },
      "HUB_LLM_BASE_URL must use HTTPS — falling back to default"
    );
    return DEFAULT_LLM_BASE_URL;
  }
  return resolved;
}

/** Runtime LLM config — initialized from env vars, changeable via config.set. */
const llmConfig: LLMConfig = {
  llmApiKey: process.env.HUB_LLM_API_KEY ?? "",
  llmBaseUrl: validateLLMBaseUrl(process.env.HUB_LLM_BASE_URL),
  llmModel: process.env.HUB_LLM_MODEL || "anthropic/claude-sonnet-4",
};

/** Get the current LLM config (read-only copy). */
export function getLLMConfig(): Readonly<LLMConfig> {
  return { ...llmConfig };
}

/** Update a single LLM config key at runtime. Returns error string if invalid, null if ok. */
export function setLLMConfig(key: string, value: unknown): string | null {
  switch (key) {
    case "llmApiKey":
      llmConfig.llmApiKey = String(value ?? "");
      logger.info("LLM API key updated");
      return null;
    case "llmBaseUrl": {
      const url = String(value || "https://openrouter.ai/api/v1");
      // Security: only allow HTTPS URLs to prevent transcript exfiltration
      if (!url.startsWith("https://")) {
        return "llmBaseUrl must use HTTPS";
      }
      llmConfig.llmBaseUrl = url;
      logger.info({ llmBaseUrl: llmConfig.llmBaseUrl }, "LLM base URL updated");
      return null;
    }
    case "llmModel":
      llmConfig.llmModel = String(value || "anthropic/claude-sonnet-4");
      logger.info({ llmModel: llmConfig.llmModel }, "LLM model updated");
      return null;
    default:
      return `Unknown config key: ${key}`;
  }
}

/** Check if LLM summary is available (API key is configured). */
export function isLLMAvailable(): boolean {
  return !!llmConfig.llmApiKey;
}

// --- Summary generation ---

interface SummaryInput {
  title: string;
  agenda?: string;
  participants: string[];
  messages: Array<{ agentId: string; phase: string; content: string }>;
  decisions: Array<{ proposal: string; proposedBy: string }>;
  actionItems: Array<{ task: string; assigneeId: string; deadline?: string }>;
  tokensUsed: number;
  methodology: string;
}

/**
 * Generate a meeting summary for the given mode.
 * Returns null if mode is "off".
 */
export async function generateMeetingSummary(mode: SummaryMode, input: SummaryInput): Promise<string | null> {
  if (mode === "off") return null;

  if (mode === "llm") {
    if (!llmConfig.llmApiKey) {
      logger.warn("Meeting requested LLM summary but no API key configured, falling back to structured");
      return generateStructuredSummary(input);
    }
    try {
      return await generateLLMSummary(input);
    } catch (err) {
      logger.warn({ error: (err as Error).message }, "LLM summary failed, falling back to structured summary");
      return generateStructuredSummary(input);
    }
  }

  return generateStructuredSummary(input);
}

async function generateLLMSummary(input: SummaryInput): Promise<string> {
  const client = new OpenAI({ apiKey: llmConfig.llmApiKey, baseURL: llmConfig.llmBaseUrl });

  const transcript = input.messages
    .map((m) => `[${m.phase}] ${m.agentId}: ${m.content}`)
    .join("\n");

  const prompt = `Summarize this meeting concisely. Include: key discussion points, decisions made, and action items assigned.

Meeting: ${input.title}
${input.agenda ? `Agenda: ${input.agenda}` : ""}
Participants: ${input.participants.join(", ")}
Methodology: ${input.methodology}

Transcript:
${transcript}

${input.decisions.length > 0 ? `\nApproved Decisions:\n${input.decisions.map((d, i) => `${i + 1}. ${d.proposal} (proposed by ${d.proposedBy})`).join("\n")}` : ""}

${input.actionItems.length > 0 ? `\nAction Items:\n${input.actionItems.map((a, i) => `${i + 1}. ${a.task} → ${a.assigneeId}${a.deadline ? ` (due: ${a.deadline})` : ""}`).join("\n")}` : ""}

Write a concise summary (3-5 paragraphs). Start with a one-sentence overview, then cover key points discussed, decisions, and next steps.`;

  const response = await client.chat.completions.create({
    model: llmConfig.llmModel,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1000,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty LLM response");
  return content;
}

function generateStructuredSummary(input: SummaryInput): string {
  const lines: string[] = [];

  lines.push(`# Meeting Summary: ${input.title}`);
  lines.push("");
  if (input.agenda) {
    lines.push(`**Agenda:** ${input.agenda}`);
    lines.push("");
  }
  lines.push(`**Participants:** ${input.participants.join(", ")}`);
  lines.push(`**Tokens used:** ${input.tokensUsed.toLocaleString()}`);
  lines.push("");

  const phases = [...new Set(input.messages.map((m) => m.phase))];
  if (phases.length > 0) {
    lines.push("## Discussion");
    for (const phase of phases) {
      const phaseMessages = input.messages.filter((m) => m.phase === phase);
      if (phaseMessages.length === 0) continue;
      lines.push(`\n### ${phase.charAt(0).toUpperCase() + phase.slice(1)} Phase`);
      lines.push(`${phaseMessages.length} message(s) exchanged.`);
      const seen = new Set<string>();
      for (const m of phaseMessages) {
        if (seen.has(m.agentId)) continue;
        seen.add(m.agentId);
        const preview = m.content.length > 150 ? m.content.slice(0, 150) + "..." : m.content;
        lines.push(`- **${m.agentId}:** ${preview}`);
      }
    }
    lines.push("");
  }

  if (input.decisions.length > 0) {
    lines.push("## Decisions");
    for (const d of input.decisions) {
      lines.push(`- ${d.proposal} *(proposed by ${d.proposedBy})*`);
    }
    lines.push("");
  }

  if (input.actionItems.length > 0) {
    lines.push("## Action Items");
    for (const a of input.actionItems) {
      const deadline = a.deadline ? ` (due: ${a.deadline})` : "";
      lines.push(`- [ ] ${a.task} → **${a.assigneeId}**${deadline}`);
    }
    lines.push("");
  }

  if (input.decisions.length === 0 && input.actionItems.length === 0) {
    lines.push("*No formal decisions or action items were recorded.*");
    lines.push("");
  }

  return lines.join("\n");
}
