# pi-ai-lings

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension that turns guided programming exercises into checkable, rules-enforced sessions. Think "lingo for developers" — you work through exercises at [notyourlanguage.com](https://notyourlanguage.substack.com/) while this extension keeps you honest.

## Anatomy of an exercise

Everything important lives in `.pi/ai-lings/` inside your project root. Here's the full file set:

| File | Purpose | Required?
| --- | --- | ---
| `config.json` | Enable the extension and pick the evaluator model | Yes
| `RULES.md` | Rules the evaluator checks before every prompt you send | Yes (with config)
| `EVALUATION.yaml` | Checklist of objectives the evaluator tracks | No
| `EXPLANATION.md` | The exercise briefing, shown with `/explain` | No

Create only the files you need. A minimal exercise is `config.json` + `RULES.md` — the other two are optional but make the experience much better.

## Install

```sh
pi install /path/to/pi-ai-lings
```

## config.json

A plain JSON file at `.pi/ai-lings/config.json` that controls everything:

```json
{
  "enabled": true,
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

| Field | What it does
|---|---
| `enabled` | `true` = check prompts against rules; `false` = disable the prompt gate, evaluations widget stays display-only
| `model` | Pi model slug (`provider/model-id`) — the model that evaluates your prompts against `RULES.md` and runs `/al-eval`

Remove `config.json` entirely to disable the extension. Set `"enabled": false` to keep the widget visible without blocking prompts — useful when you want to see objectives but aren't ready for strict rule enforcement.

> **Model slugs**: the format is `provider/model-id`. If the model ID itself contains a slash, only the first slash separates the provider. For example `openai/gpt-4o` or `anthropic/claude-sonnet-4-20250514`.

## RULES.md

This is the gate. Every prompt you send to Pi is intercepted and checked against these rules before it reaches the agent. The evaluator model reads `RULES.md`, reads your prompt, and returns a JSON verdict:

```json
{"allow": false, "reason": "Prompt asks for a complete solution instead of a hint."}
```

- `allow: true` → the prompt passes through to the agent normally.
- `allow: false` → the prompt is blocked and a notification shows the reason.

### Writing rules

`RULES.md` is ordinary Markdown. Write rules as plain instructions the evaluator can judge from one prompt:

```markdown
# Rules

1. The user must attempt a solution before asking for hints.
2. The user must not ask for the complete answer.
3. The user must not ask to skip the exercise.
```

Rules work best when they describe behavior the evaluator can detect in a single prompt — "did they ask for the finished code" is easy; "have they practiced enough" is not.

> **Security note**: The evaluator treats both `RULES.md` and your prompt as untrusted data. The rules can't trick the evaluator into bypassing itself.

## EVALUATION.yaml

A YAML checklist of objectives that updates live in the Pi widget. The evaluator agent (a fresh `pi` subprocess with read-only tools) examines your repository and marks each item complete or not.

```yaml
exercise_name: Test Exercise
evaluations:
  - name: Correct AGENTS.md
    show: true
    meet_all: true
    criteria:
      - There must be an AGENTS.md present
      - That AGENTS.md must be relevant to the project
```

| Field | What it means
| --- | ---
| `exercise_name` | Optional label for the exercise (shown in widget)
| `evaluations[]` | List of objectives to check
| `name` | Unique label for this objective
| `show` | When `true`, shows the reason in the widget when this objective isn't met yet
| `meet_all` | `true` = every criterion must pass; `false` or absent = any one criterion is enough
| `criteria` | List of conditions the evaluator checks against the repo

### How evaluation works

The evaluator spawns a new `pi` subprocess with `--tools read,grep,find,ls` and the model you configured. It reads your repo, checks each objective's criteria, and returns a JSON array:

```json
[{"name": "Correct AGENTS.md", "complete": false, "reason": "No AGENTS.md found"}]
```

The widget updates in place:

```
✓  Correct AGENTS.md
○  Has a working build  — package.json has no build script
```

### When evaluation runs

- **Session start**: widget appears with all objectives empty (○).
- **`/al-eval`**: run it anytime for a fresh assessment — especially useful after you've made progress.
- **After every agent turn**: the evaluator re-checks automatically when the agent settles (only if `config.json` is present and enabled).

## EXPLANATION.md

Plain markdown with the exercise briefing. Display it anytime with the `/explain` slash command:

````markdown
# Exercise: Write a FizzBuzz function

Write a function that prints numbers from 1 to n, except:

- Multiples of 3 print "Fizz"
- Multiples of 5 print "Buzz"
- Multiples of both print "FizzBuzz"

Constraints:
- Use only one function
- No external dependencies
```
````

## Making an exercise

Here's the end-to-end flow for creating one. Create each file in `.pi/ai-lings/` inside the exercise project.

### 1. Write the briefing

**`EXPLANATION.md`** — what the learner sees. Include enough context that `/explain` is useful on its own.

### 2. Write the rules

**`RULES.md`** — what the learner is not allowed to do. The gate blocks prompts that violate these. Start with the obvious ones:

```markdown
# Rules

1. The user must attempt a solution before asking for hints.
2. The user must not paste verbatim answers.
3. The user must not ask to skip the exercise.
```

Tighten or loosen based on how your learners actually behave. The evaluator is strict: if a rule says "no complete answers", asking "please write the whole function" gets blocked.

### 3. Write the checklist

**`EVALUATION.yaml`** — how success is measured. Each objective should be independently verifiable by an agent that can read files and grep:

```yaml
exercise_name: FizzBuzz
  - name: Function exists
    show: true
    meet_all: true
    criteria:
      - A function named fizzBuzz exists in a .ts file
  - name: Handles edge cases
    show: true
    meet_all: true
    criteria:
      - fizzBuzz handles n=0 without crashing
      - fizzBuzz handles n=1 correctly
  - name: No external dependencies
    show: false
    meet_all: true
    criteria:
      - package.json has no dependencies beyond what was provided
```

Keep criteria concrete — the evaluator can grep for function names, check files, parse JSON. It can't judge "code is readable" or "follows best practices" reliably.

### 4. Enable the extension

**`config.json`**:

```json
{
  "enabled": true,
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

Pick a model you trust to evaluate rules fairly. Small/cheap models sometimes miss subtle violations — if prompts slip through when they shouldn't, upgrade the model.

### 5. Test it

- Start a Pi session in the exercise project.
- Run `/explain` — the briefing should appear.
- Send a prompt that breaks a rule — it should be blocked with a reason.
- Send a valid prompt — it should pass through.
- Run `/al-eval` — the widget should show objectives matching your repo state.

## Tips

- **Rules are for the prompt, not the code**. The prompt gate can't inspect your files, only what you're about to ask. Use `EVALUATION.yaml` for code-level checks.
- **`show: true` is your friend**. When an objective fails, the learner sees *why*. Without it, they just see ○ with no explanation.
- **Start strict, relax later**. It's easier to loosen a rule that's too tight than to discover a loophole after learners exploit it.
- **The evaluator model matters**. A weak model may accept prompts that break rules or miss obvious code issues. The model you configure runs both the prompt gate and the `/al-eval` checks.
- **`enabled: false` for soft launch**. Deploy the exercise with the gate off, let learners explore, then flip it on once you're confident the rules work.

## Development

Requirements: Node.js >= 22.19.0, Pi

```sh
npm test                      # run focused tests
node --experimental-strip-types --check index.ts   # syntax check
git diff --check              # no whitespace errors
```

## Scope

This extension provides only the prompt gate and evaluation machinery. Exercise instructions and answers live at [notyourlanguage.com](https://notyourlanguage.substack.com/) — this project should not duplicate them without a specific reason.

## License

ISC. See `package.json` for package metadata.
