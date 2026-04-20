import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { compileContractToml, validateCompiledOutput } from "../../src/contracts/compiler.js";

const fixturePath = resolve(
  import.meta.dirname,
  "../../defaults/contracts/codebase_review_task.toml",
);

describe("contract compiler", () => {
  it("compiles the first codebase review task contract", () => {
    const compiled = compileContractToml(readFileSync(fixturePath, "utf-8"));
    expect(compiled.contractType).toBe("task");
    expect(compiled.output.fields.verdict.type).toBe("enum");
    expect(compiled.output.fields.self_check.type).toBe("object");
  });

  it("compiles the implementation change task contract", () => {
    const implementationFixturePath = resolve(
      import.meta.dirname,
      "../../defaults/contracts/code_fixing.toml",
    );
    const compiled = compileContractToml(readFileSync(implementationFixturePath, "utf-8"));
    expect(compiled.contractType).toBe("task");
    expect(compiled.output.fields.summary.type).toBe("string");
    expect(compiled.output.fields.changed_files.type).toBe("array");
    expect(compiled.output.fields.verification.type).toBe("array");
  });

  it("rejects unsupported contract types", () => {
    const input = `
[info]
id = "bad_contract"
version = "1.0"
contract_type = "magic"

[output]
type = "object"
required = true
normative = true

[output.fields.verdict]
type = "string"
required = true
normative = true
`;
    expect(() => compileContractToml(input)).toThrow();
  });

  it("rejects fields that are required but non-normative", () => {
    const input = `
[info]
id = "bad_required_semantics"
version = "1.0"
contract_type = "task"

[output]
type = "object"
required = true
normative = true

[output.fields.note]
type = "string"
required = true
normative = false
`;
    expect(() => compileContractToml(input)).toThrow(/cannot be required when normative = false/);
  });

  it("validates a structured review result against the compiled schema", () => {
    const compiled = compileContractToml(readFileSync(fixturePath, "utf-8"));
    const result = validateCompiledOutput(compiled, {
      verdict: "pass_with_notes",
      self_check: {
        repo_root: "/tmp/archon-contract-slice-1a",
        branch: "feat/contract-slice-1a",
        diff_files: ["src/contracts/compiler.ts"],
      },
      findings: [],
      verification: [
        { kind: "repo_scope_check", evidence: "reviewed only current execution repo" },
        { kind: "diff_review", evidence: "reviewed git diff for current branch" },
      ],
      risks: [],
    });
    expect(result.ok).toBe(true);
  });

  it("does not fail validation when an optional non-normative field is omitted", () => {
    const compiled = compileContractToml(readFileSync(fixturePath, "utf-8"));
    const result = validateCompiledOutput(compiled, {
      verdict: "needs_changes",
      self_check: {
        repo_root: "/tmp/archon-contract-slice-1a",
        branch: "feat/contract-slice-1a",
        diff_files: ["src/contracts/compiler.ts"],
      },
      findings: [
        {
          severity: "warning",
          file: "src/contracts/compiler.ts",
          problem: "Normative mismatch",
        },
      ],
      verification: [
        { kind: "repo_scope_check", evidence: "reviewed only current execution repo" },
      ],
      risks: [],
    });
    expect(result.ok).toBe(true);
  });

  it("validates a structured implementation result against the compiled implementation schema", () => {
    const implementationFixturePath = resolve(
      import.meta.dirname,
      "../../defaults/contracts/code_fixing.toml",
    );
    const compiled = compileContractToml(readFileSync(implementationFixturePath, "utf-8"));
    const result = validateCompiledOutput(compiled, {
      summary: "Aligned task get visibility with task board visibility.",
      changed_files: [
        "src/tasks/task-crud.ts",
        "tests/hub/server.test.ts",
      ],
      verification: [
        "npm run build",
        "npx vitest run tests/tasks/task-crud.test.ts tests/hub/server.test.ts",
      ],
      risks: [],
    });

    expect(result.ok).toBe(true);
  });
});
