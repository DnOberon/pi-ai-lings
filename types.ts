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
export type EvaluationDocument = {
  exerciseName?: string;
  evaluations: Evaluation[];
};
export type EvaluationStatus = { complete: boolean; reason: string };
export type ChangeType = "A" | "M" | "D";
export type EvaluationStateFile = {
  path: string;
  status: ChangeType;
  summary: string;
};
export type EvaluationState = { changed_files: EvaluationStateFile[] };
export type JevQuestion = {
  id: string;
  evaluation: string;
  criterion: string;
};
export type JevRequestContext = {
  state: EvaluationState;
  questions: JevQuestion[];
};
export type EvaluatorContext = ExtensionContext;
