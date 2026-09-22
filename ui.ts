import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EvaluationDocument, EvaluationStatus } from "./types.ts";

export function renderEvaluations(
  ctx: ExtensionContext,
  document: EvaluationDocument | null,
  statuses: Map<string, EvaluationStatus>,
): void {
  const evaluations = document?.evaluations ?? [];
  if (evaluations.length === 0) {
    ctx.ui.setWidget("ai-lings-evaluations", undefined);
    return;
  }
  const header = document?.exerciseName
    ? `Evaluation Criteria: ${document.exerciseName}`
    : "Evaluation Criteria:";
  ctx.ui.setWidget(
    "ai-lings-evaluations",
    [
      header,
      ...evaluations.map((evaluation) => {
        const status = statuses.get(evaluation.name);
        const showReason =
          evaluation.show && status && !status.complete && status.reason;
        return `${status?.complete ? "✓" : "○"} ${evaluation.name}${showReason ? ` — ${status.reason}` : ""}`;
      }),
    ],
    { placement: "aboveEditor" },
  );
}

export function renderEvaluationStatus(ctx: ExtensionContext, running: boolean): void {
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
