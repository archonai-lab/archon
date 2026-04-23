import { describe, expect, it } from "vitest";
import { compileContractToml } from "../../src/contracts/compiler.js";
import { projectCompletionSurface } from "../../src/contracts/completion-surface.js";

describe("completion surface projection", () => {
  it("fails projection when a surfaced field is missing description", () => {
    const compiled = compileContractToml(`
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
`);

    expect(() => projectCompletionSurface(compiled)).toThrow(/output\.scope requires description/i);
  });
});
