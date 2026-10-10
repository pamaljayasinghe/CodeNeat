# Configuration reference

Everything on this page can be changed in the dashboard (**CodeNeat: Open Settings**). The setting names are for people who prefer `settings.json`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `codeneat.style` | `{}` | Preferences for every language, for example `{ "lineLength": 100, "indentStyle": "spaces" }`. See the [options reference](options.md). |
| `codeneat.languages` | `{}` | Per-language choices. Each entry may contain `formatter`, `profile` and `style`. |
| `codeneat.defaultProfile` | `"standard"` | Profile used when a language has none of its own. |
| `codeneat.profiles` | `{}` | Your custom profiles. |
| `codeneat.respectProjectConfig` | `true` | Let `.editorconfig` and formatter configuration files win over CodeNeat preferences. |
| `codeneat.toolPaths` | `{}` | Full paths to formatter executables, by formatter id. |
| `codeneat.customFormatters` | `[]` | Additional external formatters. See below. |
| `codeneat.formatOnType` | `true` | Whether CodeNeat answers VS Code's Format on Type requests. |
| `codeneat.inlineReview` | `false` | Show the result of **Format Document** in the editor with changed lines highlighted, and wait for Enter (keep) or Escape (undo). |
| `codeneat.previewOnSave` | `false` | After a save, report what CodeNeat would change and offer to review it first. Nothing is modified unless you approve. |
| `codeneat.timeoutMs` | `10000` | Time limit for one formatting run. |
| `codeneat.maxFileSizeKB` | `2048` | Larger files are not formatted. |
| `codeneat.workspace.exclude` | `[]` | Extra patterns (gitignore syntax) skipped by Format Workspace. |
| `codeneat.workspace.useGitignore` | `true` | Skip files ignored by Git during Format Workspace. |
| `codeneat.showStatusBar` | `true` | Show the active formatter in the status bar. |
| `codeneat.enabled` | `true` | Master switch. When off, CodeNeat formats nothing. Can be set per workspace. |
| `codeneat.showEditorButton` | `true` | Show the Format button in the editor title bar. |
| `codeneat.editorButtonAction` | `review` | What the editor title button does: `review` shows the changes and asks first, `format` formats straight away. |
| `codeneat.showContextMenu` | `true` | Show CodeNeat entries in the editor's right-click menu. |

Example:

```json
{
  "codeneat.defaultProfile": "team",
  "codeneat.style": { "lineLength": 100 },
  "codeneat.languages": {
    "python": { "formatter": "ruff", "style": { "indentSize": 4, "quoteStyle": "double" } },
    "markdown": { "style": { "proseWrap": "always", "lineLength": 80 } }
  }
}
```

## Which setting wins

Later entries win over earlier ones:

1. The formatter's own default
2. CodeNeat's default (line length 120, keep existing line endings)
3. The active profile (the language's profile, else the workspace profile, else your default profile)
4. Your settings (`codeneat.style`)
5. Workspace settings (`codeneat.style` in `.vscode/settings.json`)
6. Your settings for the language
7. Workspace settings for the language
8. `.editorconfig` — only while "Respect project configuration" is on
9. The formatter's configuration file — only while "Respect project configuration" is on
10. Values the formatter fixes and cannot change

For Prettier, individual keys of `.prettierrc` override the matching CodeNeat option. Other formatters read their configuration file themselves, so when such a file exists CodeNeat passes no style flags at all and the dashboard shows every option as controlled by that file.

Every option on a style page shows "From: …", and **CodeNeat: Open Diagnostics** lists the source of every option for the current file.

## Format on Save, Paste and Type

These are VS Code features that call the *default formatter*:

```json
{
  "editor.defaultFormatter": "PamalJayasinghe.codeneat",
  "editor.formatOnSave": true
}
```

The **Auto Formatting** page sets them for you. CodeNeat never replaces another extension as default formatter without asking.

- **Format on Paste** and **Format Selection** work where the formatter can format a range: Prettier (JavaScript, TypeScript, CSS, SCSS, Less, JSON, GraphQL), clang-format, google-java-format, Ruff, StyLua and swift-format.
- **Format on Type** works for languages with a bundled formatter, after you type `}` or `;`. External formatters are not started on every keystroke.

## Custom formatters

For a language CodeNeat does not cover, point it at any command-line formatter that reads the file from standard input and prints the result:

```json
{
  "codeneat.customFormatters": [
    {
      "id": "zig-fmt",
      "name": "zig fmt",
      "languages": ["zig"],
      "extensions": [".zig"],
      "command": "zig",
      "args": ["fmt", "--stdin"]
    }
  ]
}
```

- `command` is an executable name or a full path. It is started directly, never through a shell, so shell syntax is rejected.
- `args` may contain `${file}`, `${lineLength}`, `${indentSize}` and `${indentStyle}`.
- The first time a custom formatter is used, CodeNeat shows you the exact command and asks for approval. Changing the command asks again.
- Custom formatters never run in an untrusted workspace, and a workspace cannot define them while it is untrusted.

## Import and export

**CodeNeat: Export Settings** writes your personal style, per-language choices and custom profiles to a JSON file. **CodeNeat: Import Settings** validates such a file, asks for confirmation and replaces your personal CodeNeat settings. Workspace settings and tool paths are never imported. Single profiles can be exported and imported from the **Formatting Profiles** page.
