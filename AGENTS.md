# AGENTS.md

## Purpose

`pi-ai-lings` is a Pi extension intended to support the programming exercises at [notyourlanguage.com](https://notyourlanguage.com).

## Working agreement

- Keep the extension small and exercise-focused.
- Prefer Pi's existing extension APIs and Node.js built-ins over new dependencies.
- Do not add exercise answers, prompts, or site content unless the task explicitly asks for them.
- Keep user-facing behavior documented in `README.md`.
- Update `package.json` when changing the extension entry point, scripts, or runtime requirements.
- Avoid committing credentials, generated files, or local Pi configuration.

## Validation

Before submitting changes:

1. Run `npm test` when tests exist.
2. Run a syntax check for changed JavaScript files, for example `node --check index.js`.
3. Confirm `git diff --check` is clean.

The repository is currently a minimal scaffold. Do not claim that commands or extension behavior work until an entry point and a corresponding check exist.
