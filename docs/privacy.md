# Privacy and security

## Privacy

- **No account.** CodeNeat has nothing to sign in to.
- **No telemetry.** CodeNeat collects no usage data and no crash reports.
- **No network requests.** CodeNeat never contacts a server. Formatting works offline. The only exception is one you start yourself: if you press **Install** for a missing formatter, the package manager shown in the confirmation (for example Homebrew or rustup) downloads that tool.
- **No uploads.** Your code is processed only on your computer, by the bundled engines inside VS Code or by formatter programs you installed yourself.
- **No AI service** is involved in formatting.

One note about tools you install yourself: a few external formatters can download things on their own. For example, `scalafmt` may download the version named in a project's `.scalafmt.conf`. That is the tool's behaviour, not CodeNeat's.

## What CodeNeat stores

- Your preferences, in VS Code's settings (`codeneat.*`).
- The list of custom formatter commands you approved, in VS Code's extension storage.

Nothing else is written, apart from private temporary files that some external formatters need. Those live in your system's temporary directory, are readable only by you, and are deleted as soon as the formatter finishes.

## Security

- **No shell.** External formatters are started directly with an argument list. File names and settings can never be interpreted as shell commands.
- **Workspace Trust.** In Restricted Mode only the bundled formatters run, with your own settings. Project configuration files (which can contain code, such as `prettier.config.js`), project-local formatter installations, external formatters and custom formatters are disabled. A workspace cannot set tool paths, custom formatters or per-language formatters while it is untrusted.
- **Consent for custom commands.** A custom formatter runs only after you have approved its exact command. Editing the command requires a new approval.
- **PATH safety.** Relative `PATH` entries are ignored when looking for tools, so a file dropped into a project cannot impersonate a formatter.
- **Limits.** Every run has a time limit, an output size limit and a file size limit, and is stopped when you cancel.
- **The dashboard** runs under a strict Content Security Policy with no inline scripts, loads nothing from the network, and every message it sends is validated before use.
- **Installs need your confirmation.** CodeNeat installs a formatter only when you ask, shows the exact command first, and runs it in a visible terminal. The commands come from CodeNeat's built-in guides, never from a workspace.
- **No silent changes.** CodeNeat never edits your formatter configuration files, never replaces another default formatter without asking, never formats a workspace without confirmation, and refuses an empty result from a formatter so a file cannot be wiped.

To report a security problem, open an issue at https://github.com/pamaljayasinghe/CodeNeat/issues without including exploit details, and ask for a private contact.
