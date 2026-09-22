import type {
  ExtensionAPI,
  InputEventResult,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import {
  isDirectoryEnabled,
  readUserConfig,
  writeUserConfig,
} from "./config.ts";
import { readEvaluations, readExplanation, readRules } from "./documents.ts";
import {
  evaluatePrompt,
  evaluateWithState,
  formatSummary,
  resolveOpenRouterCredential,
  splitModelSlug,
} from "./evaluator.ts";
import { buildEvaluationState, prepareJevRequestContext } from "./state.ts";
import { notify, renderEvaluationStatus, renderExerciseStatus } from "./ui.ts";
import type { EvaluationDocument, EvaluationStatus } from "./types.ts";

export default function extension(pi: ExtensionAPI): void {
  let statuses = new Map<string, EvaluationStatus>();

  pi.on("session_start", (_event, ctx) => {
    try {
      renderExerciseStatus(ctx, isDirectoryEnabled(ctx.cwd));
    } catch {
      // malformed EVALUATION.yaml — skip initial widget
    }
  });

  pi.on("input", async (event, ctx): Promise<InputEventResult> => {
    try {
      const userConfig = readUserConfig();
      if (!(isDirectoryEnabled(ctx.cwd) && userConfig.model))
        return { action: "continue" };

      const verdict = await evaluatePrompt(
        ctx,
        event.text,
        readRules(ctx.cwd),
        userConfig.model,
      );
      if (verdict?.allow === true) return { action: "continue" };

      notify(
        ctx,
        `Prompt rejected by ai-lings${verdict?.reason ? `: ${verdict.reason}` : "."}`,
      );
      return { action: "handled" };
    } catch (error) {
      notify(ctx, `Prompt rejected by ai-lings: ${(error as Error).message}`);
      return { action: "handled" };
    }
  });

  pi.registerCommand("al-enable", {
    description:
      "Enable ai-lings for a directory (defaults to the current directory)",
    handler: async (args, ctx) => {
      try {
        const directory = path.resolve(ctx.cwd, args.trim() || ".");
        const config = readUserConfig();
        if (!config.directories.includes(directory)) {
          config.directories.push(directory);
          writeUserConfig(config);
        }
        ctx.ui.notify(`ai-lings enabled for ${directory}`, "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message, "warning");
      }
    },
  });

  pi.registerCommand("al-disable", {
    description:
      "Disable ai-lings for a directory (defaults to the current directory)",
    handler: async (args, ctx) => {
      try {
        const directory = path.resolve(ctx.cwd, args.trim() || ".");
        const config = readUserConfig();
        config.directories = config.directories.filter(
          (item) => item !== directory,
        );
        writeUserConfig(config);
        ctx.ui.notify(`ai-lings disabled for ${directory}`, "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message, "warning");
      }
    },
  });

  pi.registerCommand("al-model", {
    description: "Set the ai-lings evaluator model in the user config",
    handler: async (args, ctx) => {
      try {
        let model = args.trim();
        if (!model) {
          const currentModel = ctx.model;
          if (currentModel)
            model = `${currentModel.provider}/${currentModel.id}`;
          else {
            ctx.ui.notify(
              "Usage: /al-model provider/model (or no args to capture the current model)",
              "warning",
            );
            return;
          }
        }
        splitModelSlug(model);
        const config = readUserConfig();
        config.model = model;
        writeUserConfig(config);
        ctx.ui.notify(`ai-lings model set to ${model}`, "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message, "warning");
      }
    },
  });

  pi.registerCommand("explain", {
    description: "Show the exercise explanation from EXPLANATION.md",
    handler: async (_args, ctx) => {
      try {
        ctx.ui.notify(readExplanation(ctx.cwd), "info");
      } catch (error) {
        ctx.ui.notify((error as Error).message, "warning");
      }
    },
  });

  pi.registerCommand("al-state", {
    description: "Build the current exercise state for future Jev evaluation",
    handler: async (_args, ctx) => {
      try {
        const userConfig = readUserConfig();
        if (!userConfig.model) {
          ctx.ui.notify(
            "ai-lings needs a model (set with /al-model)",
            "warning",
          );
          return;
        }
        ctx.ui.setWidget(
          "ai-lings-state-progress",
          ["Building evaluation state…"],
          { placement: "aboveEditor" },
        );
        const state = await buildEvaluationState(ctx.cwd, userConfig.model, {
          signal: ctx.signal,
          onProgress(current, total, file) {
            ctx.ui.setWidget(
              "ai-lings-state-progress",
              [`Building evaluation state (${current}/${total}): ${file}`],
              { placement: "aboveEditor" },
            );
          },
        });
        ctx.ui.setWidget("ai-lings-state-progress", undefined);
        ctx.ui.notify(JSON.stringify(state, null, 2), "info");
      } catch (error) {
        ctx.ui.setWidget("ai-lings-state-progress", undefined);
        const name =
          (error as Error).name === "AbortError"
            ? "Cancelled"
            : `Could not build evaluation state`;
        ctx.ui.notify(`${name}: ${(error as Error).message}`, "warning");
      }
    },
  });

  pi.registerCommand("al-eval", {
    description: "Run exercise evaluations in EVALUATION.yaml",
    handler: async (_args, ctx) => {
      if (!isDirectoryEnabled(ctx.cwd)) {
        ctx.ui.notify("ai-lings is not enabled for this directory", "warning");
        return;
      }
      const userConfig = readUserConfig();
      if (!userConfig.model) {
        ctx.ui.notify("ai-lings needs a model (set with /al-model)", "warning");
        return;
      }
      const model = userConfig.model;
      const document = readEvaluations(ctx.cwd);
      if (!document) {
        ctx.ui.notify("No EVALUATION.yaml found", "warning");
        return;
      }
      renderEvaluationStatus(ctx, true);
      try {
        const state = await buildEvaluationState(ctx.cwd, model, {
          signal: ctx.signal,
        });
        const context = prepareJevRequestContext(state, document);
        const credential = await resolveOpenRouterCredential(ctx.modelRegistry);
        const result = await evaluateWithState(
          context,
          document.evaluations,
          credential,
          model,
          ctx.signal,
        );
        statuses = result.statuses;
        renderExerciseStatus(ctx, true, statuses);
        const summary = formatSummary(
          result.path,
          result.statuses,
          result.failedCriteria,
        );
        if (result.path === "unavailable") {
          notify(ctx, `${summary}${result.error ? `: ${result.error}` : ""}`);
        } else if (result.path === "fallback") {
          const parts = [summary];
          if (result.error) parts.push(`(Jev: ${result.error})`);
          ctx.ui.notify(parts.join(" "), "info");
        } else {
          ctx.ui.notify(summary, "info");
        }
      } catch (error) {
        const name =
          (error as Error).name === "AbortError"
            ? "Cancelled"
            : "Could not evaluate";
        ctx.ui.notify(`${name}: ${(error as Error).message}`, "warning");
      } finally {
        renderEvaluationStatus(ctx, false);
      }
    },
  });
}

export {
  isDirectoryEnabled,
  readUserConfig,
  writeUserConfig,
} from "./config.ts";
export { readEvaluations, readExplanation } from "./documents.ts";
export {
  buildJevRequest,
  evaluateWithState,
  aggregateCriteria,
  formatSummary,
  parseJevResponse,
  parseFallbackResponse,
  jevEvaluate,
  fallbackEvaluate,
  resolveOpenRouterCredential,
  parseEvaluationResults,
  parseVerdict,
  splitModelSlug,
} from "./evaluator.ts";
export {
  buildEvaluationState,
  collectChangedFiles,
  prepareJevRequestContext,
} from "./state.ts";
export { renderEvaluationStatus, renderExerciseStatus } from "./ui.ts";
