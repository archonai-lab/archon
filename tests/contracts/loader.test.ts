import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getUserContractsDir,
  loadContracts,
  loadContractsFromSources,
} from "../../src/contracts/loader.js";
import { ensureArchonHome } from "../../src/setup.js";

const validContract = `
[info]
id = "private_review"
version = "1.0"
contract_type = "task"

[output]
type = "object"
required = true
normative = true

[output.fields.verdict]
type = "enum"
required = true
normative = true
values = ["pass", "needs_changes"]
`;

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("contract loader", () => {
  it("loads runtime user contracts", () => {
    const archonHome = tempDir("archon-home-");
    const userDir = getUserContractsDir(archonHome);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "private.toml"), validContract);

    const result = loadContracts({ archonHome });

    expect(result.diagnostics).toEqual([]);
    expect(result.contracts.map((entry) => entry.contract.id)).toEqual(["private_review"]);
  });

  it("allows missing runtime contract directory", () => {
    const archonHome = tempDir("archon-home-");

    const result = loadContracts({ archonHome });

    expect(result.diagnostics).toEqual([]);
    expect(result.contracts).toEqual([]);
  });

  it("reports duplicate contract ids in runtime contracts", () => {
    const userDir = tempDir("archon-contracts-user-");
    writeFileSync(join(userDir, "a.toml"), validContract);
    writeFileSync(join(userDir, "b.toml"), validContract);

    const result = loadContractsFromSources([{ kind: "runtime", dir: userDir }]);

    expect(result.contracts).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("duplicate contract id");
  });

  it("reports invalid user contracts with diagnostics", () => {
    const userDir = tempDir("archon-contracts-user-");
    writeFileSync(join(userDir, "bad.toml"), `
[info]
id = "bad"
version = "1.0"
contract_type = "dynamic"
`);

    const result = loadContractsFromSources([{ kind: "runtime", dir: userDir }]);

    expect(result.contracts).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].filePath).toContain("bad.toml");
  });

  it("seeds default contracts into the runtime contracts directory", () => {
    const home = tempDir("archon-home-");
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      ensureArchonHome();
      const archonHome = join(home, ".archon");
      expect(existsSync(join(archonHome, "contracts", "codebase_review_task.toml"))).toBe(true);
      const result = loadContracts({ archonHome });
      expect(result.contracts.map((entry) => entry.contract.id)).toContain("codebase_review_task");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
    }
  });
});
