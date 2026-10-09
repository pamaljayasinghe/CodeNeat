# Contributing to CodeNeat

Thank you for helping. This page tells you how to build, test and extend the extension.

## Set up

You need Node.js 20 or newer and VS Code 1.90 or newer.

```
npm install
npm run build:dev
```

Press **F5** in VS Code to start an Extension Development Host with CodeNeat loaded. `npm run watch` rebuilds on every change.

## Checks

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | TypeScript for the extension, the dashboard and the tests |
| `npm run lint` | ESLint |
| `npm run test:unit` | Unit tests (no formatter needs to be installed) |
| `npm run test:integration` | Runs real formatters against `tests/fixtures`; formatters that are not installed are reported as skipped |
| `npm run test:e2e` | Starts a real VS Code and tests the extension through the VS Code API |
| `npm run package` | Production build, VSIX, and a check of the VSIX contents |
| `npm run test:e2e:vsix` | Installs the VSIX into a throw-away profile and runs the end-to-end tests against it |
| `npm run docs` | Regenerates `docs/languages.md`, `docs/formatters.md` and `docs/options.md` |

A skipped integration test means that language is **not verified** on your machine. Never describe a skipped test as passing.

## Adding a formatter

1. Add an `ExternalSpec` in `src/adapters/tools/`. Declare honestly what the tool supports: `options` for what can be configured (with the native option name), `fixed` for what the tool enforces, and `limitations`.
2. Build the argument list in `build()`. Pass only preferences the user actually chose (`style.num`, `style.str`, `style.bool` return `undefined` otherwise) and pass no style flags when `applyStyle` is false.
3. Register the spec in `src/core/registry.ts` and add it to the language in `src/shared/languages.ts`.
4. Add an argument-mapping test in `tests/unit/mapping.test.ts` and, for a new language, a fixture in `tests/fixtures/<language>/`.
5. Install the tool, run `npm run test:integration`, and only then mark it as executed in `scripts/docs-entry.ts`.
6. Run `npm run docs`.

## Rules that are not negotiable

- **Real formatters only.** No regular-expression "formatting", and no option that no engine implements.
- **No shell.** Every external tool goes through `runTool` in `src/core/process.ts` with an argument array. ESLint enforces this.
- **No network, no telemetry, no automatic installs.**
- **Never modify project configuration files** such as `.prettierrc` or `.clang-format`.
- **Nothing external runs in an untrusted workspace.**
- **Formatting must not change behaviour.** Options that change code are marked `semantic` and default to off.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` …). A pull request should pass `npm run ci`, and should say which formatters you actually ran.
