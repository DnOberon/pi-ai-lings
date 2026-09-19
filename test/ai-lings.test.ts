import assert from "node:assert/strict";
import test from "node:test";
import extension, {
  parseVerdict,
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
  assert.deepEqual(readProjectConfig(cwd), { model: "openai/gpt-4o-mini" });
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

  let handler:
    | ((event: { text: string }, ctx: any) => Promise<unknown>)
    | undefined;
  let requested: any;
  const pi = {
    on: (event: string, callback: typeof handler) => {
      assert.equal(event, "input");
      handler = callback;
    },
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
    ui: { notify: () => {} },
  };
  assert.ok(handler);
  assert.deepEqual(await handler({ text: "What tests exist?" }, ctx), {
    action: "continue",
  });
  assert.equal(requested.model.provider, "test");
  assert.match(requested.context.messages[0].content, /What tests exist/);
});
