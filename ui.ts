import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EvaluationStatus } from "./types.ts";

export function renderExerciseStatus(
  ctx: ExtensionContext,
  enabled: boolean,
  statuses: Map<string, EvaluationStatus> = new Map(),
): void {
  if (!enabled) {
    ctx.ui.setStatus("ai-lings-exercise", undefined);
    return;
  }
  const complete =
    statuses.size > 0 &&
    [...statuses.values()].every((status) => status.complete);
  ctx.ui.setStatus(
    "ai-lings-exercise",
    complete ? "ai-lings exercise: Complete" : "ai-lings exercise: Incomplete",
  );
}

export function renderEvaluationStatus(
  ctx: ExtensionContext,
  running: boolean,
): void {
  ctx.ui.setWidget(
    "ai-lings-eval-status",
    running
      ? [
          ctx.ui.theme.bg(
            "toolPendingBg",
            ctx.ui.theme.bold(" Running evaluations… "),
          ),
        ]
      : undefined,
    { placement: "aboveEditor" },
  );
}

export function notify(ctx: ExtensionContext, message: string): void {
  ctx.ui.notify(message, "warning");
}
