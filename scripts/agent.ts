/**
 * Minimal agent runner — connects to the hub and participates in meetings using an LLM.
 *
 * Usage:
 *   npx tsx scripts/agent.ts --id <agentId> --provider <provider> [options]
 *
 * Options:
 *   --id         Agent ID (must exist in DB)
 *   --provider   LLM provider: cli-claude, cli-gemini, or openai (default: openai)
 *   --model      Model name (for openai provider, or override CLI model)
 *   --base-url   API base URL (openai provider only)
 *   --api-key    API key (openai provider only)
 *   --hub        Hub WebSocket URL (default: ws://localhost:9500)
 *   --persona    Optional persona description for the agent
 *
 * Examples:
 *   # Claude Code CLI (uses your existing auth):
 *   npx tsx scripts/agent.ts --id alice --provider cli-claude
 *
 *   # Gemini CLI (uses your existing auth):
 *   npx tsx scripts/agent.ts --id bob --provider cli-gemini
 *
 *   # Via OpenRouter (any model):
 *   npx tsx scripts/agent.ts --id alice --provider openai --model anthropic/claude-sonnet-4
 *
 *   # Via Ollama (free, local):
 *   npx tsx scripts/agent.ts --id alice --provider openai --model llama3.1 --base-url http://localhost:11434/v1 --api-key unused
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import { AgentClient } from "../src/agent/client.js";

type Provider = "cli-claude" | "cli-gemini" | "openai";

// --- Parse CLI args ---
function parseArgs(): {
  id: string;
  provider: Provider;
  model: string;
  baseUrl: string;
  apiKey: string;
  hub: string;
  persona: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string => {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
    if (fallback !== undefined) return fallback;
    console.error(`Missing required flag: ${flag}`);
    process.exit(1);
  };

  const provider = get("--provider", "openai") as Provider;
  if (!["cli-claude", "cli-gemini", "openai"].includes(provider)) {
    console.error(`Invalid provider: ${provider}. Use: cli-claude, cli-gemini, openai`);
    process.exit(1);
  }

  return {
    id: get("--id"),
    provider,
    model: get("--model", ""),
    baseUrl: get("--base-url", process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1"),
    apiKey: get("--api-key", process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? ""),
    hub: get("--hub", "ws://localhost:9500"),
    persona: get("--persona", ""),
  };
}

const config = parseArgs();

// --- Load identity files if available ---
function loadIdentity(): string {
  const workspaceDir = resolve(homedir(), `.archon/agents/${config.id}`);
  const repoDir = resolve(process.cwd(), `agents/${config.id}`);

  let parts: string[] = [];

  for (const dir of [workspaceDir, repoDir]) {
    const soulPath = resolve(dir, "SOUL.md");
    const identityPath = resolve(dir, "IDENTITY.md");
    const playbookPath = resolve(dir, "PLAYBOOK.md");

    const hasIdentity = existsSync(soulPath) || existsSync(identityPath) || existsSync(playbookPath);
    if (!hasIdentity) continue;

    if (existsSync(soulPath)) {
      parts.push(readFileSync(soulPath, "utf-8"));
    }
    if (existsSync(identityPath)) {
      parts.push(readFileSync(identityPath, "utf-8"));
    }
    if (existsSync(playbookPath)) {
      parts.push(readFileSync(playbookPath, "utf-8"));
    }
    break; // use first directory that has any identity files
  }

  if (config.persona) {
    parts.push(config.persona);
  }

  if (parts.length === 0) {
    parts.push(`You are agent "${config.id}". You are a helpful, thoughtful team member participating in a meeting.`);
  }

  return parts.join("\n\n");
}

const systemPrompt = loadIdentity();

// --- LLM provider ---

function runCli(command: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Remove CLAUDECODE env var to allow nested Claude Code sessions
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = execFile(command, args, {
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
      env,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${command} failed: ${err.message}\nSTDERR: ${stderr}\nSTDOUT: ${stdout}`));
      } else {
        resolve(stdout.trim());
      }
    });

    if (stdin && proc.stdin) {
      proc.stdin.write(stdin);
      proc.stdin.end();
    }
  });
}

async function chatViaClaude(userMessage: string): Promise<string> {
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
  // Use --print + stdin (not -p) to avoid hanging in nested sessions.
  // Pattern from Claw-Empire: prompt via stdin, --print for non-interactive output.
  const args = [
    "--print",
    "--no-session-persistence",
    "--dangerously-skip-permissions",
  ];
  if (config.model) {
    args.push("--model", config.model);
  }
  return runCli("claude", args, fullPrompt);
}

async function chatViaGemini(userMessage: string): Promise<string> {
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
  const args = [
    "-p", fullPrompt,
  ];
  if (config.model) {
    args.push("-m", config.model);
  }
  return runCli("gemini", args);
}

async function chatViaOpenAI(userMessage: string): Promise<string> {
  // Lazy-load OpenAI SDK only when needed
  const { default: OpenAI } = await import("openai");
  const llm = new OpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey });
  const resp = await llm.chat.completions.create({
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: 500,
    temperature: 0.7,
  });
  return resp.choices[0]?.message?.content?.trim() ?? "(no response)";
}

async function chat(userMessage: string): Promise<string> {
  try {
    switch (config.provider) {
      case "cli-claude": return await chatViaClaude(userMessage);
      case "cli-gemini": return await chatViaGemini(userMessage);
      case "openai":     return await chatViaOpenAI(userMessage);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [LLM error] ${msg}`);
    return "(LLM error — skipping)";
  }
}

// --- Meeting state ---
let currentMeetingId: string | null = null;
const meetingHistory: Array<{ role: string; content: string }> = [];

function addToHistory(speaker: string, content: string) {
  meetingHistory.push({ role: speaker, content });
  // Keep last 20 messages for context
  if (meetingHistory.length > 20) meetingHistory.shift();
}

function historyContext(): string {
  if (meetingHistory.length === 0) return "Meeting just started.";
  return meetingHistory
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n");
}

// --- AgentClient setup ---
const client = new AgentClient({
  agentId: config.id,
  hubUrl: config.hub,
});

client.on("connected", () => {
  console.log(`[${config.id}] Authenticated ✓`);
  console.log(`[${config.id}] Provider: ${config.provider}${config.model ? ` (${config.model})` : ""}`);
  console.log(`[${config.id}] Waiting for meeting invites...`);
});

client.on("auth.ok", (msg) => {
  if (msg.pendingInvites?.length > 0) {
    for (const meetingId of msg.pendingInvites) {
      console.log(`[${config.id}] Auto-joining pending meeting: ${meetingId}`);
      client.joinMeeting(meetingId);
      currentMeetingId = meetingId;
    }
  }
});

client.on("hub.error", (msg) => {
  if (msg.code === "AUTH_FAILED") {
    console.error(`[${config.id}] Auth failed: ${msg.message}`);
    process.exit(1);
  }
  console.error(`[${config.id}] Error: ${msg.message}`);
});

client.on("error", (err) => {
  console.error(`[${config.id}] WebSocket error: ${err.message}`);
  process.exit(1);
});

client.on("disconnected", (code, reason) => {
  console.log(`[${config.id}] Disconnected (${code}: ${reason})`);
  // If reconnect is enabled (default), the client will auto-reconnect.
  // Otherwise, exit.
  if (!client.connected) {
    process.exit(0);
  }
});

// --- Meeting event handlers ---

client.on("meeting.invite", (msg) => {
  console.log(`[${config.id}] Invited to "${msg.title}" by ${msg.initiator}`);
  if (msg.agenda) console.log(`[${config.id}] Agenda: ${msg.agenda}`);
  client.joinMeeting(msg.meetingId);
  currentMeetingId = msg.meetingId;
});

client.on("meeting.phase_change", (msg) => {
  console.log(`[${config.id}] Phase → ${msg.phase.toUpperCase()} (budget: ${msg.budgetRemaining})`);
});

client.on("meeting.message", (msg) => {
  addToHistory(msg.agentId, msg.content);
  if (msg.agentId !== config.id) {
    console.log(`[${config.id}] ${msg.agentId} says: "${msg.content.slice(0, 120)}${msg.content.length > 120 ? "..." : ""}"`);
  }
});

client.on("meeting.relevance_check", async (msg) => {
  console.log(`[${config.id}] Relevance check — thinking...`);
  const context = `You are in a meeting. Current phase: ${msg.phase}.

Meeting history:
${historyContext()}

Last message: ${msg.lastMessage.agentId} said: "${msg.lastMessage.content}"

Based on your expertise and the discussion so far, how relevant is this to you?
Reply with EXACTLY one of: MUST_SPEAK, COULD_ADD, or PASS
Then on a new line, briefly explain why (one sentence).`;

  const response = await chat(context);
  const firstLine = response.split("\n")[0].toUpperCase().trim();

  let level: "must_speak" | "could_add" | "pass" = "could_add";
  if (firstLine.includes("MUST_SPEAK")) level = "must_speak";
  else if (firstLine.includes("PASS")) level = "pass";
  else if (firstLine.includes("COULD_ADD")) level = "could_add";

  console.log(`[${config.id}] Relevance: ${level.toUpperCase()}`);
  client.sendRelevance(msg.meetingId, level);
});

client.on("meeting.your_turn", async (msg) => {
  console.log(`[${config.id}] My turn to speak (phase: ${msg.phase})...`);

  let prompt: string;
  if (msg.phase === "decide") {
    prompt = `You are in a meeting, DECIDE phase. Time to make decisions.

Meeting history:
${historyContext()}

If there are proposals to vote on, share your perspective. Otherwise, propose a concrete decision based on the discussion.
Keep your response concise (2-4 sentences).`;
  } else if (msg.phase === "assign") {
    prompt = `You are in a meeting, ASSIGN phase. Tasks are being assigned.

Meeting history:
${historyContext()}

Suggest a specific action item or acknowledge any assignments. Keep it brief (1-2 sentences).`;
  } else {
    prompt = `You are in a meeting, ${msg.phase.toUpperCase()} phase.

Meeting history:
${historyContext()}

Share your perspective. Build on what others said, offer new insights, or respectfully disagree.
Keep your response concise and focused (2-4 sentences). Don't repeat what's been said.`;
  }

  const response = await chat(prompt);
  console.log(`[${config.id}] Speaking: "${response.slice(0, 120)}${response.length > 120 ? "..." : ""}"`);
  addToHistory(config.id, response);
  client.speak(msg.meetingId, response);
});

client.on("meeting.proposal", async (msg) => {
  console.log(`[${config.id}] Proposal by ${msg.agentId}: "${msg.proposal.slice(0, 100)}..."`);
  addToHistory(msg.agentId, `[PROPOSAL] ${msg.proposal}`);

  // Auto-vote after thinking
  const votePrompt = `A proposal has been made in the meeting:

"${msg.proposal}"

Meeting context:
${historyContext()}

Vote: approve, reject, or abstain. Reply with EXACTLY one word on the first line (approve/reject/abstain), then a brief reason on the next line.`;

  const voteResp = await chat(votePrompt);
  const voteLine = voteResp.split("\n")[0].toLowerCase().trim();
  let voteChoice: "approve" | "reject" | "abstain" = "approve";
  if (voteLine.includes("reject")) voteChoice = "reject";
  else if (voteLine.includes("abstain")) voteChoice = "abstain";

  const reason = voteResp.split("\n").slice(1).join(" ").trim() || undefined;

  console.log(`[${config.id}] Vote: ${voteChoice.toUpperCase()}${reason ? ` — ${reason.slice(0, 80)}` : ""}`);
  client.vote(msg.meetingId, msg.proposalIndex, voteChoice, reason);
});

client.on("meeting.vote_result", (msg) => {
  if (msg.agentId !== config.id) {
    console.log(`[${config.id}] ${msg.agentId} voted ${msg.vote.toUpperCase()}${msg.reason ? `: ${msg.reason.slice(0, 60)}` : ""}`);
  }
});

client.on("meeting.action_item", (msg) => {
  console.log(`[${config.id}] Task assigned: "${msg.task}" → ${msg.assigneeId}${msg.deadline ? ` (deadline: ${msg.deadline})` : ""}`);
  if (msg.assigneeId === config.id) {
    console.log(`[${config.id}] Acknowledging task...`);
    client.acknowledge(msg.meetingId, msg.taskIndex);
  }
});

client.on("meeting.completed", (msg) => {
  console.log(`[${config.id}] Meeting completed! Decisions: ${msg.decisions?.length ?? 0}, Action items: ${msg.actionItems?.length ?? 0}`);
  setTimeout(() => process.exit(0), 1000);
});

client.on("meeting.cancelled", (msg) => {
  console.log(`[${config.id}] Meeting cancelled: ${msg.reason}`);
  setTimeout(() => process.exit(0), 1000);
});

// --- Connect and go ---
console.log(`[${config.id}] Connecting to hub...`);
client.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log(`\n[${config.id}] Shutting down...`);
  client.disconnect();
});
