# CodeNeat

**One Extension. Every Language. Your Style.**

CodeNeat is a multi-language code formatter for Visual Studio Code. It formats 41 languages and file formats through their official formatting engines, and replaces hand-edited configuration files with a visual settings dashboard and a live before/after preview.

## Highlights

- **32 languages ready on install.** HTML, CSS, SCSS, Less, JavaScript, TypeScript, JSX, TSX, JSON, YAML, Markdown, MDX, Vue, Angular templates, GraphQL, XML, Java, Python, C, C++, C#, PHP, Go, Dart, Bash, Lua, SQL, TOML, Dockerfile, Protocol Buffers and LaTeX format out of the box. The engines (Prettier, Ruff, gofmt, clang-format, StyLua, shfmt, dart format and others) are built in. No other extension is required.
- **Guided setup for the rest.** Rust, Ruby, Kotlin, Scala, Swift, F#, PowerShell, R and Terraform use the formatter that belongs to their toolchain. When one is missing, CodeNeat offers to install it: you see the exact command, confirm, and it runs in a terminal.
- **Your style, without JSON.** Set line length, indentation, quotes, semicolons, braces and more from a searchable dashboard. Apply a preference to every language or to one, for yourself or for the whole workspace.
- **See it before you save it.** The live preview runs the real formatter on sample code or on your current file and highlights every changed line.
- **Respects your project.** `.editorconfig`, `.prettierrc`, `.clang-format`, `rustfmt.toml` and similar files take priority by default and are never modified.
- **Private.** No account, no telemetry, no network requests. Your code stays on your computer.

## Getting started

1. Open a supported file.
2. Click the **CodeNeat button** at the top right of the editor. The formatted code appears with every change highlighted in green; choose **Keep Changes** or **Undo Changes**.
3. To choose your style, click the **CodeNeat** icon in the Activity Bar (or run **CodeNeat: Open Settings**), change a preference, watch the live preview, and press **Apply**.
4. To format on every save, open **Auto Formatting**, make CodeNeat the default formatter, and switch on **Format on Save**.

## Ways to format

| Way              | How                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Editor button | The CodeNeat button at the top right of the editor. It shows the changes highlighted in the file and asks before keeping them. |
| Keyboard         | `Ctrl+Alt+Shift+F` (Windows, Linux) or `⌘+⌥+⇧+F` (macOS).                                   |
| Right-click menu | **CodeNeat: Format Document**, **Format Selection** or **Format Document with Review**.     |
| Status bar       | Click **CodeNeat** at the bottom right for a menu of actions.                               |
| Automatically    | Format on Save, on Paste and on Type.                                                       |
| With review      | See the changes highlighted in the editor, then press Enter to keep them or Escape to undo. |

Every button, menu entry and automatic behaviour can be switched off: see **Settings → Advanced → Buttons, menus and on/off**, or the [user guide](docs/usage.md#switch-things-off). The master switch `codeneat.enabled` turns CodeNeat off entirely, for everything or for a single workspace.

## What you can do

| Feature                   | Details                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visual settings dashboard | 15 sections, searchable, with switches, sliders, dropdowns, tooltips, defaults, reset buttons, Apply and Cancel. Follows your light, dark or high-contrast theme and is fully usable from the keyboard.                                                                                                                                                                                                       |
| Line length               | 60, 80, 100, 120, 140, 160 or any value from 40 to 300. The default is 120.                                                                                                                                                                                                                                                                                                                                   |
| Indentation               | Spaces or tabs; 2, 4, 8 or a custom size; continuation and switch/case indentation where the formatter offers them.                                                                                                                                                                                                                                                                                           |
| Style options             | Quotes, semicolons, trailing commas, brace position, spacing, blank lines, import sorting and language-specific options, each offered only where the formatter really supports it.                                                                                                                                                                                                                            |
| Per-language settings     | Every preference can apply to all languages or to one language, in your own settings or in the workspace.                                                                                                                                                                                                                                                                                                     |
| Profiles                  | Standard, Compact, Readable and Team Style are built in. Create, edit, duplicate, rename, delete, import and export your own, and assign one per language or per workspace.                                                                                                                                                                                                                                   |
| Live preview              | Side-by-side original and formatted code with syntax highlighting and changed-line highlighting. It follows your settings and your file as you edit.                                                                                                                                                                                                                                                          |
| Review before changing    | **Format Document with Review** shows the formatted code right in your editor with every changed line highlighted; hover a line to see what it replaced, press Enter to keep the changes or Escape to undo them. **Preview Formatting** opens a live side-by-side diff that updates while you type. **Review Changes on Save** tells you what would change after each save and formats only when you approve. |
| Formatting                | Format Document, Format Selection, Format on Save, Format on Paste and Format on Type through VS Code's native formatting system, with normal undo and redo.                                                                                                                                                                                                                                                  |
| Workspace formatting      | Format a whole folder: preview the affected files, confirm, watch progress, cancel at any time, and read a summary. `node_modules`, build output, generated and binary files and everything in `.gitignore` are skipped.                                                                                                                                                                                      |
| Formatter management      | See which formatters are installed, their version and location, and how to install the missing ones.                                                                                                                                                                                                                                                                                                          |
| Project configuration     | `.editorconfig`, `.prettierrc`, `.clang-format`, `rustfmt.toml` and similar files are respected by default and never modified. The dashboard shows which source controls each option.                                                                                                                                                                                                                         |

## How CodeNeat formats

CodeNeat delegates all formatting to established, language-aware engines. This keeps results correct and consistent with the wider ecosystem, and it shapes how the settings behave:

- **Options reflect each engine.** A preference is offered for a language only when its formatter implements it. Controls that do not apply are disabled with an explanation, and the dashboard points to an alternative formatter when one offers more options.
- **Line length is a target width.** Formatters wrap code where it is safe to do so and never split strings, URLs or other indivisible tokens to meet a number.
- **Some engines define a single style.** Tools such as `gofmt`, `terraform fmt` and `buf format` are intentionally not configurable, and CodeNeat presents them that way.
- **Formatting never changes behaviour.** Operations that modify code rather than layout, such as removing unused imports, are separate options that are off by default and clearly labelled.
- **Installed tools take precedence.** When a formatter such as Ruff or clang-format is installed on your system, CodeNeat uses it in place of the built-in build, so that the tool's own project configuration file is honoured.

Per-language formatter details are listed in the [language matrix](docs/languages.md).

## Limits

|                  |                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| File size        | 2 MB per file by default (about 2 million characters), adjustable up to 100 MB                                          |
| Lines            | No fixed limit; a 2 MB file is typically 30,000 to 90,000 lines                                                         |
| Time per file    | 10 seconds by default, adjustable up to 120 seconds                                                                     |
| Typical speed    | A 2 MB file formats in under a second for Go and Python, and in about 3 to 8 seconds for TypeScript, Java, C++ and JSON |
| Format Workspace | Up to 20,000 files per run                                                                                              |
| Line length      | 40 to 300 characters                                                                                                    |
| Indentation      | 1 to 16 spaces, or tabs                                                                                                 |
| Profiles         | Unlimited                                                                                                               |

A file over the size or time limit is left exactly as it is, and CodeNeat tells you why. Both limits are on the **Advanced** page.

## Commands

| Command                                     | What it does                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| CodeNeat: Open Settings                     | Opens the settings dashboard.                                                                                               |
| CodeNeat: Format Document                   | Formats the current file.                                                                                                   |
| CodeNeat: Format Document with Review       | Formats the file and highlights every change in the editor. Enter keeps the changes, Escape undoes them.                    |
| CodeNeat: Format Selection                  | Formats the selected code, where the formatter supports it.                                                                 |
| CodeNeat: Format Workspace                  | Formats many files after showing you the list and asking for confirmation.                                                  |
| CodeNeat: Preview Formatting (Live)         | Opens a diff of the current file and its formatted version that updates as you edit. Nothing changes until you press Apply. |
| CodeNeat: Check Formatting                  | Tells you whether the current file is formatted.                                                                            |
| CodeNeat: Select Formatter                  | Chooses the formatter for the current language.                                                                             |
| CodeNeat: Select Profile                    | Chooses a formatting profile.                                                                                               |
| CodeNeat: Manage Formatters                 | Shows installed and missing formatters with setup guidance.                                                                 |
| CodeNeat: Install a Formatter               | Installs a missing formatter after showing you the exact command.                                                           |
| CodeNeat: Open Diagnostics                  | Opens a report for troubleshooting. It contains no source code.                                                             |
| CodeNeat: Import Settings / Export Settings | Loads or saves your preferences and profiles.                                                                               |
| CodeNeat: Use CodeNeat as Default Formatter | Makes CodeNeat the formatter used by Format on Save.                                                                        |

Format Document and Format Selection are also in the editor's context menu, and Format Workspace is in the Explorer context menu of folders.

## Documentation

- [User guide](docs/usage.md): every feature, how to use it and how to switch it off
- [Supported languages](docs/languages.md)
- [Formatter installation guide](docs/formatters.md)
- [Configuration reference](docs/configuration.md) and [options reference](docs/options.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Privacy and security](docs/privacy.md)
- [Architecture](docs/architecture.md) and [contributing](CONTRIBUTING.md)

## Install from a VSIX

```
code --install-extension codeneat.vsix
```

Or in VS Code: Extensions view → **…** menu → **Install from VSIX…**. Requires VS Code 1.90 or newer.

## Licence

CodeNeat is free and open source, released under the [Apache License 2.0](LICENSE). Every component it includes is open source under a permissive licence; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full list. The bundled formatting engines keep their own licences: Prettier and its XML, PHP, LaTeX and TOML plugins (MIT), prettier-plugin-java (Apache-2.0), sql-formatter (MIT), the @wasm-fmt builds of gofmt, Ruff, clang-format, StyLua, shfmt and dart format (MIT packaging; the engines keep their upstream licences: BSD-3-Clause, MIT, Apache-2.0 with LLVM exception, MPL-2.0, BSD-3-Clause and BSD-3-Clause) and dockerfmt (MIT).
