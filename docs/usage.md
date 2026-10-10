# CodeNeat user guide

This guide explains every CodeNeat feature, how to use it, and how to switch it off. For a shorter tour with screenshots, read [the introduction on Medium](https://medium.com/@pamaljayasinghe340/stop-spending-ai-tokens-on-indentation-meet-codeneat-vscode-extension-d7dc2ac06ebc).

## Format a file

Open a file in a language CodeNeat supports, then use any of these:

| Way | How |
| --- | --- |
| Editor button | Click the CodeNeat button at the top right of the editor. It formats the file, highlights every change in green and asks **Keep Changes** or **Undo Changes**. |
| Keyboard | `Ctrl+Alt+Shift+F` on Windows and Linux, `⌘+⌥+⇧+F` on macOS. |
| Right-click menu | Right-click in the file → **CodeNeat: Format Document**. |
| Status bar | Click **CodeNeat** at the bottom right, then pick an action from the menu. |
| Command Palette | `Ctrl+Shift+P` / `⌘+⇧+P` → **CodeNeat: Format Document**. |
| VS Code's own shortcut | `Shift+Alt+F` / `⇧+⌥+F` uses VS Code's default formatter. Make CodeNeat the default first (see *Format automatically*). |

One **Undo** restores the file exactly as it was.

To format only part of a file, select the code and choose **CodeNeat: Format Selection**. This works for languages whose formatter can format a range (JavaScript, TypeScript, CSS, JSON, C, C++, Java and a few others). For the rest, CodeNeat offers to format the whole file.

## See the changes first

CodeNeat offers three ways to look before anything is kept.

### Format with review (in the editor)

1. Run **CodeNeat: Format Document with Review**.
2. The formatted code appears in your file. Every changed line is highlighted in green.
3. Hover a highlighted line to see the text it replaced.
4. Press **Enter** to keep the changes or **Escape** to put the original back. The same choices are shown as **Keep** and **Undo** above the first change.

The file is not saved by CodeNeat during a review. If you start typing instead, the review ends and the formatted code stays.

To use this every time you run **Format Document**, switch on **Review Changes in the Editor** on the *Auto Formatting* page.

### Live preview (side by side)

Run **CodeNeat: Preview Formatting (Live)**. Your file opens next to its formatted version with the differences marked. The preview follows the file as you type. Click the ✓ **Apply Formatting** button in the title bar when you want the changes.

### Review on save

Switch on **Review Changes on Save** on the *Auto Formatting* page. After you save a file that is not formatted, CodeNeat tells you how many lines would change and offers **Show Changes** and **Format and Save**. If you ignore the message, your file stays as you saved it. Keep **Format on Save** off when you use this.

## Format automatically

1. Open **CodeNeat Settings → Auto Formatting**.
2. Click **Use CodeNeat as Default Formatter…** and choose all languages or one.
3. Switch on **Format on Save** and press **Apply**.

**Format on Paste** and **Format on Type** are on the same page. Format on Paste works where the formatter can format a range; Format on Type works for languages with a built-in formatter.

## Choose your style

Open the dashboard with the CodeNeat icon in the Activity Bar, or **CodeNeat: Open Settings**.

- **Language** (top bar): the language you are configuring. It follows the file you have open, or pick one.
- **Save to**: *My settings* applies to you everywhere; *Workspace* is stored in the project and shared with your team.
- **Applies to**: *All languages* or only the selected language.
- **Style pages** (Line Length, Indentation, Quotes and so on): change a control and watch the live preview on the right. Options your formatter does not have are disabled, with the reason.
- **Apply** saves your changes. **Cancel** discards them. `Ctrl+S` / `⌘+S` also applies.
- **Reset** next to an option removes your choice and returns to the default.
- **Search** (press `/`) finds a setting by name.

If a page shows *Want more control?*, another formatter for that language offers more options; one click switches to it.

## Customize one language

Every language can have its own settings, separate from the rest.

1. Open the dashboard and pick the language in the **Language** box at the top (or just open a file of that language).
2. On any style page, set **Applies to** to **Only *that language***.
3. Change what you want and press **Apply**.

The **Language-Specific Options** page holds the extras that exist for one language only, and lets you choose which formatter that language uses. Some useful ones:

| Language | Setting | What it does |
| --- | --- | --- |
| XML | **XML: Whitespace in Text** → *Not meaningful (re-indent freely)* | Gives normal nested indentation. By default XML is formatted cautiously, because spaces inside XML can be data. If a formatted XML file has tags broken in odd places, change this. |
| XML | **XML: Sort Attributes by Name** | Orders the attributes of every element alphabetically. |
| Java | **Formatter for Java** → *clang-format (bundled)* | Unlocks more options for Java, such as brace position, spacing and blank lines. |
| Python | **Quotes**, **Indentation Size**, **Python: Trailing Comma Keeps Lists Expanded** | Single or double quotes, 2 or 4 spaces, and how lists are laid out. |
| C, C++, C# | **C / C++: Base Style** | Start from the LLVM, Google, Microsoft, Mozilla, WebKit, Chromium or GNU style, then adjust on top. |
| SQL | **SQL: Dialect** and **SQL: Keyword Case** | Match your database, and write keywords in UPPER or lower case. |
| Markdown | **Wrap Text Paragraphs** | Wrap prose at the line length, or keep one line per paragraph. |
| HTML, Vue | **HTML Nesting and Whitespace**, **One Attribute per Line** | How tightly HTML is nested and whether each attribute gets its own line. |
| Bash | **Indent Case Labels in Switch**, **Shell: Space After Redirect Operators** | Small layout choices for shell scripts. |
| TOML | **TOML: Align "=" Signs**, **TOML: Sort Keys Alphabetically** | Line up or sort entries. |

A setting made for one language never affects another. To undo it, press **Reset** next to the option.

## Profiles

A profile is a named set of preferences. **Standard**, **Compact**, **Readable** and **Team Style** are built in.

On the *Formatting Profiles* page you can create a profile, start one from your current settings, duplicate, rename, edit, delete, import and export profiles, set the default profile, and give one language or one workspace its own profile.

## Format a whole project

Run **CodeNeat: Format Workspace** (or right-click a folder in the Explorer).

1. Pick the folder.
2. CodeNeat checks every supported file and shows the list of files that would change.
3. Untick any file you want to leave out.
4. Confirm. Only then are files rewritten.

`node_modules`, build output, lock files, minified, generated and binary files and everything in `.gitignore` are skipped. Add your own patterns on the *Workspace Settings* page. You can cancel at any time.

## Formatters

32 languages have a built-in formatter. For Rust, Ruby, Kotlin, Scala, Swift, F#, PowerShell, R and Terraform, CodeNeat uses the formatter from that language's own tools.

- When a formatter is missing, the message has an **Install** button. CodeNeat shows the exact command, and runs it in a terminal only after you confirm.
- **CodeNeat: Manage Formatters** lists every formatter, whether it is installed, its version and location.
- **CodeNeat: Select Formatter** chooses between formatters when a language has more than one.

## Project configuration files

`.editorconfig`, `.prettierrc`, `.clang-format`, `rustfmt.toml` and similar files win over your CodeNeat preferences by default, so everyone on a project gets the same result. CodeNeat never changes these files. Each option shows where its value comes from. To use your own preferences instead, switch off **Respect Project Configuration** on the *Workspace Settings* page.

## Back up or move your settings

**CodeNeat: Export Settings** saves your preferences and profiles to a file. **CodeNeat: Import Settings** loads them on another computer.

## Switch things off

Everything CodeNeat adds can be switched off in **CodeNeat Settings → Advanced → Buttons, menus and on/off**, or in VS Code's own Settings by searching for "CodeNeat".

| To switch off | Setting |
| --- | --- |
| All CodeNeat formatting (everywhere, or for one workspace) | `codeneat.enabled` |
| The button in the editor title bar | `codeneat.showEditorButton` |
| The question after clicking the button (format straight away instead) | `codeneat.editorButtonAction` set to `format` |
| CodeNeat entries in the right-click menu | `codeneat.showContextMenu` |
| The status bar item | `codeneat.showStatusBar` |
| Review in the editor | `codeneat.inlineReview` (off by default) |
| Review on save | `codeneat.previewOnSave` (off by default) |
| Format on Type by CodeNeat | `codeneat.formatOnType` |
| Format on Save, Paste and Type | VS Code's `editor.formatOnSave`, `editor.formatOnPaste`, `editor.formatOnType` |
| The keyboard shortcut | **Keyboard Shortcuts** → search "CodeNeat" → remove or change it |
| Project files overriding your settings | `codeneat.respectProjectConfig` |

To stop using CodeNeat as the default formatter, remove `"editor.defaultFormatter": "PamalJayasinghe.codeneat"` from your settings, or choose another formatter with **Format Document With…**. To remove CodeNeat completely, uninstall it from the Extensions view; it leaves nothing behind except your `codeneat.*` settings.

## Limits

| | |
| --- | --- |
| File size | 2 MB per file by default (about 2 million characters). Raise it up to 100 MB under **Advanced → Largest File to Format**. |
| Lines | No fixed limit. A 2 MB file is typically 30,000 to 90,000 lines of code. |
| Time per file | 10 seconds by default. Raise it up to 120 seconds under **Advanced → Time Limit per File**. |
| Typical speed | A 2 MB file formats in under a second for Go and Python, and in about 3 to 8 seconds for TypeScript, Java, C++ and JSON. |
| Format Workspace | Up to 20,000 files per run. Format sub-folders separately for larger projects. |
| Line length | 40 to 300 characters. |
| Indentation | 1 to 16 spaces, or tabs. |
| Profiles | Unlimited. |

A file over the size or time limit is left exactly as it is, and CodeNeat tells you why. The same list is on the **Help and Diagnostics** page of the dashboard.

## When something does not work

Run **CodeNeat: Open Diagnostics** for a report of what CodeNeat is doing for the current file (it contains no source code), and see the [troubleshooting guide](troubleshooting.md).
