import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getDefaultContractsDir,
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

const runtimePlanArtifactContract = `
[info]
id = "plan_artifact_v1"
version = "1.0"
contract_type = "task"

[output]
type = "object"
required = true
normative = true

[output.fields.scope]
type = "string"
required = true
normative = true
description = "Runtime override scope."

[output.fields.steps]
type = "array"
required = true
normative = true
allow_empty = false
description = "Runtime override steps."

[output.fields.steps.items]
type = "string"
required = true
normative = true
description = "Runtime override step."

[output.fields.risks]
type = "array"
required = true
normative = true
allow_empty = true
description = "Runtime override risks."

[output.fields.risks.items]
type = "string"
required = true
normative = true
description = "Runtime override risk."

[output.fields.verification]
type = "array"
required = true
normative = true
allow_empty = false
description = "Runtime override verification."

[output.fields.verification.items]
type = "string"
required = true
normative = true
description = "Runtime override verification step."
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
    expect(result.contracts.map((entry) => entry.contract.id)).toContain("private_review");
    expect(result.contracts.map((entry) => entry.contract.id)).toContain("plan_artifact_v1");
    expect(
      result.contracts.find((entry) => entry.contract.id === "private_review")?.source,
    ).toBe("runtime");
  });

  it("falls back to packaged default contracts when the runtime contract directory is missing", () => {
    const archonHome = tempDir("archon-home-");

    const result = loadContracts({ archonHome });

    expect(result.diagnostics).toEqual([]);
    expect(result.contracts.map((entry) => entry.contract.id)).toContain("codebase_review_task");
    expect(result.contracts.every((entry) => entry.source === "default")).toBe(true);
  });

  it("keeps built-in contracts when runtime adds unrelated contracts", () => {
    const archonHome = tempDir("archon-home-");
    const userDir = getUserContractsDir(archonHome);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "private.toml"), validContract);

    const result = loadContracts({ archonHome });

    expect(result.diagnostics).toEqual([]);
    expect(result.contracts.map((entry) => entry.contract.id)).toContain("private_review");
    expect(result.contracts.map((entry) => entry.contract.id)).toContain("plan_artifact_v1");
    expect(
      result.contracts.find((entry) => entry.contract.id === "plan_artifact_v1")?.source,
    ).toBe("default");
  });

  it("applies runtime precedence per contract id without dropping unrelated defaults", () => {
    const archonHome = tempDir("archon-home-");
    const userDir = getUserContractsDir(archonHome);
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "plan_artifact_v1.toml"), runtimePlanArtifactContract);

    const result = loadContracts({ archonHome });

    expect(result.diagnostics).toEqual([]);
    expect(
      result.contracts.find((entry) => entry.contract.id === "plan_artifact_v1")?.source,
    ).toBe("runtime");
    expect(
      result.contracts.find((entry) => entry.contract.id === "codebase_review_task")?.source,
    ).toBe("default");
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

  it("points packaged default loading at the repo defaults/contracts directory", () => {
    expect(getDefaultContractsDir()).toContain("defaults/contracts");
  });
});
