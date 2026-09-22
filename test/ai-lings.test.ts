import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import extension, {
  buildEvaluationState,
  collectChangedFiles,
  isDirectoryEnabled,
  parseEvaluationResults,
  parseVerdict,
  prepareJevRequestContext,
  readEvaluations,
  readExplanation,
  readUserConfig,
  renderEvaluationStatus,
  splitModelSlug,
  writeUserConfig,
} from "../index.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("enables a directory and its children from the user config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const config = path.join(root, "config.json");
  writeUserConfig({ directories: [root], model: "test/model" }, config);
  assert.deepEqual(readUserConfig(config), {
    directories: [root],
    model: "test/model",
  });
  assert.equal(isDirectoryEnabled(path.join(root, "exercise"), config), true);
  assert.equal(isDirectoryEnabled(`${root}-sibling`, config), false);
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
    "exercise_name: Test\nevaluations:\n  - name: Ready\n    show: true\n    meet_all: true\n    criteria:\n      - A file exists\n",
  );
  assert.deepEqual(readEvaluations(cwd), {
    exerciseName: "Test",
    evaluations: [
      {
        name: "Ready",
        show: true,
        criteria: ["A file exists"],
        meetAll: true,
      },
    ],
  });
});

test("defaults meet_all to false when absent", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "EVALUATION.yaml"),
    "evaluations:\n  - name: Ready\n    show: true\n    criteria: [exists, works]\n  - name: Also ready\n    show: false\n    meet_all: false\n    criteria: [works]\n",
  );

  assert.deepEqual(readEvaluations(cwd)?.evaluations, [
    {
      name: "Ready",
      show: true,
      criteria: ["exists", "works"],
      meetAll: false,
    },
    {
      name: "Also ready",
      show: false,
      criteria: ["works"],
      meetAll: false,
    },
  ]);
});

test("parses complete evaluation results", () => {
  const evaluations = [
    { name: "Ready", show: true, criteria: ["exists"], meetAll: false },
  ];
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

test("builds deterministic A/M/D evaluation state and Jev question context", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-state-"));
  const runGit = (args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });
  runGit(["init", "-q"]);
  fs.writeFileSync(
    path.join(cwd, "modified.ts"),
    "export const before = true;\n",
  );
  fs.writeFileSync(
    path.join(cwd, "deleted.ts"),
    "export const removed = true;\n",
  );
  runGit(["add", "."]);
  runGit([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "initial",
  ]);
  fs.writeFileSync(
    path.join(cwd, "modified.ts"),
    "export const after = true;\n",
  );
  fs.rmSync(path.join(cwd, "deleted.ts"));
  fs.writeFileSync(path.join(cwd, "added.ts"), "export const added = true;\n");

  const state = await buildEvaluationState(cwd, "test/model", {
    summarize: async ({ path: filename, status }) =>
      `${status} summary for ${filename}`,
  });
  assert.deepEqual(state.changed_files, [
    { path: "added.ts", status: "A", summary: "A summary for added.ts" },
    { path: "deleted.ts", status: "D", summary: "D summary for deleted.ts" },
    { path: "modified.ts", status: "M", summary: "M summary for modified.ts" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);

  const request = prepareJevRequestContext(state, {
    exerciseName: "Test",
    evaluations: [
      {
        name: "Ready",
        show: true,
        criteria: ["works", "is tested"],
        meetAll: true,
      },
    ],
  });
  assert.deepEqual(request.questions, [
    { id: "Ready:1", evaluation: "Ready", criterion: "works" },
    { id: "Ready:2", evaluation: "Ready", criterion: "is tested" },
  ]);
});

test("maps Git renames to deleted and added paths", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-state-"));
  const runGit = (args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "ignore" });
  runGit(["init", "-q"]);
  fs.writeFileSync(path.join(cwd, "old.ts"), "export const value = true;\n");
  runGit(["add", "."]);
  runGit([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "initial",
  ]);
  runGit(["mv", "old.ts", "new.ts"]);

  assert.deepEqual(collectChangedFiles(cwd), [
    { path: "new.ts", status: "A" },
    { path: "old.ts", status: "D" },
  ]);
});

test("reuses successful summaries until a file mtime changes", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-state-"));
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  const filename = path.join(cwd, "added.ts");
  fs.writeFileSync(filename, "export const added = true;\n");
  let calls = 0;
  const summarize = async () => {
    calls += 1;
    return `summary ${calls}`;
  };

  assert.equal(
    (await buildEvaluationState(cwd, "test/model", { summarize }))
      .changed_files[0].summary,
    "summary 1",
  );
  assert.equal(
    (await buildEvaluationState(cwd, "test/model", { summarize }))
      .changed_files[0].summary,
    "summary 1",
  );
  fs.utimesSync(filename, new Date(), new Date(Date.now() + 2_000));
  assert.equal(
    (await buildEvaluationState(cwd, "test/model", { summarize }))
      .changed_files[0].summary,
    "summary 2",
  );
  assert.equal(calls, 2);
});

test("does not cache a failed state build", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-state-"));
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  fs.writeFileSync(path.join(cwd, "added.ts"), "export const added = true;\n");
  let calls = 0;
  await assert.rejects(
    buildEvaluationState(cwd, "test/model", {
      summarize: async () => {
        calls += 1;
        throw new Error("failed");
      },
    }),
  );
  await assert.rejects(
    buildEvaluationState(cwd, "test/model", {
      summarize: async () => {
        calls += 1;
        throw new Error("failed again");
      },
    }),
    /failed again/,
  );
  assert.equal(calls, 2);
});

test("rejects empty or failed state summaries instead of inventing one", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-state-"));
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  fs.writeFileSync(path.join(cwd, "added.ts"), "export const added = true;\n");
  await assert.rejects(
    buildEvaluationState(cwd, "test/model", {
      summarize: async () => "",
    }),
    /Summary is empty for added.ts/,
  );
  await assert.rejects(
    buildEvaluationState(cwd, "test/model", {
      summarize: async () => {
        throw new Error("summary subprocess failed");
      },
    }),
    /summary subprocess failed/,
  );
});

test("gates prompts through the configured evaluator model", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  fs.mkdirSync(path.join(cwd, ".pi", "ai-lings"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".pi", "ai-lings", "RULES.md"),
    "Only ask about tests.",
  );
  // Set up user config: enable cwd and set model
  writeUserConfig(
    { directories: [cwd], model: "test/model" },
    path.join(home, ".pi", "agent", "extensions", "ai-lings", "config.json"),
  );

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
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
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("runs evaluations on session start and renders widget", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  fs.mkdirSync(path.join(cwd, ".pi", "ai-lings"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".pi", "ai-lings", "EVALUATION.yaml"),
    "exercise_name: Test\nevaluations:\n  - name: Ready\n    show: true\n    criteria:\n      - Works\n",
  );
  // Set up user config: enable cwd and set model
  const userConfigFile = path.join(
    home,
    ".pi",
    "agent",
    "extensions",
    "ai-lings",
    "config.json",
  );
  writeUserConfig({ directories: [cwd], model: "test/model" }, userConfigFile);

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
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
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("renders running evaluations as a highlighted banner", () => {
  const calls: Array<{ id: string; items?: any; options?: any }> = [];
  const ctx = {
    ui: {
      theme: {
        bold: (text: string) => `<bold>${text}</bold>`,
        bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      },
      setWidget: (id: string, items?: any, options?: any) =>
        calls.push({ id, items, options }),
    },
  };

  renderEvaluationStatus(ctx as any, true);
  assert.deepEqual(calls[0], {
    id: "ai-lings-eval-status",
    items: [
      "<toolPendingBg><bold> Running evaluations… </bold></toolPendingBg>",
    ],
    options: { placement: "aboveEditor" },
  });

  renderEvaluationStatus(ctx as any, false);
  assert.deepEqual(calls[1], {
    id: "ai-lings-eval-status",
    items: undefined,
    options: { placement: "aboveEditor" },
  });
});

test("explain displays EXPLANATION.md", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const directory = path.join(cwd, ".pi", "ai-lings");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "EXPLANATION.md"), "# Explanation\n");
  const commands = new Map<string, (args: string, ctx: any) => Promise<void>>();
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

test("al-eval keeps the UI flow without running evaluation logic", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  fs.mkdirSync(path.join(cwd, ".pi", "ai-lings"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, ".pi", "ai-lings", "EVALUATION.yaml"),
    `exercise_name: Test
evaluations:
  - name: Ready
    show: true
    criteria:
      - A file exists
`,
  );
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    writeUserConfig(
      { directories: [cwd], model: "test/model" },
      path.join(home, ".pi", "agent", "extensions", "ai-lings", "config.json"),
    );
    const commands = new Map<
      string,
      (args: string, ctx: any) => Promise<void>
    >();
    const notifications: string[] = [];
    const widgets: Array<{ id: string; items?: any }> = [];
    const pi = {
      on: () => {},
      registerCommand: (
        name: string,
        opts: { handler: (args: string, ctx: any) => Promise<void> },
      ) => commands.set(name, opts.handler),
    };
    extension(pi as any);
    await commands.get("al-eval")!("", {
      cwd,
      ui: {
        notify: (message: string) => notifications.push(message),
        setWidget: (id: string, items?: any) => widgets.push({ id, items }),
        theme: {
          bold: (text: string) => text,
          bg: (_color: string, text: string) => text,
        },
      },
    });
    assert.ok(notifications.includes("Evaluation logic is not implemented"));
    assert.deepEqual(
      widgets.find((widget) => widget.id === "ai-lings-evaluations")?.items,
      ["Evaluation Criteria: Test", "○ Ready"],
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("commands persist enabled directories and the evaluator model", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const commands = new Map<
      string,
      (args: string, ctx: any) => Promise<void>
    >();
    const notifications: string[] = [];
    const pi = {
      on: () => {},
      registerCommand: (
        name: string,
        opts: { handler: (args: string, ctx: any) => Promise<void> },
      ) => commands.set(name, opts.handler),
    };
    extension(pi as any);
    const ctx = {
      cwd,
      ui: { notify: (message: string) => notifications.push(message) },
    };

    await commands.get("al-enable")!("", ctx);
    await commands.get("al-model")!("test/model", ctx);

    const configFile = path.join(
      home,
      ".pi",
      "agent",
      "extensions",
      "ai-lings",
      "config.json",
    );
    const config = readUserConfig(configFile);
    assert.deepEqual(config, { directories: [cwd], model: "test/model" });
    assert.equal(isDirectoryEnabled(cwd, configFile), true);

    await commands.get("al-disable")!("", ctx);
    assert.deepEqual(readUserConfig(configFile), {
      directories: [],
      model: "test/model",
    });
    assert.equal(notifications.length, 3);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("al-eval warns when EVALUATION.yaml is missing", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  fs.mkdirSync(path.join(cwd, ".pi", "ai-lings"), { recursive: true });
  // Set up user config so the directory is enabled and model is set
  const userConfigFile = path.join(
    home,
    ".pi",
    "agent",
    "extensions",
    "ai-lings",
    "config.json",
  );
  writeUserConfig({ directories: [cwd], model: "t/t" }, userConfigFile);

  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const commands = new Map<
      string,
      (args: string, ctx: any) => Promise<void>
    >();
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
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});
