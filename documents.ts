import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { EvaluationDocument } from "./types.ts";

const RULES_PATH = [".pi", "ai-lings", "RULES.md"];
const EVALUATION_PATH = [".pi", "ai-lings", "EVALUATION.yaml"];
const EXPLANATION_PATH = [".pi", "ai-lings", "EXPLANATION.md"];

export function readRules(cwd: string): string {
  const filename = path.join(cwd, ...RULES_PATH);
  try {
    return fs.readFileSync(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Rules file not found: ${path.join(...RULES_PATH)}`);
    }
    throw new Error(`Could not read ${filename}: ${(error as Error).message}`);
  }
}

export function readExplanation(cwd: string): string {
  const filename = path.join(cwd, ...EXPLANATION_PATH);
  try {
    return fs.readFileSync(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Explanation file not found: ${path.join(...EXPLANATION_PATH)}`,
      );
    }
    throw new Error(`Could not read ${filename}: ${(error as Error).message}`);
  }
}

export function readEvaluations(cwd: string): EvaluationDocument | null {
  const filename = path.join(cwd, ...EVALUATION_PATH);
  let source: string;
  try {
    source = fs.readFileSync(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${filename}: ${(error as Error).message}`);
  }

  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (error) {
    throw new Error(`Could not parse ${filename}: ${(error as Error).message}`);
  }
  if (!document || typeof document !== "object") {
    throw new Error(`Evaluation document must contain an evaluations list`);
  }
  const raw = document as {
    exercise_name?: unknown;
    evaluations?: unknown;
  };
  if (!Array.isArray(raw.evaluations)) {
    throw new Error(`Evaluation document must contain an evaluations list`);
  }

  const evaluations = raw.evaluations.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Evaluation ${index + 1} must be an object`);
    }
    const objective = item as {
      name?: unknown;
      show?: unknown;
      criteria?: unknown;
      meet_all?: unknown;
    };
    if (
      typeof objective.name !== "string" ||
      !objective.name.trim() ||
      typeof objective.show !== "boolean" ||
      (objective.meet_all !== undefined &&
        typeof objective.meet_all !== "boolean") ||
      !Array.isArray(objective.criteria) ||
      objective.criteria.some((criterion) => typeof criterion !== "string")
    ) {
      throw new Error(
        `Evaluation ${index + 1} must have name, show, and criteria`,
      );
    }
    return {
      name: objective.name.trim(),
      show: objective.show,
      criteria: objective.criteria as string[],
      meetAll: objective.meet_all === true,
    };
  });
  // Reject duplicate names
  const seen = new Set<string>();
  for (const ev of evaluations) {
    if (seen.has(ev.name))
      throw new Error(`Duplicate evaluation name: ${ev.name}`);
    seen.add(ev.name);
  }
  return {
    exerciseName:
      typeof raw.exercise_name === "string" ? raw.exercise_name : undefined,
    evaluations,
  };
}
