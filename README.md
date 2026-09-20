# pi-ai-lings

A Pi extension for working through the exercises at [notyourlanguage.com](https://notyourlanguage.substack.com/). When enabled in a project, it asks a configured model to check each prompt against project rules before Pi sends it to the agent.

## Project setup

Install this extension in Pi from the repository:

```sh
pi install /path/to/pi-ai-lings
```

Create `.pi/ai-lings/config.json` and `.pi/ai-lings/RULES.md` in the project where the extension should run:

```json
{
  "enabled": true,
  "model": "provider/model-id"
}
```

`model` is a Pi model slug: the provider name, a slash, and the model ID. For model IDs containing slashes, only the first slash separates the provider.

### EVALUATION.yaml

Optionally create `.pi/ai-lings/EVALUATION.yaml` to track exercise objectives as a live checklist:

```yaml
exercise_name: Test Exercise
evaluations:
  - name: Correct AGENTS.md
    show: true
    criteria:
      - There must be an AGENTS.md present
      - That AGENTS.md must be relevant to the project
```

- `name` — unique label for the objective.
- `show` — when `true`, displays the reason why the objective failed or is incomplete.
- `criteria` — list of conditions the evaluator model assesses.

### Evaluating objectives with `/al-eval`

Run `/al-eval` to evaluate all objectives against the current prompt and repository state (git, AGENTS.md). The widget updates in place — ✓ for complete, ○ for incomplete with a short reason.

On session start the widget appears empty (all ○). Run `/al-eval` whenever you want a fresh assessment. The evaluator receives the evaluation document, repository facts, and the last prompt sent to the agent.

### EXPLANATION.md

Create `.pi/ai-lings/EXPLANATION.md` to document the current exercise. Run `/explain` to display it in the Pi window.

`RULES.md` is ordinary Markdown containing the rules the evaluator must apply. A prompt is allowed only when the evaluator returns valid JSON with `allow: true`. Missing rules, unknown models, evaluator errors, and malformed evaluator responses reject the prompt rather than bypassing the check.

Disable the prompt check and evaluator for a project with `"enabled": false`; the Evaluation Criteria widget remains display-only. Removing `config.json` disables the extension entirely.

## Development

Requirements:

- Node.js
- Pi

Run the focused tests and syntax check with:

```sh
npm test
node --experimental-strip-types --check index.ts
git diff --check
```

## Scope

The extension provides only the prompt gate. Exercise instructions and answers remain on [notyourlanguage.com](https://notyourlanguage.substack.com/); this project should not duplicate them without a specific reason.

## License

ISC. See `package.json` for package metadata.
