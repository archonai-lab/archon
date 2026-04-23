import type {
  CanonicalArrayField,
  CanonicalContractSchema,
  CanonicalField,
} from "./types.js";

export interface CompletionSurfaceFieldBase {
  type: CanonicalField["type"];
  required: boolean;
  description: string;
}

export interface CompletionSurfaceScalarField extends CompletionSurfaceFieldBase {
  type: "string" | "number" | "boolean";
}

export interface CompletionSurfaceEnumField extends CompletionSurfaceFieldBase {
  type: "enum";
  values: string[];
}

export interface CompletionSurfaceArrayField extends CompletionSurfaceFieldBase {
  type: "array";
  items: CompletionSurfaceField;
}

export interface CompletionSurfaceObjectField extends CompletionSurfaceFieldBase {
  type: "object";
  fields: Record<string, CompletionSurfaceField>;
}

export type CompletionSurfaceField =
  | CompletionSurfaceScalarField
  | CompletionSurfaceEnumField
  | CompletionSurfaceArrayField
  | CompletionSurfaceObjectField;

export interface CompletionSurface {
  contractId: string;
  fields: Record<string, CompletionSurfaceField>;
}

function requireDescription(field: CanonicalField, path: string): string {
  const description = field.description?.trim();
  if (!description) {
    throw new Error(`${path} requires description`);
  }
  return description;
}

function projectField(field: CanonicalField, path: string): CompletionSurfaceField {
  const description = requireDescription(field, path);

  switch (field.type) {
    case "string":
    case "number":
    case "boolean":
      return {
        type: field.type,
        required: field.required,
        description,
      };
    case "enum":
      return {
        type: "enum",
        required: field.required,
        description,
        values: field.values,
      };
    case "array":
      return {
        type: "array",
        required: field.required,
        description,
        items: projectArrayItems(field, path),
      };
    case "object":
      return {
        type: "object",
        required: field.required,
        description,
        fields: Object.fromEntries(
          Object.entries(field.fields).map(([key, child]) => [key, projectField(child, `${path}.${key}`)]),
        ),
      };
  }
}

function projectArrayItems(field: CanonicalArrayField, path: string): CompletionSurfaceField {
  return projectField(field.items, `${path}.items`);
}

export function projectCompletionSurface(contract: CanonicalContractSchema): CompletionSurface {
  if (contract.contractType !== "task") {
    throw new Error(`completion surface requires task contract: ${contract.id}`);
  }
  if (!contract.output) {
    throw new Error(`completion surface requires output object: ${contract.id}`);
  }

  return {
    contractId: contract.id,
    fields: Object.fromEntries(
      Object.entries(contract.output.fields).map(([key, field]) => [key, projectField(field, `output.${key}`)]),
    ),
  };
}
