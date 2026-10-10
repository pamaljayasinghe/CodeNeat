# Changelog

All notable changes to CodeNeat are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-10

### Changed

- The CodeNeat button in the editor title bar now shows the changes highlighted in the file and asks **Keep Changes** or **Undo Changes**. Choose "Format straight away" under **Advanced** to skip the question.
- Formatter Management is grouped into *Built in*, *Installed*, *Needs to be installed* and *Optional alternatives*, with a summary of how many languages are ready.
- Switches use a clear green "on" colour in every theme.

### Added

- A "Customize one language" section in the user guide, and a link to the introduction article from the README and the Help page.

### Fixed

- Dropdowns no longer extend outside their box on narrow layouts.
- TOML and LaTeX files with Windows (CRLF) line endings are formatted correctly; previously their line endings could be doubled.

## [0.1.0] - 2026-10-10

First release.

### Added

- Formatting for 41 languages and formats through real formatting engines. 32 languages work with nothing installed: bundled Prettier (with the Java, XML, TOML, PHP and LaTeX plugins), sql-formatter, and WebAssembly builds of gofmt, Ruff, clang-format, StyLua, shfmt, dart format and dockerfmt. Adapters for 26 external formatters cover the rest and take over when the tool is installed.
- Settings dashboard with 15 sections, search, live preview, per-language and per-workspace settings, and Apply/Cancel with an unsaved-changes indicator.
- Formatting profiles: Standard, Compact, Readable and Team Style, plus unlimited custom profiles with import and export.
- Commands: Format Document, Format Selection, Format Workspace, Preview Formatting, Check Formatting, Open Settings, Select Formatter, Select Profile, Manage Formatters, Open Diagnostics, Import Settings and Export Settings.
- Native VS Code formatting providers for documents, selections and on-type formatting, so Format on Save and Format on Paste work.
- Workspace formatting with file preview, confirmation, progress, cancellation and a summary report.
- Respect for `.editorconfig` and formatter configuration files, with a visible source for every option.
- Workspace Trust support: only bundled formatters run in Restricted Mode.
- Custom external formatters that run only after you approve their exact command.
- Quick ways to format: a button in the editor title bar, a keyboard shortcut, a status bar action menu and right-click menu entries, each with its own off switch, plus a master switch (`codeneat.enabled`).
- A user guide (`docs/usage.md`, also available from **CodeNeat: Open User Guide**) and third-party licence notices.
- Inline review: formatted code is shown in the editor with changed lines highlighted; Enter keeps the changes and Escape undoes them.
- Live formatting preview that follows the file while you edit, with an Apply button, and an optional "Review Changes on Save" prompt that formats only when you approve.
- One-click installation of missing formatters: CodeNeat shows the exact command and runs it in a terminal after you confirm.

### Notes

- Rust, Ruby, Kotlin, Scala, Swift, F#, PowerShell, R and Terraform use the formatter from their own toolchain; CodeNeat offers to install it when it is missing.
- Built-in WebAssembly engines apply `.editorconfig` and your CodeNeat preferences. A tool's own configuration file (`ruff.toml`, `.clang-format`, `stylua.toml`) is honoured when that tool is installed.
- Line length is a preferred width: formatters never split strings or other indivisible code to meet it.
