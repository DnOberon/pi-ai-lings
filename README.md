# pi-ai-lings

A [Pi](https://github.com/earendil-works/pi-coding-agent) extension that turns guided programming exercises into checkable, rules-enforced sessions. Work through exercises introduced at [notyourlanguage.com](https://notyourlanguage.com/AI-Lings/Coming+Soon!) (or create your own) and the extension checks your work.

## Anatomy of an exercise

Exercise configuration lives in `.pi/ai-lings/` inside your project root. Here's the full file set:

| File | Purpose | Required?
| --- | --- | ---
| `RULES.md` | Rules the evaluator checks before every prompt you send | Yes (when enabled)
| `EVALUATION.yaml` | Checklist of objectives the evaluator tracks | No
| `EXPLANATION.md` | The exercise briefing, shown with `/explain` | No

Create only the files you need. A minimal exercise is `RULES.md`; enable its directory with `/al-enable`. The other files are optional.

## Install

```sh
pi install /path/to/pi-ai-lings
# or direct from npm
pi install npm:pi-ai-lings
```

## Enabling directories and choosing a model

The extension-root config at `~/.pi/agent/extensions/ai-lings/config.json` stores enabled directories and the evaluator model:

```json
{
  "directories": ["/home/me/exercises"],
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

Use these commands from Pi:

- `/al-enable [directory]` adds a directory (or the current directory) and its children.
- `/al-disable [directory]` removes a directory (or the current directory).
- `/al-model [provider/model]` records the model used for prompt checks and automatic evaluations. Leave empty to capture the current Pi session model automatically.

A project is enabled when its current directory is inside an enabled directory in the user config.

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

Rules work best when they describe behavior the evaluator can detect in a single prompt. "Did they ask for the finished code" is easy; "have they practiced enough" is not.

> **Security note**: The evaluator treats both `RULES.md` and your prompt as untrusted data. The rules can't trick the evaluator into bypassing itself.

## EVALUATION.yaml

A YAML checklist of objectives used by the evaluator agent (a fresh `pi` subprocess with read-only tools) to examine your repository and mark each item complete or not. When ai-lings is enabled for the current directory, the exercise status appears in the powerline as `Complete` or `Incomplete`.

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

### Evaluation state for Jev

`/al-state` builds a bounded, JSON-serializable state artifact for future Jev/OpenRouter Decisions requests. Its stable shape is:

```json
{
  "changed_files": [
    { "path": "src/example.ts", "status": "M", "summary": "..." }
  ]
}
```

The artifact includes every added, modified, or deleted file reported by the repository's Git status, in deterministic path order. Summaries are generated through a read-only Pi subprocess; full diffs and file contents are not included in the artifact. Evaluation criteria are exposed as future criterion-level question context, but this extension does not submit questions, call OpenRouter, run a Jev decision loop, or change evaluation verdicts.

### When evaluation runs

- **Session start**: an enabled directory shows `Incomplete` in the powerline until evaluation results are complete.
- **`/al-eval`**: resets the status to `Incomplete` and currently reports that evaluation logic is unavailable.
- **After every agent turn**: the evaluator re-checks automatically when the agent settles (only if the directory is enabled).

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

**`EXPLANATION.md`**. The exercise briefing. Include enough context that `/explain` is useful on its own.

### 2. Write the rules

**`RULES.md`**. The gate blocks prompts that violate these. Start with the obvious ones:

```markdown
# Rules

1. The user must attempt a solution before asking for hints.
2. The user must not paste verbatim answers.
3. The user must not ask to skip the exercise.
```

Tighten or loosen based on how your learners actually behave. The evaluator is strict: if a rule says "no complete answers", asking "please write the whole function" gets blocked.

### 3. Write the checklist

**`EVALUATION.yaml`**. Each objective should be independently verifiable by an agent that can read files and grep:

```yaml
exercise_name: FizzBuzz
evaluations:
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

Keep criteria concrete. The evaluation is a work in progress and is currently very non-deterministic.

### 4. Enable the extension

From the exercise directory, run `/al-enable` and set the evaluator with `/al-model provider/model`. These settings are stored in `~/.pi/agent/extensions/ai-lings/config.json`, so they apply to the chosen directory tree without adding user-specific settings to the exercise repository.

Pick a model you trust to evaluate rules fairly. Small/cheap models sometimes miss subtle violations. If prompts slip through when they shouldn't, upgrade the model.

### 5. Test it

- Start a Pi session in the exercise project.
- Run `/explain`. The briefing should appear.
- Send a prompt that breaks a rule. It should be blocked with a reason.
- Send a valid prompt. It should pass through.
- Run `/al-eval`. The widget should show objectives matching your repo state.

## Tips

- **Rules are for the prompt, not the code**. The prompt gate can't inspect your files, only what you're about to ask. Use `EVALUATION.yaml` for code-level checks.
- **`show: true` is your friend**. When an objective fails, the learner sees *why*. Without it, they just see ○ with no explanation.
- **Start strict, relax later**. It's easier to loosen a rule that's too tight than to discover a loophole after learners exploit it.
- **The evaluator model matters**. A weak model may accept prompts that break rules or miss obvious code issues. The model you configure runs the prompt gate and automatic evaluation checks.
- **`enabled: false` for soft launch**. Deploy the exercise with the gate off, let learners explore, then flip it on once you're confident the rules work.

## Development

Requirements: Node.js >= 22.19.0, Pi

```sh
npm test                      # run focused tests
node --experimental-strip-types --check index.ts   # syntax check
git diff --check              # no whitespace errors
```

## Scope

This extension provides only the prompt gate and evaluation machinery. Exercise instructions live at [notyourlanguage.com](https://notyourlanguage.com/AI-Lings/Coming+Soon!). This project should not duplicate them without a specific reason.

## License

ISC. See `package.json` for package metadata.
