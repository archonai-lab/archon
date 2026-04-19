import { z } from "zod";

export const ContractTypeSchema = z.enum(["task", "meeting"]);
export type ContractType = z.infer<typeof ContractTypeSchema>;

export const CanonicalFieldTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "enum",
  "array",
  "object",
]);
export type CanonicalFieldType = z.infer<typeof CanonicalFieldTypeSchema>;

export interface CanonicalFieldBase {
  type: CanonicalFieldType;
  required: boolean;
  normative: boolean;
  description?: string;
}

export interface CanonicalStringField extends CanonicalFieldBase {
  type: "string";
}

export interface CanonicalNumberField extends CanonicalFieldBase {
  type: "number";
}

export interface CanonicalBooleanField extends CanonicalFieldBase {
  type: "boolean";
}

export interface CanonicalEnumField extends CanonicalFieldBase {
  type: "enum";
  values: string[];
}

export interface CanonicalArrayField extends CanonicalFieldBase {
  type: "array";
  allowEmpty?: boolean;
  items: CanonicalField;
}

export interface CanonicalObjectField extends CanonicalFieldBase {
  type: "object";
  fields: Record<string, CanonicalField>;
}

export type CanonicalField =
  | CanonicalStringField
  | CanonicalNumberField
  | CanonicalBooleanField
  | CanonicalEnumField
  | CanonicalArrayField
  | CanonicalObjectField;

export interface CanonicalContractSchema {
  id: string;
  version: string;
  contractType: ContractType;
  output: CanonicalObjectField;
}

export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
