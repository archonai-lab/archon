/**
 * Start a meeting — presents the topic, then auto-advances through phases.
 * Run the agent scripts first so they're online when the meeting starts.
 *
 * Usage:
 *   npx tsx scripts/start-meeting.ts --initiator <id> --agents <id1,id2> --title "Topic" --agenda "..."
 *
 * Example:
 *   npx tsx scripts/start-meeting.ts --initiator ceo --agents alice,bob \
 *     --title "Architecture Review" \
 *     --agenda "Decide on MCP vs WebSocket for agent connection"
 */

import WebSocket from "ws";

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

let meetingId = "";
let currentPhase = "";

console.log(`\n🏢 Archon Meeting`);
console.log(`   Title: "${title}"`);
console.log(`   Initiator: ${initiatorId}`);
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

    case "meeting.phase_change":
      currentPhase = msg.phase;
      console.log(`\n   ━━━ Phase: ${msg.phase.toUpperCase()} (budget: ${msg.budgetRemaining}) ━━━\n`);

      if (msg.phase === "present") {
        // Present the topic
        console.log(`   [${initiatorId}] Presenting: "${agenda.slice(0, 200)}${agenda.length > 200 ? "..." : ""}"`);
        ws.send(JSON.stringify({
          type: "meeting.speak",
          meetingId,
          content: agenda,
        }));
      }
      break;

    case "meeting.message":
      console.log(`   💬 [${msg.agentId}] ${msg.content}`);
      break;

    case "meeting.awaiting_approval":
      console.log(`\n   ⏸  Phase "${msg.currentPhase}" complete → next: "${msg.nextPhase ?? 'END'}"`);
      console.log(`   → Auto-approving phase transition...\n`);
      ws.send(JSON.stringify({ type: "meeting.advance", meetingId }));
      break;

    case "meeting.relevance_check":
      // Initiator passes relevance checks (it's the facilitator)
      ws.send(JSON.stringify({
        type: "meeting.relevance",
        meetingId: msg.meetingId,
        level: "pass",
      }));
      break;

    case "meeting.your_turn":
      // Initiator can facilitate if given a turn
      if (currentPhase === "discuss") {
        // Pass the turn back by speaking briefly
        ws.send(JSON.stringify({
          type: "meeting.speak",
          meetingId: msg.meetingId,
          content: "Let's continue the discussion. Any other thoughts?",
        }));
      }
      break;

    case "meeting.proposal":
      console.log(`   📋 PROPOSAL by ${msg.agentId}: "${msg.proposal}"`);
      // Initiator auto-approves
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: "meeting.vote",
          meetingId: msg.meetingId,
          proposalIndex: msg.proposalIndex,
          vote: "approve",
          reason: "Sounds good",
        }));
      }, 500);
      break;

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
