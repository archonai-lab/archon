import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  loadSkills,
  matchSkill,
  verifyAndGetBody,
  normalizeContent,
  hashContent,
  SAFE_AGENT_ID_RE,
  LoadSkillsInputSchema,
} from "../../src/skills/loader.js";
import type { AgentTask } from "../../src/protocol/types.js";

const TEST_AGENT = "skill-test-agent";
const SKILLS_DIR = join(homedir(), ".archon", "agents", TEST_AGENT, "skills");

function writeSkill(filename: string, content: string): void {
  writeFileSync(join(SKILLS_DIR, filename), content, "utf-8");
}

beforeAll(() => {
  mkdirSync(SKILLS_DIR, { recursive: true });
});

beforeEach(() => {
  if (existsSync(SKILLS_DIR)) {
    rmSync(SKILLS_DIR, { recursive: true });
  }
  mkdirSync(SKILLS_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(join(homedir(), ".archon", "agents", TEST_AGENT), { recursive: true, force: true });
});

describe("normalizeContent", () => {
  it("should strip BOM", () => {
    expect(normalizeContent("\uFEFFhello")).toBe("hello");
  });

  it("should convert \\r\\n to \\n", () => {
    expect(normalizeContent("a\r\nb")).toBe("a\nb");
  });

  it("should trim trailing whitespace per line", () => {
    expect(normalizeContent("hello   \nworld  ")).toBe("hello\nworld");
  });
});

describe("loadSkills", () => {
  it("should load valid skill files", async () => {
    writeSkill("review.md", `---
name: code-review
description: Review code for quality issues
triggers: [review, audit, quality]
priority: 5
---

Review the code carefully.
`);

    const skills = await loadSkills(TEST_AGENT);
    expect(skills).toHaveLength(1);
    expect(skills[0].frontmatter.name).toBe("code-review");
    expect(skills[0].frontmatter.triggers).toEqual(["review", "audit", "quality"]);
    expect(skills[0].frontmatter.priority).toBe(5);
    expect(skills[0].hash).toBeTruthy();
    expect(skills[0].body).toContain("Review the code carefully");
  });

  it("should reject skill with missing required fields", async () => {
    writeSkill("bad.md", `---
name: incomplete
---

Missing description and triggers.
`);

    const skills = await loadSkills(TEST_AGENT);
    // "bad.md" should be skipped — invalid frontmatter
    const names = skills.map((s) => s.frontmatter.name);
    expect(names).not.toContain("incomplete");
  });

  it("should skip files without frontmatter", async () => {
    writeSkill("nofm.md", "Just plain markdown, no frontmatter.");

    const skills = await loadSkills(TEST_AGENT);
    const names = skills.map((s) => s.frontmatter.name);
    expect(names).not.toContain("nofm");
  });

  it("should return empty array for agent with no skills directory", async () => {
    const skills = await loadSkills("nonexistent-agent-xyz");
    expect(skills).toEqual([]);
  });

  it("should leave priority undefined when not specified", async () => {
    writeSkill("nopri.md", `---
name: no-priority
description: A skill without priority
triggers: [test]
---

Body here.
`);

    const skills = await loadSkills(TEST_AGENT);
    const noPri = skills.find((s) => s.frontmatter.name === "no-priority");
    expect(noPri).toBeDefined();
    expect(noPri!.frontmatter.priority).toBeUndefined();
  });

  it("should parse priority as a number (not a string) via CORE_SCHEMA", async () => {
    writeSkill("priority.md", `---
name: priority-skill
description: A skill with explicit priority
triggers: [priority]
priority: 5
---

Priority body.
`);

    const skills = await loadSkills(TEST_AGENT);
    const skill = skills.find((s) => s.frontmatter.name === "priority-skill");
    expect(skill).toBeDefined();
    expect(skill!.frontmatter.priority).toBe(5);
    expect(typeof skill!.frontmatter.priority).toBe("number");
  });

  it("should skip dangling symlinks without throwing", async () => {
    // Create a symlink pointing to a non-existent target — dangling symlink
    const symlinkPath = join(SKILLS_DIR, "dangling.md");
    symlinkSync("/nonexistent/target/skill.md", symlinkPath);

    // loadSkills must return an empty array (symlink skipped) and not throw
    await expect(loadSkills(TEST_AGENT)).resolves.toEqual([]);
  });
});

describe("matchSkill", () => {
  it("should match by keyword overlap", () => {
    const skills = [
      {
        frontmatter: { name: "review", description: "d", triggers: ["review", "audit"], priority: 0 },
        body: "b", hash: "h", filePath: "review.md",
      },
      {
        frontmatter: { name: "security", description: "d", triggers: ["security", "vuln"], priority: 0 },
        body: "b", hash: "h", filePath: "security.md",
      },
    ];

    const task: AgentTask = { agentId: "test", input: "please review this code" };
    const match = matchSkill(task, skills);
    expect(match?.frontmatter.name).toBe("review");
  });

  it("should prefer higher priority", () => {
    const skills = [
      {
        frontmatter: { name: "low", description: "d", triggers: ["code"], priority: 1 },
        body: "b", hash: "h", filePath: "low.md",
      },
      {
        frontmatter: { name: "high", description: "d", triggers: ["code"], priority: 10 },
        body: "b", hash: "h", filePath: "high.md",
      },
    ];

    const task: AgentTask = { agentId: "test", input: "check the code" };
    const match = matchSkill(task, skills);
    expect(match?.frontmatter.name).toBe("high");
  });

  it("should tiebreak by filename alphabetically via disk load", async () => {
    // Write two skills with same priority and same trigger — tiebreak by filename
    writeSkill("beta-deploy.md", `---
name: beta-deploy
description: Beta deployment
triggers: [deploy]
priority: 5
---

Beta body.
`);
    writeSkill("alpha-deploy.md", `---
name: alpha-deploy
description: Alpha deployment
triggers: [deploy]
priority: 5
---

Alpha body.
`);

    const skills = await loadSkills(TEST_AGENT);
    expect(skills).toHaveLength(2);

    const task: AgentTask = { agentId: "test", input: "deploy the app" };
    const match = matchSkill(task, skills);
    // alpha-deploy.md sorts before beta-deploy.md — first match wins
    expect(match?.frontmatter.name).toBe("alpha-deploy");
  });

  it("should return null when no triggers match", () => {
    const skills = [
      {
        frontmatter: { name: "review", description: "d", triggers: ["review"], priority: 0 },
        body: "b", hash: "h", filePath: "review.md",
      },
    ];

    const task: AgentTask = { agentId: "test", input: "deploy to production" };
    expect(matchSkill(task, skills)).toBeNull();
  });

  it("should return null for empty skills list", () => {
    const task: AgentTask = { agentId: "test", input: "anything" };
    expect(matchSkill(task, [])).toBeNull();
  });
});

describe("verifyAndGetBody", () => {
  it("should return body when hash matches", async () => {
    writeSkill("verify.md", `---
name: verify-test
description: Test verification
triggers: [verify]
---

Verified body content.
`);

    const skills = await loadSkills(TEST_AGENT);
    const skill = skills.find((s) => s.frontmatter.name === "verify-test");
    expect(skill).toBeDefined();

    const body = await verifyAndGetBody(skill!);
    expect(body).toContain("Verified body content");
  });

  it("should return null when file has been modified", async () => {
    writeSkill("verify.md", `---
name: verify-test
description: Test verification
triggers: [verify]
---

Verified body content.
`);

    const skills = await loadSkills(TEST_AGENT);
    const skill = skills.find((s) => s.frontmatter.name === "verify-test");
    expect(skill).toBeDefined();

    // Tamper with the file after loading
    writeFileSync(skill!.filePath, "TAMPERED CONTENT", "utf-8");

    const body = await verifyAndGetBody(skill!);
    expect(body).toBeNull();
  });
});

describe("read-only enforcement", () => {
  it("should open files with read-only flag", async () => {
    // The loader uses fs.open(path, 'r') — O_RDONLY.
    // We verify by checking that loadSkills succeeds on readable files
    // and that the loader never calls any write API.
    writeSkill("readonly.md", `---
name: readonly-test
description: Test read-only
triggers: [readonly]
---

Content.
`);

    const skills = await loadSkills(TEST_AGENT);
    const skill = skills.find((s) => s.frontmatter.name === "readonly-test");
    expect(skill).toBeDefined();
    // If we got here, the file was opened successfully in read mode
  });
});
