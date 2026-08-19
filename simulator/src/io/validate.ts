/**
 * Validation against the canonical JSON schemas.
 *
 * The schema is the contract; this module never re-states its rules, it only
 * runs them. Anything that parses here is safe for physics to consume, so no
 * downstream module needs defensive checks on shape.
 *
 * Browser-safe: no filesystem access. File loading lives in `loadFiles.ts`.
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import designSchema from "./schema/design.schema.json" with { type: "json" };
import conditionsSchema from "./schema/conditions.schema.json" with { type: "json" };
import type { Conditions, Design } from "../model/types.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validateDesignSchema = ajv.compile(designSchema);
const validateConditionsSchema = ajv.compile(conditionsSchema);

export class ValidationError extends Error {
  readonly issues: string[];

  constructor(what: string, issues: string[]) {
    super(`${what} failed validation:\n  ${issues.join("\n  ")}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

export function validateDesign(data: unknown, label = "design"): Design {
  if (!validateDesignSchema(data)) {
    throw new ValidationError(label, formatErrors(validateDesignSchema.errors));
  }
  const design = data as unknown as Design;
  assertUniqueCulmIds(design);
  return design;
}

export function validateConditions(data: unknown, label = "conditions"): Conditions {
  if (!validateConditionsSchema(data)) {
    throw new ValidationError(label, formatErrors(validateConditionsSchema.errors));
  }
  return data as unknown as Conditions;
}

/**
 * Culm ids must be unique: they are how a station, a prototype log entry and a
 * measured culm refer to the same physical thing.
 */
function assertUniqueCulmIds(design: Design): void {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const c of design.culms) {
    if (seen.has(c.id)) dupes.push(c.id);
    seen.add(c.id);
  }
  if (dupes.length > 0) {
    throw new ValidationError("design", [`duplicate culm ids: ${dupes.join(", ")}`]);
  }
}

type AjvErrors = ReadonlyArray<{ instancePath: string; message?: string }> | null | undefined;

function formatErrors(errors: AjvErrors): string[] {
  if (!errors) return ["unknown error"];
  return errors.map((e) => `${e.instancePath || "(root)"} ${e.message ?? ""}`.trim());
}
