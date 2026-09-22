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
  renderExerciseStatus,
  splitModelSlug,
  writeUserConfig,
  buildJevRequest,
  parseJevResponse,
  parseFallbackResponse,
  aggregateCriteria,
  formatSummary,
  resolveOpenRouterCredential,
  jevEvaluate,
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

test("shows incomplete exercise status on session start", async () => {
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
    const statusCalls: Array<{ id: string; value?: string }> = [];
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
        setWidget: () => {},
        setStatus: (id: string, value?: string) => {
          statusCalls.push({ id, value });
        },
      },
    };

    // session_start sets an initial incomplete powerline status.
    const startHandler = handlers.get("session_start");
    assert.ok(startHandler);
    await startHandler({}, ctx);
    assert.deepEqual(statusCalls, [
      { id: "ai-lings-exercise", value: "ai-lings exercise: Incomplete" },
    ]);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
});

test("renders exercise completion in the powerline", () => {
  const calls: Array<{ id: string; value?: string }> = [];
  const ctx = {
    ui: {
      setStatus: (id: string, value?: string) => calls.push({ id, value }),
    },
  };

  renderExerciseStatus(
    ctx as any,
    true,
    new Map([["Ready", { complete: true, reason: "" }]]),
  );
  renderExerciseStatus(ctx as any, true);
  renderExerciseStatus(ctx as any, false);

  assert.deepEqual(calls, [
    { id: "ai-lings-exercise", value: "ai-lings exercise: Complete" },
    { id: "ai-lings-exercise", value: "ai-lings exercise: Incomplete" },
    { id: "ai-lings-exercise", value: undefined },
  ]);
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

test("al-eval runs evaluation with Jev or fallback", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-home-"));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ai-lings-"));
  // Create EVALUATION.yaml first, then commit so git state is clean
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
  // Initialize git and commit everything so no changed files need summarizing
  execFileSync("git", ["init", "-q"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", ".pi"], { cwd, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.name=T", "-c", "user.email=t@t.com", "commit", "-qm", "init"],
    { cwd, stdio: "ignore" },
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
    const statusCalls: Array<{ id: string; value?: string }> = [];
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
      modelRegistry: {
        getApiKeyForProvider: async () => undefined,
      },
      signal: new AbortController().signal,
      ui: {
        notify: (message: string) => notifications.push(message),
        setWidget: () => {},
        setStatus: (id: string, value?: string) =>
          statusCalls.push({ id, value }),
        theme: {
          bold: (text: string) => text,
          bg: (_color: string, text: string) => text,
        },
      },
    });
    // Should not contain the placeholder message
    assert.ok(!notifications.includes("Evaluation logic is not implemented"));
    // Should produce a notification (evaluator path or error)
    assert.ok(
      notifications.length > 0,
      `expected notifications, got: ${JSON.stringify(notifications)}`,
    );
    // Should update the exercise status widget
    assert.ok(
      statusCalls.some((s) => s.id === "ai-lings-exercise"),
      `expected ai-lings-exercise in statusCalls, got: ${JSON.stringify(statusCalls)}, notifications: ${JSON.stringify(notifications)}`,
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

// --- New evaluation flow tests ---

test("buildJevRequest creates one noul question per criterion", () => {
  const questions = prepareJevRequestContext(
    { changed_files: [{ path: "a.ts", status: "M", summary: "modified a" }] },
    {
      exerciseName: "T",
      evaluations: [
        {
          name: "R1",
          show: true,
          criteria: ["works", "tested"],
          meetAll: true,
        },
        { name: "R2", show: false, criteria: ["exists"], meetAll: false },
      ],
    },
  );
  const req = buildJevRequest(questions);
  assert.equal(typeof req.model, "string");
  assert.equal(Object.keys(req.questions).length, 3);
  assert.ok(req.questions["R1:1"]);
  assert.equal(
    req.questions["R1:1"].noul.affirmative.includes('"works"'),
    true,
  );
  assert.equal(req.questions["R1:1"].noul.negative.includes('"works"'), true);
  assert.ok(req.questions["R1:2"]);
  assert.ok(req.questions["R2:1"]);
  assert.equal(req.state.changed_files.length, 1);
});

test("parseJevResponse maps probabilities through 0.9 threshold", () => {
  const questions = [
    { id: "R:1", evaluation: "R", criterion: "works" },
    { id: "R:2", evaluation: "R", criterion: "tested" },
  ];
  const body = {
    answers: {
      "R:1": { noul: 0.95 },
      "R:2": { noul: 0.5 },
    },
  };
  const results = parseJevResponse(body, questions);
  assert.ok(results);
  assert.equal(results.length, 2);
  assert.equal(results[0].passed, true);
  assert.equal(results[0].probability, 0.95);
  assert.equal(results[1].passed, false);
  assert.equal(results[1].probability, 0.5);
});

test("parseJevResponse rejects missing, malformed, and out of range answers", () => {
  const questions = [{ id: "R:1", evaluation: "R", criterion: "works" }];
  // Missing answer for a question
  assert.equal(parseJevResponse({ answers: {} }, questions), null);
  // Non-numeric noul
  assert.equal(
    parseJevResponse({ answers: { "R:1": { noul: "high" } } }, questions),
    null,
  );
  // noul > 1
  assert.equal(
    parseJevResponse({ answers: { "R:1": { noul: 1.5 } } }, questions),
    null,
  );
  // noul < 0
  assert.equal(
    parseJevResponse({ answers: { "R:1": { noul: -0.1 } } }, questions),
    null,
  );
  // Non-finite
  assert.equal(
    parseJevResponse({ answers: { "R:1": { noul: Infinity } } }, questions),
    null,
  );
  // Empty answers object
  assert.equal(parseJevResponse(null, questions), null);
  assert.equal(parseJevResponse(undefined as any, questions), null);
  assert.equal(parseJevResponse("not json" as any, questions), null);
});

test("parseJevResponse handles exact threshold boundary", () => {
  const questions = [{ id: "R:1", evaluation: "R", criterion: "works" }];
  const above = parseJevResponse(
    { answers: { "R:1": { noul: 0.9 } } },
    questions,
  );
  assert.ok(above);
  assert.equal(above[0].passed, true);
  const below = parseJevResponse(
    { answers: { "R:1": { noul: 0.899 } } },
    questions,
  );
  assert.ok(below);
  assert.equal(below![0].passed, false);
});

test("parseJevResponse rejects unknown answer IDs", () => {
  const questions = [{ id: "R:1", evaluation: "R", criterion: "works" }];
  assert.equal(
    parseJevResponse(
      { answers: { "R:1": { noul: 0.95 }, unknown: { noul: 0.99 } } },
      questions,
    ),
    null,
  );
});

test("parseJevResponse rejects duplicate answer IDs", () => {
  // duplicate IDs can't actually occur in valid JSON keys, but test that
  // malformed answers with extra entries for a requested ID still fail
  const questions = [
    { id: "R:1", evaluation: "R", criterion: "works" },
    { id: "R:2", evaluation: "R", criterion: "tested" },
  ];
  assert.equal(
    parseJevResponse({ answers: { "R:1": { noul: 0.95 } } }, questions),
    null,
  );
});

test("aggregateCriteria handles meetAll true vs false", () => {
  const evals = [
    { name: "All", criteria: ["a", "b"], meetAll: true },
    { name: "Any", criteria: ["c", "d"], meetAll: false },
  ];
  const criteria = [
    {
      questionId: "All:1",
      evaluation: "All",
      criterion: "a",
      passed: true,
      reason: "",
    },
    {
      questionId: "All:2",
      evaluation: "All",
      criterion: "b",
      passed: false,
      reason: "miss",
    },
    {
      questionId: "Any:1",
      evaluation: "Any",
      criterion: "c",
      passed: false,
      reason: "nope",
    },
    {
      questionId: "Any:2",
      evaluation: "Any",
      criterion: "d",
      passed: true,
      reason: "",
    },
  ];
  const { statuses, failedCriteria } = aggregateCriteria(criteria, evals);
  assert.equal(statuses.get("All")?.complete, false);
  assert.equal(statuses.get("Any")?.complete, true);
  assert.equal(failedCriteria.length, 1);
  assert.equal(failedCriteria[0].evaluation, "All");
});

test("aggregateCriteria all-pass produces complete", () => {
  const evals = [{ name: "X", criteria: ["a"], meetAll: true }];
  const criteria = [
    {
      questionId: "X:1",
      evaluation: "X",
      criterion: "a",
      passed: true,
      reason: "",
    },
  ];
  const { statuses } = aggregateCriteria(criteria, evals);
  assert.equal(statuses.get("X")?.complete, true);
});

test("aggregateCriteria all-fail produces incomplete", () => {
  const evals = [{ name: "X", criteria: ["a", "b"], meetAll: false }];
  const criteria = [
    {
      questionId: "X:1",
      evaluation: "X",
      criterion: "a",
      passed: false,
      reason: "no",
    },
    {
      questionId: "X:2",
      evaluation: "X",
      criterion: "b",
      passed: false,
      reason: "no",
    },
  ];
  const { statuses } = aggregateCriteria(criteria, evals);
  assert.equal(statuses.get("X")?.complete, false);
});

test("aggregateCriteria handles empty criteria with natural semantics", () => {
  // every([]) is vacuously true
  const evalsMeetAll = [{ name: "X", criteria: [], meetAll: true }];
  const { statuses: s1 } = aggregateCriteria([], evalsMeetAll);
  assert.equal(s1.get("X")?.complete, true);
  // some([]) is false
  const evalsMeetAny = [{ name: "Y", criteria: [], meetAll: false }];
  const { statuses: s2 } = aggregateCriteria([], evalsMeetAny);
  assert.equal(s2.get("Y")?.complete, false);
});

test("aggregateCriteria reports failed criteria with parent evaluation", () => {
  const evals = [
    { name: "Ready", criteria: ["works", "tested"], meetAll: true },
  ];
  const criteria = [
    {
      questionId: "Ready:1",
      evaluation: "Ready",
      criterion: "works",
      passed: true,
      reason: "",
    },
    {
      questionId: "Ready:2",
      evaluation: "Ready",
      criterion: "tested",
      passed: false,
      reason: "not tested",
    },
  ];
  const { statuses, failedCriteria } = aggregateCriteria(criteria, evals);
  assert.equal(statuses.get("Ready")?.complete, false);
  assert.match(statuses.get("Ready")?.reason ?? "", /not tested/);
  assert.equal(failedCriteria.length, 1);
  assert.equal(failedCriteria[0].evaluation, "Ready");
});

test("formatSummary reports evaluator path and failures", () => {
  const statuses = new Map([
    ["R1", { complete: true, reason: "All criteria satisfied" }],
    ["R2", { complete: false, reason: "Failed: R2:1 — missing" }],
  ]);
  const failedCriteria = [
    {
      questionId: "R2:1",
      evaluation: "R2",
      criterion: "exists",
      passed: false,
      reason: "missing",
    },
  ];
  const summary = formatSummary("jev", statuses, failedCriteria);
  assert.match(summary, /Jev/);
  assert.match(summary, /1\/2/);
  assert.match(summary, /R2:1/);
});

test("formatSummary shows Pi fallback label", () => {
  const s = formatSummary("fallback", new Map(), []);
  assert.match(s, /Pi fallback/);
});

test("formatSummary shows unavailable label", () => {
  const s = formatSummary("unavailable", new Map(), []);
  assert.match(s, /Unavailable/);
});

test("parseFallbackResponse handles valid output", () => {
  const questions = [{ id: "R:1", evaluation: "R", criterion: "works" }];
  const text = JSON.stringify({
    "R:1": { passed: true, reason: "works fine" },
  });
  const results = parseFallbackResponse(text, questions);
  assert.ok(results);
  assert.equal(results.length, 1);
  assert.equal(results[0].passed, true);
  assert.equal(results[0].reason, "works fine");
});

test("parseFallbackResponse strips markdown fences", () => {
  const questions = [{ id: "R:1", evaluation: "R", criterion: "works" }];
  const text =
    "```json\n" +
    JSON.stringify({ "R:1": { passed: false, reason: "nope" } }) +
    "\n```";
  const results = parseFallbackResponse(text, questions);
  assert.ok(results);
  assert.equal(results[0].passed, false);
});

test("parseFallbackResponse rejects unknown IDs", () => {
  const questions = [{ id: "R:1", evaluation: "R", criterion: "works" }];
  const text = JSON.stringify({
    "R:1": { passed: true, reason: "" },
    unknown: { passed: false, reason: "" },
  });
  assert.equal(parseFallbackResponse(text, questions), null);
});

test("parseFallbackResponse rejects missing question IDs", () => {
  const questions = [
    { id: "R:1", evaluation: "R", criterion: "works" },
    { id: "R:2", evaluation: "R", criterion: "tested" },
  ];
  const text = JSON.stringify({ "R:1": { passed: true, reason: "" } });
  assert.equal(parseFallbackResponse(text, questions), null);
});

test("parseFallbackResponse rejects non-boolean passed", () => {
  const questions = [{ id: "R:1", evaluation: "R", criterion: "works" }];
  assert.equal(
    parseFallbackResponse(
      JSON.stringify({ "R:1": { passed: "yes", reason: "" } }),
      questions,
    ),
    null,
  );
});

test("resolveOpenRouterCredential uses registry first", async () => {
  const registry = {
    getApiKeyForProvider: async (provider: string) => {
      assert.equal(provider, "openrouter");
      return "sk-registry-key";
    },
  };
  const result = await resolveOpenRouterCredential(registry);
  assert.equal(result.ok, true);
  assert.equal((result as any).apiKey, "sk-registry-key");
});

test("resolveOpenRouterCredential falls back to env var", async () => {
  const prev = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-env-key";
  try {
    const result = await resolveOpenRouterCredential({});
    assert.equal(result.ok, true);
    assert.equal((result as any).apiKey, "sk-env-key");
  } finally {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  }
});

test("resolveOpenRouterCredential returns error when no credential", async () => {
  const prev = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const result = await resolveOpenRouterCredential({});
    assert.equal(result.ok, false);
    assert.match((result as any).error, /No OpenRouter credential/);
  } finally {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
  }
});

test("jevEvaluate sends correct request and parses response", async () => {
  const context = prepareJevRequestContext(
    { changed_files: [] },
    {
      evaluations: [
        { name: "R", show: true, criteria: ["works"], meetAll: true },
      ],
    },
  );
  // Mock fetch to return a valid response
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: unknown;
  let capturedHeaders: Record<string, string> = {};
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = typeof url === "string" ? url : url.toString();
    capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(
      JSON.stringify({
        answers: { "R:1": { noul: 0.95 } },
      }),
      { status: 200 },
    );
  };
  try {
    const result = await jevEvaluate(context, { ok: true, apiKey: "test-key" });
    assert.ok("results" in result);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].passed, true);
    assert.match(capturedUrl, /openrouter/);
    assert.equal(capturedHeaders["Authorization"], "Bearer test-key");
    assert.ok(capturedBody);
    assert.equal((capturedBody as any).model, "typesafe/jev-1.13");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jevEvaluate returns error on HTTP failure", async () => {
  const context = prepareJevRequestContext(
    { changed_files: [] },
    {
      evaluations: [
        { name: "R", show: true, criteria: ["works"], meetAll: true },
      ],
    },
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });
  try {
    const result = await jevEvaluate(context, { ok: true, apiKey: "bad" });
    assert.ok("error" in result);
    assert.match(result.error, /401/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("jevEvaluate returns error when not authenticated", async () => {
  const context = prepareJevRequestContext(
    { changed_files: [] },
    {
      evaluations: [
        { name: "R", show: true, criteria: ["works"], meetAll: true },
      ],
    },
  );
  const result = await jevEvaluate(context, { ok: false, error: "no key" });
  assert.ok("error" in result);
});
