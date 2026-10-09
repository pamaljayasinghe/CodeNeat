# Changelog

All notable changes to CodeNeat are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-09

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
- One-click installation of missing formatters: CodeNeat shows the exact command and runs it in a terminal after you confirm.

### Known limitations

- Rust, Ruby, Kotlin, Scala, Swift, F#, PowerShell, R and Terraform need their own formatter installed.
- The engines of 25 external formatters were not executed in the release test run because they were not installed on the release machine. See the *Verified* column in `docs/languages.md`.
- Bundled WebAssembly engines do not read a tool's own project configuration file (`ruff.toml`, `.clang-format`, `stylua.toml`); `.editorconfig` is still applied.
- No formatter offers a strict maximum line length; line length is always a preferred width.
