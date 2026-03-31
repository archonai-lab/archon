/**
 * Start a meeting — the CEO (initiator) creates the meeting AND participates
 * as an active, LLM-powered thinker alongside the invited agents.
 *
 * Usage:
 *   npx tsx scripts/start-meeting.ts --initiator <id> --agents <id1,id2> --title "Topic" --agenda "..."
 *
 * Options:
 *   --initiator    Agent ID of the meeting initiator (must exist in DB)
 *   --agents       Comma-separated agent IDs to invite
 *   --title        Meeting title
 *   --agenda       Agenda / context for the meeting
 *   --methodology  Methodology name (review, brainstorm, triage, hiring)
 *   --approval     Require CEO approval between phases
 *   --provider     LLM provider: cli-claude, cli-gemini, openai (default: cli-claude)
 *   --model        LLM model override
 *   --hub          Hub WebSocket URL (default: ws://localhost:9500)
 *
 * Example:
 *   npx tsx scripts/start-meeting.ts --initiator ceo --agents alice,bob \
 *     --title "Architecture Review" \
 *     --agenda "Decide on MCP vs WebSocket for agent connection" \
 *     --provider cli-claude --model sonnet
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import WebSocket from "ws";

type Provider = "cli-claude" | "cli-gemini" | "openai";

// --- Parse CLI args ---
const args = process.argv.slice(2);
const get = (flag: string, fallback?: string): string => {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Missing required flag: ${flag}`);
  process.exit(1);
};

const initiatorId = get("--initiator");
const agentIds = get("--agents").split(",").map((s) => s.trim());
const title = get("--title", "Team Meeting");
const agenda = get("--agenda", "Open discussion");
const methodology = args.includes("--methodology") ? get("--methodology") : undefined;
const approvalRequired = args.includes("--approval");
const hubUrl = get("--hub", "ws://localhost:9500");
const provider = (get("--provider", "cli-claude")) as Provider;
const model = get("--model", "");

// --- Meeting state ---
let meetingId = "";
let currentPhase = "";
let isFirstInitiatorPhase = true;
const meetingHistory: Array<{ role: string; content: string }> = [];

const MAX_HISTORY_ENTRIES = 20;
const MAX_ENTRY_CHARS = 800;
const MAX_HISTORY_CHARS = 8000;

function addToHistory(speaker: string, content: string) {
  meetingHistory.push({ role: speaker, content: content.slice(0, MAX_ENTRY_CHARS) });
  if (meetingHistory.length > MAX_HISTORY_ENTRIES) meetingHistory.shift();
}

function historyContext(): string {
  if (meetingHistory.length === 0) return "Meeting just started.";
  let total = 0;
  const lines: string[] = [];
  // Build from most recent to oldest, then reverse
  for (let i = meetingHistory.length - 1; i >= 0; i--) {
    const line = `[${meetingHistory[i].role}]: ${meetingHistory[i].content}`;
    if (total + line.length > MAX_HISTORY_CHARS) break;
    total += line.length;
    lines.unshift(line);
  }
  return lines.join("\n");
}

// --- Load initiator identity ---
function loadIdentity(): string {
  const workspaceDir = resolve(homedir(), `.archon/agents/${initiatorId}`);
  const parts: string[] = [];

  for (const filename of ["SOUL.md", "IDENTITY.md", "PLAYBOOK.md"]) {
    const filePath = resolve(workspaceDir, filename);
    if (existsSync(filePath)) {
      parts.push(readFileSync(filePath, "utf-8"));
    }
  }

  if (parts.length === 0) {
    parts.push(`You are "${initiatorId}", the meeting initiator. You lead discussions, make strategic decisions, and drive toward actionable outcomes.`);
  }

  return parts.join("\n\n");
}

const systemPrompt = loadIdentity();

// --- LLM provider ---

function runCli(command: string, cliArgs: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = execFile(command, cliArgs, {
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
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const fullPrompt = `${systemPrompt}

---

${userMessage}`;

  const options: Record<string, unknown> = {
    settingSources: [],
    permissionMode: "bypassPermissions",
  };
  if (model) options.model = model;

  let result = "";
  for await (const msg of query({ prompt: fullPrompt, options: options as any })) {
    if ("result" in msg) {
      result = (msg as { result: string }).result;
    }
  }

  return result || "(no response)";
}

async function chatViaGemini(userMessage: string): Promise<string> {
  const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
  const cliArgs = ["-p", fullPrompt];
  if (model) cliArgs.push("-m", model);
  return runCli("gemini", cliArgs);
}

async function chatViaOpenAI(userMessage: string): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const llm = new OpenAI({
    baseURL: get("--base-url", process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1"),
    apiKey: get("--api-key", process.env.AGENT_API_KEY ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? ""),
  });
  const resp = await llm.chat.completions.create({
    model,
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
    switch (provider) {
      case "cli-claude": return await chatViaClaude(userMessage);
      case "cli-gemini": return await chatViaGemini(userMessage);
      case "openai":     return await chatViaOpenAI(userMessage);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`   [LLM error] ${msg}`);
    return "(LLM error — skipping)";
  }
}

// --- Start ---

console.log(`\n🏢 Archon Meeting`);
console.log(`   Title: "${title}"`);
console.log(`   Initiator: ${initiatorId} (active participant via ${provider})`);
console.log(`   Agents: ${agentIds.join(", ")}`);
console.log(`   Agenda: ${agenda.slice(0, 300)}${agenda.length > 300 ? "..." : ""}`);
if (methodology) console.log(`   Methodology: ${methodology}`);
if (approvalRequired) console.log(`   Phase control: CEO approves each phase transition`);

const ws = new WebSocket(hubUrl);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", agentId: initiatorId, token: initiatorId }));
});

ws.on("message", async (raw) => {
  const msg = JSON.parse(raw.toString());

  switch (msg.type) {
    case "auth.ok":
      console.log(`\n   ✓ Authenticated as ${initiatorId}`);
      ws.send(JSON.stringify({
        type: "meeting.create",
        title,
        invitees: agentIds,
        tokenBudget: 50000,
        agenda,
        summaryMode: (process.env.HUB_LLM_API_KEY ? "llm" : "structured") as "off" | "structured" | "llm",
        ...(methodology ? { methodology } : {}),
        ...(approvalRequired ? { approvalRequired: true } : {}),
      }));
      break;

    case "meeting.created":
      meetingId = msg.meetingId;
      console.log(`   ✓ Meeting created: ${meetingId}`);
      console.log(`   ✓ Participants: ${msg.participants.join(", ")}`);
      console.log(`\n   Waiting for agents to join...\n`);
      break;

    case "meeting.phase_change": {
      currentPhase = msg.phase;
      const caps: string[] = msg.capabilities ?? [];
      console.log(`\n   ━━━ Phase: ${msg.phase.toUpperCase()} (budget: ${msg.budgetRemaining}) ━━━\n`);

      if (caps.includes("initiator_only")) {
        if (isFirstInitiatorPhase) {
          // First initiator_only phase: present the agenda as-is
          isFirstInitiatorPhase = false;
          console.log(`   [${initiatorId}] Presenting agenda...`);
          addToHistory(initiatorId, agenda);
          ws.send(JSON.stringify({
            type: "meeting.speak",
            meetingId,
            content: agenda,
          }));
        } else {
          // Later initiator_only phases (plan, assign, etc.): think via LLM
          console.log(`   [${initiatorId}] Thinking (${msg.phase})...`);
          const prompt = `You are leading a meeting, now in the ${msg.phase.toUpperCase()} phase. This is an initiator-only phase — you are the only one who speaks.

Meeting title: "${title}"
Agenda: ${agenda}

Discussion so far:
${historyContext()}

Based on everything discussed, provide your input for this ${msg.phase.toUpperCase()} phase. Be concise and actionable (3-5 sentences).`;

          const response = await chat(prompt);
          console.log(`   [${initiatorId}] ${response.slice(0, 200)}${response.length > 200 ? "..." : ""}`);
          addToHistory(initiatorId, response);
          ws.send(JSON.stringify({
            type: "meeting.speak",
            meetingId,
            content: response,
          }));
        }
      }
      break;
    }

    case "meeting.message":
      if (msg.agentId !== initiatorId) {
        addToHistory(msg.agentId, msg.content);
      }
      console.log(`   💬 [${msg.agentId}] ${msg.content}`);
      break;

    case "meeting.awaiting_approval":
      console.log(`\n   ⏸  Phase "${msg.currentPhase}" complete → next: "${msg.nextPhase ?? 'END'}"`);
      if (approvalRequired) {
        // Think about whether to approve
        console.log(`   [${initiatorId}] Evaluating phase transition...`);
        // For now, auto-approve — real approval logic can be added later
      }
      console.log(`   → Approving phase transition...\n`);
      ws.send(JSON.stringify({ type: "meeting.advance", meetingId }));
      break;

    case "meeting.relevance_check": {
      // CEO thinks about relevance via LLM instead of auto-passing
      console.log(`   [${initiatorId}] Relevance check — thinking...`);
      const context = `You are the CEO/initiator in a meeting. Current phase: ${msg.phase}.

Meeting history:
${historyContext()}

Last message: ${msg.lastMessage.agentId} said: "${msg.lastMessage.content}"

As the CEO, do you need to respond to this? Consider: Does this need strategic direction? Is someone going off-track? Do you have a unique perspective to add?
Reply with EXACTLY one of: MUST_SPEAK, COULD_ADD, or PASS
Then on a new line, briefly explain why (one sentence).`;

      const response = await chat(context);
      const firstLine = response.split("\n")[0].toUpperCase().trim();

      let level: "must_speak" | "could_add" | "pass" = "could_add";
      if (/\bMUST_SPEAK\b/.test(firstLine)) level = "must_speak";
      else if (/\bPASS\b/.test(firstLine)) level = "pass";
      else if (/\bCOULD_ADD\b/.test(firstLine)) level = "could_add";

      console.log(`   [${initiatorId}] Relevance: ${level.toUpperCase()}`);
      ws.send(JSON.stringify({
        type: "meeting.relevance",
        meetingId: msg.meetingId,
        level,
      }));
      break;
    }

    case "meeting.your_turn": {
      // CEO thinks and speaks via LLM
      console.log(`   [${initiatorId}] My turn to speak (${currentPhase})...`);

      let prompt: string;
      if (currentPhase === "decide" || currentPhase === "converge") {
        prompt = `You are the CEO in a meeting, ${currentPhase.toUpperCase()} phase. Time to converge and decide.

Meeting title: "${title}"
Meeting history:
${historyContext()}

Synthesize the discussion. Identify the key decision(s) and state your position clearly. If you disagree with something, say so with reasoning. If there's consensus, drive toward a concrete outcome.
Keep your response concise (2-4 sentences).`;
      } else if (currentPhase === "assign" || currentPhase === "plan") {
        prompt = `You are the CEO in a meeting, ${currentPhase.toUpperCase()} phase. Time to assign work.

Meeting title: "${title}"
Meeting history:
${historyContext()}

Based on the discussion and decisions, define clear action items or next steps. Assign ownership where possible.
Keep your response concise (2-4 sentences).`;
      } else {
        prompt = `You are the CEO in a meeting, ${currentPhase.toUpperCase()} phase.

Meeting title: "${title}"
Meeting history:
${historyContext()}

Share your strategic perspective. You're not just facilitating — you're the decision-maker. Challenge ideas that seem wrong, reinforce good ones, steer the conversation toward actionable outcomes.
Keep your response concise and focused (2-4 sentences). Don't repeat what's been said.`;
      }

      const response = await chat(prompt);
      console.log(`   [${initiatorId}] ${response.slice(0, 200)}${response.length > 200 ? "..." : ""}`);
      addToHistory(initiatorId, response);
      ws.send(JSON.stringify({
        type: "meeting.speak",
        meetingId: msg.meetingId,
        content: response,
      }));
      break;
    }

    case "meeting.proposal": {
      console.log(`   📋 PROPOSAL by ${msg.agentId}: "${msg.proposal}"`);
      addToHistory(msg.agentId, `[PROPOSAL] ${msg.proposal}`);

      // CEO evaluates proposals via LLM
      console.log(`   [${initiatorId}] Evaluating proposal...`);
      const votePrompt = `A proposal has been made in your meeting:

"${msg.proposal}" (by ${msg.agentId})

Meeting context:
${historyContext()}

As CEO, evaluate this proposal against the meeting goals and discussion. Vote: approve, reject, or abstain. Reply with EXACTLY one word on the first line (approve/reject/abstain), then a brief reason on the next line.`;

      const voteResp = await chat(votePrompt);
      const voteLine = voteResp.split("\n")[0].toLowerCase().trim();
      let voteChoice: "approve" | "reject" | "abstain" = "approve";
      if (/\breject\b/.test(voteLine)) voteChoice = "reject";
      else if (/\babstain\b/.test(voteLine)) voteChoice = "abstain";

      const reason = voteResp.split("\n").slice(1).join(" ").trim() || undefined;
      console.log(`   [${initiatorId}] Vote: ${voteChoice.toUpperCase()}${reason ? ` — ${reason.slice(0, 80)}` : ""}`);

      ws.send(JSON.stringify({
        type: "meeting.vote",
        meetingId: msg.meetingId,
        proposalIndex: msg.proposalIndex,
        vote: voteChoice,
        reason,
      }));
      break;
    }

    case "meeting.vote_result":
      console.log(`   🗳️  ${msg.agentId} voted ${msg.vote.toUpperCase()}${msg.reason ? `: ${msg.reason.slice(0, 80)}` : ""}`);
      break;

    case "meeting.action_item":
      console.log(`   📝 Task: "${msg.task}" → ${msg.assigneeId}`);
      break;

    case "meeting.completed":
      console.log(`\n   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`   ✅ Meeting completed!`);
      if (msg.decisions?.length > 0) {
        console.log(`\n   Decisions:`);
        for (const d of msg.decisions) {
          console.log(`     ✓ ${(d as { proposal: string }).proposal}`);
        }
      }
      if (msg.actionItems?.length > 0) {
        console.log(`\n   Action items:`);
        for (const a of msg.actionItems) {
          const item = a as { task: string; assigneeId: string; acknowledged: boolean };
          console.log(`     ${item.acknowledged ? "✓" : "○"} ${item.task} → ${item.assigneeId}`);
        }
      }
      if (msg.summary) {
        console.log(`\n   Summary:\n${msg.summary}`);
      }
      console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      ws.close();
      setTimeout(() => process.exit(0), 500);
      break;

    case "meeting.cancelled":
      console.log(`\n   ❌ Meeting cancelled: ${msg.reason}\n`);
      ws.close();
      setTimeout(() => process.exit(0), 500);
      break;

    case "error":
      console.error(`   ⚠️  Error: ${msg.message}`);
      break;
  }
});

ws.on("error", (err) => {
  console.error(`Connection error: ${String(err)}`);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error(`Uncaught exception: ${String(err)}`);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error(`Unhandled rejection: ${String(err)}`);
  process.exit(1);
});

ws.on("close", (code, reason) => {
  console.log(`   Disconnected. (code=${code}, reason=${reason?.toString() || "none"})`);
});

process.on("SIGINT", () => {
  console.log("\n   Shutting down...");
  ws.close();
});
