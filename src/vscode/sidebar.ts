import * as path from 'node:path';
import * as vscode from 'vscode';
import { chooseFormatter } from '../shared/resolve';
import type { CodeNeatApp } from './app';
import { createNonce } from './dashboard';

const SIDEBAR_COMMANDS = new Set([
  'codeneat.openSettings',
  'codeneat.formatDocument',
  'codeneat.previewFormatting',
  'codeneat.checkFormatting',
  'codeneat.formatWorkspace',
  'codeneat.manageFormatters',
  'codeneat.selectFormatter',
  'codeneat.selectProfile',
  'codeneat.openDiagnostics',
]);

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The CodeNeat view in the Activity Bar: status of the current file and the main actions. */
export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = 'codeneat.home';
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly activatedAt = Date.now();

  constructor(
    private readonly app: CodeNeatApp,
    private readonly openDashboard: (page?: string) => void,
  ) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => void this.render()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codeneat')) {
          void this.render();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.render()),
      app.onDidChangeFormatters(() => void this.render()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const root = vscode.Uri.joinPath(this.app.context.extensionUri, 'dist', 'webview');
    view.webview.options = { enableScripts: true, localResourceRoots: [root], enableCommandUris: false };
    view.webview.onDidReceiveMessage(
      (message: unknown) => {
        const command = (message as { command?: unknown } | null)?.command;
        if (typeof command === 'string' && SIDEBAR_COMMANDS.has(command)) {
          void vscode.commands.executeCommand(command);
        }
      },
      undefined,
      this.disposables,
    );
    view.onDidChangeVisibility(
      () => {
        if (view.visible) {
          void this.render();
          // Clicking the CodeNeat icon in the Activity Bar opens the settings dashboard.
          this.openDashboard();
        }
      },
      undefined,
      this.disposables,
    );
    view.onDidDispose(() => (this.view = undefined), undefined, this.disposables);
    void this.render();
    // When VS Code merely restores the view at start-up the dashboard is not forced open.
    if (view.visible && Date.now() - this.activatedAt > 3000) {
      this.openDashboard();
    }
  }

  private async render(): Promise<void> {
    const view = this.view;
    if (!view) {
      return;
    }
    const root = vscode.Uri.joinPath(this.app.context.extensionUri, 'dist', 'webview');
    const nonce = createNonce();
    const style = view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'sidebar.css'));
    const script = view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'sidebar.js'));
    const logo = view.webview.asWebviewUri(vscode.Uri.joinPath(root, 'logo.png'));
    const csp = `default-src 'none'; style-src ${view.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${view.webview.cspSource};`;
    const status = await this.statusHtml();
    if (this.view !== view) {
      return;
    }
    view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>CodeNeat</title>
</head>
<body>
<header>
  <img class="logo" src="${logo}" alt="" width="36" height="36">
  <div>
    <h1>CodeNeat</h1>
    <p class="tagline">One Extension. Every Language. Your Style.</p>
  </div>
</header>
<button class="primary" data-command="codeneat.openSettings">Open Settings</button>
${status}
<section aria-label="Actions">
  <h2>Actions</h2>
  <button data-command="codeneat.formatDocument">Format Document</button>
  <button data-command="codeneat.previewFormatting">Preview Formatting</button>
  <button data-command="codeneat.checkFormatting">Check Formatting</button>
  <button data-command="codeneat.formatWorkspace">Format Workspace…</button>
</section>
<section aria-label="Setup">
  <h2>Setup</h2>
  <button data-command="codeneat.selectFormatter">Select Formatter</button>
  <button data-command="codeneat.selectProfile">Select Profile</button>
  <button data-command="codeneat.manageFormatters">Manage Formatters</button>
  <button data-command="codeneat.openDiagnostics">Diagnostics</button>
</section>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  private async statusHtml(): Promise<string> {
    const editor = vscode.window.activeTextEditor ?? this.app.lastEditor;
    const trustNote = vscode.workspace.isTrusted
      ? ''
      : '<p class="note warn">Restricted Mode: only bundled formatters run until you trust this workspace.</p>';
    if (!editor || editor.document.isClosed) {
      return `<section class="card" aria-label="Current file"><h2>Current file</h2><p class="muted">Open a file to see how CodeNeat will format it.</p>${trustNote}</section>`;
    }
    const document = editor.document;
    const language = this.app.languageOf(document);
    const name = escapeHtml(path.basename(document.fileName));
    if (!language) {
      return `<section class="card" aria-label="Current file"><h2>Current file</h2><dl><dt>File</dt><dd>${name}</dd><dt>Language</dt><dd>${escapeHtml(document.languageId)}</dd></dl><p class="note">CodeNeat has no formatter for this language yet. You can add your own under Advanced → Custom formatters.</p>${trustNote}</section>`;
    }
    const settings = this.app.config.read(document.uri);
    const env = this.app.environment();
    const candidates = this.app.registry.descriptors.filter((descriptor) => descriptor.languages.includes(language.id));
    const statuses = Object.fromEntries(
      await Promise.all(candidates.map(async (candidate) => [candidate.id, await this.app.registry.detect(candidate.id, env)] as const)),
    );
    const choice = chooseFormatter(language, this.app.registry.descriptors, statuses, settings.user, settings.workspace);
    const formatter = choice.formatter;
    const formatterStatus = formatter ? statuses[formatter.id] : undefined;
    const available = !!formatterStatus?.available;
    const profileId = settings.workspace.languages[language.id]?.profile ?? settings.user.languages[language.id]?.profile ?? settings.workspace.defaultProfile ?? settings.user.defaultProfile ?? 'standard';
    const badge = available
      ? `<span class="badge ok">Ready${formatterStatus?.version ? ` · ${escapeHtml(formatterStatus.version)}` : ''}</span>`
      : '<span class="badge missing">Not installed</span>';
    const help =
      formatter && !available
        ? `<p class="note warn">${escapeHtml(formatter.install.summary)}</p><button data-command="codeneat.manageFormatters">Show Setup Guide</button>`
        : '';
    return `<section class="card" aria-label="Current file">
  <h2>Current file</h2>
  <dl>
    <dt>File</dt><dd>${name}</dd>
    <dt>Language</dt><dd>${escapeHtml(language.label)}</dd>
    <dt>Formatter</dt><dd>${escapeHtml(formatter?.displayName ?? 'None')} ${badge}</dd>
    <dt>Profile</dt><dd>${escapeHtml(profileId)}</dd>
  </dl>
  ${help}${trustNote}
</section>`;
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
