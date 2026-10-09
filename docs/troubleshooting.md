# Troubleshooting

Start with **CodeNeat: Open Diagnostics**. The report shows the formatter chosen for the current file, whether it is installed, and where every option comes from. It contains no source code.

## "… is not installed" or "… was not found"

The language (Rust, Ruby, Kotlin, Scala, Swift, F#, PowerShell, R or Terraform) uses an external formatter that CodeNeat could not find. All other languages have a bundled formatter and never show this message.

1. Click **Install …** in the message (or run **CodeNeat: Install a Formatter**).
2. Check the command CodeNeat shows you and confirm. It runs in a terminal.
3. When it finishes, CodeNeat detects the formatter and formats your file.

If CodeNeat cannot find a suitable installer on your computer (for example no Homebrew), it opens the formatter's installation guide instead. After installing by hand, press **Re-detect** on the Formatter Management page.

If the tool is installed but not on the `PATH` that VS Code sees (common when VS Code is started from the Dock on macOS), enter its full path under **Custom location** on the same page, or start VS Code from a terminal with `code .`.

## Nothing happens when I save

Format on Save uses VS Code's default formatter.

1. Open the **Auto Formatting** page.
2. Press **Use CodeNeat as Default Formatter…**.
3. Switch on **Format on Save** and press **Apply**.

If a language has its own `"[language]": { "editor.defaultFormatter": … }` entry in `settings.json`, that entry wins.

## A setting is greyed out

The formatter for that language does not offer the option. The row says why. For example, `gofmt` has one fixed style, and Prettier does not let you move braces. Choose a different formatter for the language if one is offered (Language-Specific Options → Formatter).

## My setting has no effect

A project file is probably overriding it. Look at "From: …" under the option. If it says `.editorconfig` or names a formatter configuration file, either change that file or turn off **Respect project configuration** on the Workspace Settings page.

## A line is longer than my line length

Line length is a preferred width. Formatters do not split strings, URLs, or other code that cannot be broken safely. Formatters such as `gofmt`, `shfmt` and `terraform fmt` never wrap lines at all.

## "… could not format this file" with a syntax error

Formatters need valid code. The file is left exactly as it was. Fix the error shown in the message and format again. (The bundled TOML formatter is error-tolerant and tidies what it can instead.)

## The preview or formatting is slow, or times out

External formatters that start a runtime (PowerShell, R, Java-based tools) take a second or two. Raise **Time Limit per File** on the Advanced page if needed. Files over the size limit on that page are skipped.

## Restricted Mode

In an untrusted workspace CodeNeat runs only its bundled formatters with your own settings. Project configuration files, project-local formatter installations, external formatters and custom formatters are switched off. Use **Manage Workspace Trust** to trust the folder.

## Reporting a problem

Open an issue at https://github.com/pamaljayasinghe/CodeNeat/issues and attach the diagnostics report and, if you can, a small file that shows the problem. **Show Log** on the Help page opens CodeNeat's log.
