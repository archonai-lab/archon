/**
 * Demo: Run a meeting between CEO, Alice, and Bob.
 *
 * Prerequisites:
 *   docker compose up -d
 *   npm run db:seed
 *   npm run dev          (in another terminal)
 *
 * Then run:
 *   npx tsx scripts/demo-meeting.ts
 */

import WebSocket from "ws";

const HUB_URL = process.env.HUB_URL ?? "ws://localhost:9500";

interface Agent {
  id: string;
  ws: WebSocket;
  messages: unknown[];
}

function connect(agentId: string): Promise<Agent> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB_URL);
    const agent: Agent = { id: agentId, ws, messages: [] };

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth", agentId, token: agentId }));
    });

    const authHandler = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "auth.ok") {
        ws.off("message", authHandler);
        // Buffer any future messages
        ws.on("message", (raw2: WebSocket.RawData) => {
          agent.messages.push(JSON.parse(raw2.toString()));
        });
        console.log(`  ✓ ${agentId} connected`);
        resolve(agent);
      } else if (msg.type === "auth.error") {
        reject(new Error(`Auth failed for ${agentId}: ${msg.message}`));
      }
    };

    ws.on("message", authHandler);
    ws.on("error", (err) => reject(new Error(`WebSocket error for ${agentId}: ${err.message}`)));
  });
}

function send(agent: Agent, msg: Record<string, unknown>): void {
  agent.ws.send(JSON.stringify(msg));
}

function waitForMessage(agent: Agent, type: string, timeout = 5000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    // Check already received (drain from buffer)
    const idx = agent.messages.findIndex((m) => (m as { type: string }).type === type);
    if (idx !== -1) {
      const existing = agent.messages.splice(idx, 1)[0];
      return resolve(existing as Record<string, unknown>);
    }

    const timer = setTimeout(() => {
      agent.ws.off("message", handler);
      reject(new Error(`Timeout waiting for ${type} from ${agent.id}`));
    }, timeout);

    const handler = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        agent.ws.off("message", handler);
        resolve(msg);
      } else {
        // Buffer other messages
        agent.messages.push(msg);
      }
    };
    agent.ws.on("message", handler);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("\n🏢 Archon Meeting Demo\n");
  console.log("Connecting agents...");

  const ceo = await connect("ceo");
  const alice = await connect("alice");
  const bob = await connect("bob");

  // === STEP 1: CEO creates a meeting ===
  console.log("\n📋 CEO creates a meeting: 'Architecture Review'");
  send(ceo, {
    type: "meeting.create",
    title: "Architecture Review",
    invitees: ["alice", "bob"],
    tokenBudget: 50000,
    agenda: "Review the new hub architecture and decide on MCP vs WebSocket for agent connection.",
  });

  const created = await waitForMessage(ceo, "meeting.created");
  const meetingId = created.meetingId as string;
  console.log(`  ✓ Meeting created: ${meetingId}`);

  // Alice and Bob get invites
  const aliceInvite = await waitForMessage(alice, "meeting.invite");
  const bobInvite = await waitForMessage(bob, "meeting.invite");
  console.log(`  ✓ Alice invited: "${(aliceInvite as { title: string }).title}"`);
  console.log(`  ✓ Bob invited: "${(bobInvite as { title: string }).title}"`);

  // === STEP 2: Everyone joins ===
  console.log("\n👥 Agents joining meeting...");
  send(alice, { type: "meeting.join", meetingId });
  send(bob, { type: "meeting.join", meetingId });
  await sleep(200);
  console.log("  ✓ All agents joined");

  // Wait for phase change (all joined → PRESENT phase broadcast)
  const phasePresent = await waitForMessage(ceo, "meeting.phase_change");
  console.log(`  Phase: ${(phasePresent as { phase: string }).phase.toUpperCase()}`);

  // === STEP 3: PRESENT — CEO presents the topic ===
  console.log("\n🎤 PRESENT PHASE — CEO presents");
  send(ceo, {
    type: "meeting.speak",
    meetingId,
    content: "We need to decide how agents connect to the hub. Option A: MCP server with polling. Option B: Direct WebSocket. Option C: Both with MCP as default. Thoughts?",
  });

  const ceoMsg = await waitForMessage(alice, "meeting.message");
  console.log(`  CEO: "${(ceoMsg as { content: string }).content.slice(0, 80)}..."`);
  console.log(`  Tokens used: ${(ceoMsg as { tokenCount: number }).tokenCount}, Budget remaining: ${(ceoMsg as { budgetRemaining: number }).budgetRemaining}`);

  // === STEP 4: CEO advances to DISCUSS ===
  console.log("\n💬 CEO advances to DISCUSS...");
  send(ceo, { type: "meeting.advance", meetingId });

  // Drain phase_change messages until we see DISCUSS
  let phase = "";
  while (phase !== "discuss") {
    const pc = await waitForMessage(ceo, "meeting.phase_change", 5000);
    phase = (pc as { phase: string }).phase;
  }
  console.log(`  Phase: ${phase.toUpperCase()}`);

  // Wait for relevance checks from the hub
  await waitForMessage(alice, "meeting.relevance_check", 12000);
  await waitForMessage(bob, "meeting.relevance_check", 12000);
  console.log("  Relevance checks received");

  // Alice must speak, Bob could add
  send(alice, { type: "meeting.relevance", meetingId, level: "must_speak", reason: "Strong opinions" });
  send(bob, { type: "meeting.relevance", meetingId, level: "could_add" });

  // Alice gets her turn first (MUST_SPEAK)
  await waitForMessage(alice, "meeting.your_turn", 5000);
  console.log("  Alice's turn!");

  send(alice, {
    type: "meeting.speak",
    meetingId,
    content: "I think Option C is the way to go. MCP for plug-and-play — any agent adds 3 lines and they're in. WebSocket for our built-in agent and power users who want real-time control.",
  });
  await sleep(200);
  console.log('  Alice: "Option C — MCP for plug-and-play, WebSocket for power users."');

  // After Alice speaks, new relevance round starts.
  // CEO and Bob get relevance checks (Alice excluded as last speaker).
  await waitForMessage(bob, "meeting.relevance_check", 12000);
  await waitForMessage(ceo, "meeting.relevance_check", 12000);
  send(bob, { type: "meeting.relevance", meetingId, level: "must_speak" });
  send(ceo, { type: "meeting.relevance", meetingId, level: "pass" });
  await waitForMessage(bob, "meeting.your_turn", 5000);
  console.log("  Bob's turn!");

  send(bob, {
    type: "meeting.speak",
    meetingId,
    content: "Agreed on Option C. Zero friction for existing Claude Code and Codex users.",
  });
  await sleep(200);
  console.log('  Bob: "Agreed. Zero friction for Claude Code and Codex users."');

  // === STEP 5: CEO advances to DECIDE ===
  console.log("\n🗳️  CEO advances to DECIDE...");
  send(ceo, { type: "meeting.advance", meetingId });

  // Drain until we see DECIDE
  phase = "";
  while (phase !== "decide") {
    const pc = await waitForMessage(ceo, "meeting.phase_change", 5000);
    phase = (pc as { phase: string }).phase;
  }
  console.log(`  Phase: ${phase.toUpperCase()}`);

  console.log("\n  Alice proposes...");
  send(alice, {
    type: "meeting.propose",
    meetingId,
    proposal: "Use hybrid approach: MCP as default connection method, WebSocket SDK for advanced use. Built-in agent uses WebSocket directly.",
  });

  const proposal = await waitForMessage(bob, "meeting.proposal");
  console.log(`  Proposal: "${(proposal as { proposal: string }).proposal.slice(0, 80)}..."`);

  // Vote
  console.log("\n  Voting...");
  send(ceo, { type: "meeting.vote", meetingId, proposalIndex: 0, vote: "approve", reason: "Clean separation" });
  send(alice, { type: "meeting.vote", meetingId, proposalIndex: 0, vote: "approve" });
  send(bob, { type: "meeting.vote", meetingId, proposalIndex: 0, vote: "approve", reason: "Makes sense" });

  await sleep(500);

  // All voted → auto-advances to ASSIGN
  phase = "";
  while (phase !== "assign") {
    const pc = await waitForMessage(ceo, "meeting.phase_change", 5000);
    phase = (pc as { phase: string }).phase;
  }
  console.log(`\n📝 Phase: ${phase.toUpperCase()}`);

  // === STEP 6: ASSIGN — action items ===
  console.log("\n  CEO assigns tasks...");
  send(ceo, {
    type: "meeting.assign",
    meetingId,
    task: "Build @archon/mcp server with hub tools",
    assigneeId: "alice",
    deadline: "2026-03-15",
  });

  const task1 = await waitForMessage(alice, "meeting.action_item");
  console.log(`  → Alice: "${(task1 as { task: string }).task}"`);

  send(ceo, {
    type: "meeting.assign",
    meetingId,
    task: "Build @archon/agent-sdk WebSocket client",
    assigneeId: "bob",
    deadline: "2026-03-15",
  });

  const task2 = await waitForMessage(bob, "meeting.action_item");
  console.log(`  → Bob: "${(task2 as { task: string }).task}"`);

  // Acknowledge
  console.log("\n  Acknowledging tasks...");
  send(alice, { type: "meeting.acknowledge", meetingId, taskIndex: 0 });
  send(bob, { type: "meeting.acknowledge", meetingId, taskIndex: 1 });

  // Meeting completes
  const completed = await waitForMessage(ceo, "meeting.completed", 3000);
  console.log("\n✅ Meeting completed!");
  console.log(`  Decisions: ${((completed as { decisions: unknown[] }).decisions).length}`);
  console.log(`  Action items: ${((completed as { actionItems: unknown[] }).actionItems).length}`);

  // Cleanup
  ceo.ws.close();
  alice.ws.close();
  bob.ws.close();

  console.log("\n🎉 Demo finished!\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Demo failed:", err.message);
  process.exit(1);
});
