import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type UserConfig = { directories: string[]; model?: string };
export type Verdict = { allow: boolean; reason: string };
export type Message = { content?: Array<{ type: string; text?: string }> };
export type Evaluation = {
  name: string;
  show: boolean;
  criteria: string[];
  meetAll: boolean;
};
export type EvaluationDocument = { exerciseName?: string; evaluations: Evaluation[] };
export type EvaluationStatus = { complete: boolean; reason: string };
export type EvaluatorContext = ExtensionContext;
