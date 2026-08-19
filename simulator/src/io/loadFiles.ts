/**
 * Node-side loading of design and conditions files.
 *
 * Kept apart from `validate.ts` so the browser build never pulls in `fs`.
 */

import { readFileSync } from "node:fs";

import { validateConditions, validateDesign } from "./validate.js";
import type { Conditions, Design } from "../model/types.js";

export function loadDesignFile(path: string): Design {
  return validateDesign(readJson(path), path);
}

export function loadConditionsFile(path: string): Conditions {
  return validateConditions(readJson(path), path);
}

function readJson(path: string): unknown {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`);
  }
}
