# Architecture

CodeNeat has three layers. Only the outer one knows about VS Code, which keeps the formatting logic testable without an editor.

```
webview/src        React dashboard (browser)          ← talks to the host by validated messages
src/vscode         VS Code layer: providers, commands, dashboard host, workspace formatting
src/core           Formatting service, registry, process runner, project config, edits
src/adapters       One adapter per formatter
src/shared         Types, option catalog, languages, profiles, style resolution, validation
```

`src/shared` is imported by both the extension host and the dashboard, so both resolve styles with the same code.

## Main pieces

| Piece | File | Job |
| --- | --- | --- |
| Option catalog | `src/shared/catalog.ts` | Every preference CodeNeat knows, with plain-language labels. An option exists only if some formatter implements it. |
| Language detector | `src/shared/languages.ts` | Maps a VS Code language id and file name to a CodeNeat language. |
| Capability model | `FormatterDescriptor` in `src/shared/types.ts` | What each formatter supports: options and their native names, accepted values, defaults, fixed behaviour, range support, config files, limitations. The dashboard is driven by it. |
| Style resolution | `src/shared/resolve.ts` | Applies the precedence rules and records the source of every value. |
| Registry and resolver | `src/core/registry.ts`, `chooseFormatter` | Holds the adapters and picks one per language. |
| Formatting service | `src/core/formattingService.ts` | One formatting run: size check, formatter choice, project config, style, engine, line endings, safety checks. |
| Process runner | `src/core/process.ts` | The only place that starts processes. No shell, with timeout, cancellation and output limits. |
| Prettier adapters | `src/adapters/prettier.ts` | In-process Prettier and plugins; uses a project's own Prettier 3 in trusted workspaces. |
| External adapters | `src/adapters/external.ts`, `src/adapters/tools/*` | A generic adapter plus one declarative spec per tool. |
| Configuration manager | `src/vscode/configuration.ts` | Reads and writes settings through VS Code's configuration API. |
| Providers | `src/vscode/providers.ts` | Document, range and on-type formatting providers. |
| Dashboard | `src/vscode/dashboard.ts`, `webview/src` | Webview host and React UI. The UI edits a draft; Apply sends it to the host. |
| Workspace formatting | `src/core/workspaceScan.ts`, `src/vscode/workspaceFormat.ts` | Scan, dry run, review, confirm, write. |
| Diagnostics | `src/vscode/diagnostics.ts` | The diagnostics report. |

## Design decisions

- **Formatters receive only what the user chose.** Values that merely equal a formatter's default are not passed, so base styles and tool defaults keep working.
- **A formatter's own config file takes over.** For tools that read their config file themselves, CodeNeat passes no style flags when such a file exists.
- **Small edits.** Results are turned into line-level edits so the cursor, selections and undo history behave as with any VS Code formatter.
- **Runtime modules stay unbundled.** Prettier, its plugins, sql-formatter and editorconfig ship as `node_modules` in the VSIX because several are ESM-only or load WebAssembly files at runtime. Everything else is bundled with esbuild.
