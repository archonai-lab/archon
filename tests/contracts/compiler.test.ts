import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ZodError } from "zod";
import { compileContractToml, validateCompiledOutput } from "../../src/contracts/compiler.js";

const reviewFixturePath = resolve(
  import.meta.dirname,
  "../../defaults/contracts/codebase_review_task.toml",
);
const implementationFixturePath = resolve(
  import.meta.dirname,
  "../../defaults/contracts/code_fixing.toml",
);
const taskCreateInputFixturePath = resolve(
  import.meta.dirname,
  "./fixtures/task-create-input.toml",
);
const taskUpdateInputFixturePath = resolve(
  import.meta.dirname,
  "./fixtures/task-update-input.toml",
);

function expectUnrecognizedKeyFailure(
  input: string,
  expected: { key: string; path: string[] },
): void {
  try {
    compileContractToml(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
    const issue = (error as ZodError).issues.find((entry) => (
      entry.code === "unrecognized_keys"
      && entry.keys.includes(expected.key)
      && entry.path.join(".") === expected.path.join(".")
    ));

    expect(issue).toMatchObject({
      code: "unrecognized_keys",
      keys: expect.arrayContaining([expected.key]),
      path: expected.path,
    });
    return;
  }

  throw new Error("Expected contract compilation to reject an unrecognized key");
}

describe("contract compiler", () => {
  it("compiles the first codebase review task contract", () => {
    const compiled = compileContractToml(readFileSync(reviewFixturePath, "utf-8"));
    expect(compiled.contractType).toBe("task");
    expect(compiled.output?.fields.verdict.type).toBe("enum");
    expect(compiled.output?.fields.self_check.type).toBe("object");
    expect(compiled.input).toBeUndefined();
    expect(compiled.inputBinding).toBeUndefined();
  });

  it("compiles the implementation change task contract", () => {
    const compiled = compileContractToml(readFileSync(implementationFixturePath, "utf-8"));
    expect(compiled.contractType).toBe("task");
    expect(compiled.output?.fields.summary.type).toBe("string");
    expect(compiled.output?.fields.changed_files.type).toBe("array");
    expect(compiled.output?.fields.verification.type).toBe("array");
    expect(compiled.input).toBeUndefined();
    expect(compiled.inputBinding).toBeUndefined();
  });

  it("compiles input fixtures with the frozen message_type binding rule", () => {
    const createContract = compileContractToml(readFileSync(taskCreateInputFixturePath, "utf-8"));
    const updateContract = compileContractToml(readFileSync(taskUpdateInputFixturePath, "utf-8"));

    expect(createContract.inputBinding).toEqual({
      type: "message_type",
      messageType: "task.create",
    });
    expect(createContract.input?.fields.title.type).toBe("string");
    expect(createContract.output).toBeUndefined();

    expect(updateContract.inputBinding).toEqual({
      type: "message_type",
      messageType: "task.update",
    });
    expect(updateContract.input?.fields.taskId.type).toBe("string");
    expect(updateContract.output).toBeUndefined();
  });

  it("rejects input bindings outside the covered task message types", () => {
    const input = `
[info]
id = "bad_input_binding"
version = "1.0"
contract_type = "task"

[input]
type = "object"
required = true
normative = true

[input.binding]
type = "message_type"
message_type = "task.delete"

[input.fields.taskId]
type = "string"
required = true
normative = true
`;
    expect(() => compileContractToml(input)).toThrow();
  });

  it.each([
    {
      name: "misplaced root binding",
      section: "[binding]\ntype = \"message_type\"\nmessage_type = \"task.create\"\n",
      key: "binding",
      path: [],
    },
    {
      name: "misplaced root input_binding",
      section: "[input_binding]\ntype = \"message_type\"\nmessage_type = \"task.create\"\n",
      key: "input_binding",
      path: [],
    },
    {
      name: "misplaced input payload",
      section: "[input.payload]\ntype = \"object\"\n",
      key: "payload",
      path: ["input"],
    },
  ])("rejects ambiguous authoring shape as an unrecognized key: $name", ({ section, key, path }) => {
    const input = `
[info]
id = "bad_ambiguous_shape"
version = "1.0"
contract_type = "task"

[input]
type = "object"
required = true
normative = true

[input.binding]
type = "message_type"
message_type = "task.create"

[input.fields.title]
type = "string"
required = true
normative = true

${section}
`;
    expectUnrecognizedKeyFailure(input, { key, path });
  });

  it("rejects unknown nested field keys", () => {
    const input = `
[info]
id = "bad_nested_field_key"
version = "1.0"
contract_type = "task"

[output]
type = "object"
required = true
normative = true

[output.fields.result]
type = "object"
required = true
normative = true

[output.fields.result.fields.summary]
type = "string"
required = true
normative = true
payload = "misplaced"
`;
    expectUnrecognizedKeyFailure(input, {
      key: "payload",
      path: ["output", "fields", "result", "fields", "summary"],
    });
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
    const compiled = compileContractToml(readFileSync(reviewFixturePath, "utf-8"));
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
    const compiled = compileContractToml(readFileSync(reviewFixturePath, "utf-8"));
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

  it("does not treat input-only contracts as output validation contracts", () => {
    const compiled = compileContractToml(readFileSync(taskCreateInputFixturePath, "utf-8"));
    const result = validateCompiledOutput(compiled, {
      title: "Compiler-only fixture",
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { path: "output", message: "compiled contract does not define output" },
    ]);
  });
});
