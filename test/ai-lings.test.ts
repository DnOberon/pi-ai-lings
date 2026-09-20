import assert from "node:assert/strict";
import test from "node:test";
import extension, {
  parseEvaluationResults,
  parseVerdict,
  readEvaluations,
  readExplanation,
  readProjectConfig,
  splitModelSlug,
} from "../index.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("reads enabled project config", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  fs.mkdirSync(path.join(cwd, ".pi", "ai-lings"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".pi", "ai-lings", "config.json"),
    JSON.stringify({ enabled: true, model: "openai/gpt-4o-mini" }),
  );
  assert.deepEqual(readProjectConfig(cwd), {
    model: "openai/gpt-4o-mini",
  });
});

test("reads evaluationIntervalMs when set (deprecated config)", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  fs.mkdirSync(path.join(cwd, ".pi", "ai-lings"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".pi", "ai-lings", "config.json"),
    JSON.stringify({ enabled: true, model: "m/m", evaluationIntervalMs: 9999 }),
  );
  assert.deepEqual(readProjectConfig(cwd), { model: "m/m" });
});

test("reads EXPLANATION.md", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "EXPLANATION.md"), "# How it works\n");
  assert.equal(readExplanation(cwd), "# How it works\n");
});

test("reads evaluation objectives and their display setting", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "EVALUATION.yaml"),
    "exercise_name: Test\nevaluations:\n  - name: Ready\n    show: true\n    criteria:\n      - A file exists\n",
  );
  assert.deepEqual(readEvaluations(cwd), {
    exerciseName: "Test",
    evaluations: [{ name: "Ready", show: true, criteria: ["A file exists"] }],
  });
});

test("parses complete evaluation results", () => {
  const evaluations = [{ name: "Ready", show: true, criteria: ["exists"] }];
  assert.deepEqual(
    parseEvaluationResults(
      {
        content: [{ type: "text", text: '[{"name":"Ready","complete":true}]' }],
      },
      evaluations,
    ),
    new Map([["Ready", { complete: true, reason: "" }]]),
  );
});

test("rejects duplicate evaluation names", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "EVALUATION.yaml"),
    "evaluations:\n  - name: Dup\n    show: true\n    criteria: [A]\n  - name: Dup\n    show: true\n    criteria: [B]\n",
  );
  assert.throws(() => readEvaluations(cwd), /Duplicate evaluation name: Dup/);
});

test("ignores disabled or missing project config", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  assert.equal(readProjectConfig(cwd), null);
});

test("parses strict evaluator verdicts", () => {
  assert.deepEqual(
    parseVerdict({
      content: [
        { type: "text", text: '{"allow":false,"reason":"missing context"}' },
      ],
    }),
    {
      allow: false,
      reason: "missing context",
    },
  );
  assert.equal(
    parseVerdict({ content: [{ type: "text", text: "not json" }] }),
    null,
  );
});

test("splits provider/model slugs", () => {
  assert.deepEqual(splitModelSlug("openrouter/openai/gpt-4o"), {
    provider: "openrouter",
    id: "openai/gpt-4o",
  });
  assert.throws(() => splitModelSlug("gpt-4o"), /provider\/model/);
});

test("gates prompts through the configured evaluator model", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "config.json"),
    JSON.stringify({ enabled: true, model: "test/model" }),
  );
  fs.writeFileSync(path.join(directory, "RULES.md"), "Only ask about tests.");

  const handlers = new Map<
    string,
    (event: any, ctx: any) => Promise<unknown>
  >();
  let requested: any;
  const widgetCalls: Array<{ id: string; items?: any; options?: any }> = [];
  const pi = {
    on: (
      event: string,
      callback: (event: any, ctx: any) => Promise<unknown>,
    ) => {
      handlers.set(event, callback);
    },
    registerCommand: () => {},
  };
  extension(pi as any);
  const ctx = {
    cwd,
    modelRegistry: {
      find: (provider: string, id: string) => ({ provider, id }),
      streamSimple: (model: any, context: any) => {
        requested = { model, context };
        return {
          result: async () => ({
            content: [{ type: "text", text: '{"allow":true,"reason":"ok"}' }],
          }),
        };
      },
    },
    signal: new AbortController().signal,
    ui: {
      notify: () => {},
      setWidget: (id: string, items?: any, options?: any) => {
        widgetCalls.push({ id, items, options });
      },
    },
  };
  const handler = handlers.get("input");
  assert.ok(handler);
  assert.deepEqual(await handler({ text: "What tests exist?" }, ctx), {
    action: "continue",
  });
  assert.equal(requested.model.provider, "test");
  assert.match(requested.context.messages[0].content, /What tests exist/);
});

test("runs evaluations on session start and renders widget", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "config.json"),
    JSON.stringify({ enabled: true, model: "test/model" }),
  );
  fs.writeFileSync(
    path.join(directory, "EVALUATION.yaml"),
    "exercise_name: Test\nevaluations:\n  - name: Ready\n    show: true\n    criteria:\n      - Works\n",
  );

  const handlers = new Map<
    string,
    (event: any, ctx: any) => Promise<unknown>
  >();
  const widgetCalls: Array<{ id: string; items?: any }> = [];
  const pi = {
    on: (event: string, cb: (event: any, ctx: any) => Promise<unknown>) => {
      handlers.set(event, cb);
    },
    registerCommand: () => {},
  };
  extension(pi as any);

  const ctx = {
    cwd,
    modelRegistry: { find: () => ({ provider: "test", id: "model" }) },
    signal: new AbortController().signal,
    ui: {
      notify: () => {},
      setWidget: (id: string, items?: any) => {
        widgetCalls.push({ id, items });
      },
    },
  };

  // session_start renders initial empty widget (no evaluation call)
  const startHandler = handlers.get("session_start");
  assert.ok(startHandler);
  await startHandler({}, ctx);
  const widget = widgetCalls.find((w) => w.id === "ai-lings-evaluations");
  assert.ok(widget, "widget set on boot");
  assert.ok(
    widget.items?.some((i: string) => i.includes("○")),
    "initial shows pending",
  );
});

test("explain displays EXPLANATION.md", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "EXPLANATION.md"), "# Explanation\n");
  const commands = new Map<
    string,
    (args: string, ctx: any) => Promise<void>
  >();
  const notifications: Array<{ message: string; type: string }> = [];
  const pi = {
    on: () => {},
    registerCommand: (
      name: string,
      opts: {
        description: string;
        handler: (args: string, ctx: any) => Promise<void>;
      },
    ) => {
      commands.set(name, opts.handler);
    },
  };
  extension(pi as any);
  const cmd = commands.get("explain");
  assert.ok(cmd);
  await cmd("", {
    cwd,
    ui: {
      notify: (message: string, type: string) =>
        notifications.push({ message, type }),
    },
  });
  assert.deepEqual(notifications, [
    { message: "# Explanation\n", type: "info" },
  ]);
});

test("al-eval warns when config is missing", async () => {
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const notifyLog: string[] = [];
  const pi = {
    on: () => {},
    registerCommand: (
      name: string,
      opts: {
        description: string;
        handler: (args: string, ctx: any) => Promise<void>;
      },
    ) => {
      commands.set(name, opts.handler);
    },
  };
  extension(pi as any);
  const cmd = commands.get("al-eval");
  assert.ok(cmd);
  await cmd("", {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-")),
    ui: { notify: (m: string) => notifyLog.push(m) },
  });
  assert.ok(
    notifyLog.some((n) => n.includes("not enabled")),
    "warns when not configured",
  );
});

test("al-eval warns when EVALUATION.yaml is missing", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "config.json"),
    JSON.stringify({ enabled: true, model: "t/t" }),
  );
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
  const notifyLog: string[] = [];
  const pi = {
    on: () => {},
    registerCommand: (
      name: string,
      opts: {
        description: string;
        handler: (args: string, ctx: any) => Promise<void>;
      },
    ) => {
      commands.set(name, opts.handler);
    },
  };
  extension(pi as any);
  const cmd = commands.get("al-eval");
  assert.ok(cmd);
  await cmd("", { cwd, ui: { notify: (m: string) => notifyLog.push(m) } });
  assert.ok(
    notifyLog.some((n) => n.includes("EVALUATION.yaml")),
    "warns when no yaml",
  );
});
