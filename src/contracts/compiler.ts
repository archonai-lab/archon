import { z } from "zod";
import { parseContractToml } from "./toml.js";
import type {
  CanonicalContractInputBinding,
  CanonicalContractSchema,
  CanonicalField,
  CanonicalObjectField,
  ValidationIssue,
  ValidationResult,
} from "./types.js";
import {
  CanonicalFieldTypeSchema,
  ContractTypeSchema,
} from "./types.js";

const authoringFieldSchema: z.ZodType<any> = z.lazy(() => z.object({
  type: CanonicalFieldTypeSchema,
  required: z.boolean().optional().default(false),
  normative: z.boolean().optional().default(false),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  allow_empty: z.boolean().optional(),
  fields: z.record(authoringFieldSchema).optional(),
  items: authoringFieldSchema.optional(),
}).strict());

const authoringContractSchema = z.object({
  info: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    contract_type: ContractTypeSchema,
  }).strict(),
  input: z.object({
    type: z.literal("object"),
    required: z.boolean().optional().default(true),
    normative: z.boolean().optional().default(true),
    description: z.string().optional(),
    fields: z.record(authoringFieldSchema),
    binding: z.object({
      type: z.literal("message_type"),
      message_type: z.enum(["task.create", "task.update"]),
    }).strict(),
  }).strict().optional(),
  output: z.object({
    type: z.literal("object"),
    required: z.boolean().optional().default(true),
    normative: z.boolean().optional().default(true),
    description: z.string().optional(),
    fields: z.record(authoringFieldSchema),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.input && !value.output) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Contract must define at least one of input or output",
      path: ["output"],
    });
  }

  if (value.input && !value.input.binding) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "input.binding is required when input is defined",
      path: ["input", "binding"],
    });
  }
});

type AuthoringField = z.infer<typeof authoringFieldSchema>;
type AuthoringContract = z.infer<typeof authoringContractSchema>;

function assertFieldSemantics(field: AuthoringField, path: string): void {
  if ((field.required ?? false) && !(field.normative ?? false)) {
    throw new Error(`${path} cannot be required when normative = false`);
  }

  if (field.type === "array" && field.items) {
    assertFieldSemantics(field.items, `${path}.items`);
  }

  if (field.type === "object" && field.fields) {
    for (const [key, child] of Object.entries(field.fields)) {
      assertFieldSemantics(child, `${path}.fields.${key}`);
    }
  }
}

function compileField(field: AuthoringField): CanonicalField {
  switch (field.type) {
    case "string":
    case "number":
    case "boolean":
      return {
        type: field.type,
        required: field.required ?? false,
        normative: field.normative ?? false,
        ...(field.description ? { description: field.description } : {}),
      };
    case "enum":
      if (!field.values?.length) {
        throw new Error("Enum field requires non-empty values");
      }
      return {
        type: "enum",
        required: field.required ?? false,
        normative: field.normative ?? false,
        values: field.values,
        ...(field.description ? { description: field.description } : {}),
      };
    case "array":
      if (!field.items) {
        throw new Error("Array field requires items");
      }
      return {
        type: "array",
        required: field.required ?? false,
        normative: field.normative ?? false,
        items: compileField(field.items),
        ...(field.allow_empty !== undefined ? { allowEmpty: field.allow_empty } : {}),
        ...(field.description ? { description: field.description } : {}),
      };
    case "object":
      if (!field.fields) {
        throw new Error("Object field requires fields");
      }
      return {
        type: "object",
        required: field.required ?? false,
        normative: field.normative ?? false,
        fields: Object.fromEntries(
          Object.entries(field.fields).map(([key, value]) => [key, compileField(value)]),
        ),
        ...(field.description ? { description: field.description } : {}),
      };
  }

  throw new Error(`Unsupported field type: ${(field as { type?: string }).type ?? "unknown"}`);
}

function compileInputBinding(binding: NonNullable<AuthoringContract["input"]>["binding"]): CanonicalContractInputBinding {
  return {
    type: binding.type,
    messageType: binding.message_type,
  };
}

export function compileContractAuthoringObject(input: unknown): CanonicalContractSchema {
  const parsed = authoringContractSchema.parse(input) as AuthoringContract;
  if (parsed.input) {
    assertFieldSemantics(parsed.input, "input");
  }
  if (parsed.output) {
    assertFieldSemantics(parsed.output, "output");
  }

  const compiled: CanonicalContractSchema = {
    id: parsed.info.id,
    version: parsed.info.version,
    contractType: parsed.info.contract_type,
    ...(parsed.input ? { input: compileField(parsed.input) as CanonicalObjectField } : {}),
    ...(parsed.input?.binding ? { inputBinding: compileInputBinding(parsed.input.binding) } : {}),
    ...(parsed.output ? { output: compileField(parsed.output) as CanonicalObjectField } : {}),
  };
  return compiled;
}

export function compileContractToml(input: string): CanonicalContractSchema {
  const parsed = parseContractToml(input);
  return compileContractAuthoringObject(parsed);
}

function validateField(
  value: unknown,
  field: CanonicalField,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value == null) {
    if (field.required && field.normative) {
      issues.push({ path, message: "required field is missing" });
    }
    return;
  }

  switch (field.type) {
    case "string":
      if (typeof value !== "string") issues.push({ path, message: "expected string" });
      return;
    case "number":
      if (typeof value !== "number") issues.push({ path, message: "expected number" });
      return;
    case "boolean":
      if (typeof value !== "boolean") issues.push({ path, message: "expected boolean" });
      return;
    case "enum":
      if (typeof value !== "string" || !field.values.includes(value)) {
        issues.push({ path, message: `expected enum value: ${field.values.join(", ")}` });
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        issues.push({ path, message: "expected array" });
        return;
      }
      if (value.length === 0 && field.allowEmpty === false) {
        issues.push({ path, message: "array must not be empty" });
      }
      value.forEach((entry, index) => validateField(entry, field.items, `${path}[${index}]`, issues));
      return;
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        issues.push({ path, message: "expected object" });
        return;
      }
      for (const [key, child] of Object.entries(field.fields)) {
        validateField((value as Record<string, unknown>)[key], child, `${path}.${key}`, issues);
      }
  }
}

export function validateCompiledOutput(
  schema: CanonicalContractSchema,
  value: unknown,
): ValidationResult {
  if (!schema.output) {
    return {
      ok: false,
      issues: [{ path: "output", message: "compiled contract does not define output" }],
    };
  }
  const issues: ValidationIssue[] = [];
  validateField(value, schema.output, "output", issues);
  return {
    ok: issues.length === 0,
    issues,
  };
}

export function evaluateLegacyReviewResult(report: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!/(^|\n)\s*(?:#+\s*)?verdict\s*[:\-]/i.test(report)) {
    issues.push({ path: "report.verdict", message: "missing verdict heading" });
  }
  if (!/(^|\n)\s*(?:#+\s*)?(findings|no findings)\s*[:\-]/i.test(report)) {
    issues.push({ path: "report.findings", message: "missing findings/no findings heading" });
  }
  if (!/(^|\n)\s*(?:#+\s*)?verification\s*[:\-]/i.test(report)) {
    issues.push({ path: "report.verification", message: "missing verification heading" });
  }
  return {
    ok: issues.length === 0,
    issues,
  };
}
