# pi-ai-lings

A Pi extension for working through the exercises at [notyourlanguage.com](https://notyourlanguage.com). When enabled in a project, it asks a configured model to check each prompt against project rules before Pi sends it to the agent.

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

`RULES.md` is ordinary Markdown containing the rules the evaluator must apply. A prompt is allowed only when the evaluator returns valid JSON with `allow: true`. Missing rules, unknown models, evaluator errors, and malformed evaluator responses reject the prompt rather than bypassing the check.

Disable the check for a project with `"enabled": false` or by removing `config.json`.

## Development

Requirements:

- Node.js
- Pi

Run the focused tests and syntax check with:

```sh
npm test
node --check index.js
git diff --check
```

## Scope

The extension provides only the prompt gate. Exercise instructions and answers remain on [notyourlanguage.com](https://notyourlanguage.com); this project should not duplicate them without a specific reason.

## License

ISC. See `package.json` for package metadata.
