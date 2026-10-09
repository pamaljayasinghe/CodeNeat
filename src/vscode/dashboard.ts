import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { FormatterError } from '../core/adapter';
import type { FormattingSettings } from '../core/formattingService';
import { NO_OVERRIDES, readProjectOverrides } from '../core/projectConfig';
import { CATALOG } from '../shared/catalog';
import { BUILTIN_PROFILES } from '../shared/profiles';
import { SAMPLES } from '../shared/samples';
import type {
  ActiveEditorInfo,
  DashboardState,
  HostToWebviewMessage,
  PreviewRequest,
  PreviewResult,
  ProfileDefinition,
  ProjectOverrides,
  SettingsDraft,
} from '../shared/types';
import { parseProfileExport, parseWebviewMessage, PROFILE_EXPORT_FORMAT, EXPORT_VERSION } from '../shared/validate';
import type { CodeNeatApp } from './app';
import { PREVIEW_SCHEME } from './commands';

export function createNonce(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function draftToFormatting(draft: SettingsDraft): FormattingSettings {
  return {
    user: draft.user,
    workspace: draft.workspace,
    profiles: draft.profiles,
    respectProjectConfig: draft.respectProjectConfig,
    timeoutMs: draft.timeoutMs,
    maxFileSizeKB: draft.maxFileSizeKB,
  };
}

/** Hosts the React settings dashboard in a webview panel. */
export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  /** True once the React app has received the state and reported back. */
  private rendered = false;
  private pendingNavigation: { page: string; languageId?: string } | undefined;
  private previewCancel: vscode.CancellationTokenSource | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly app: CodeNeatApp) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codeneat') || event.affectsConfiguration('editor') || event.affectsConfiguration('files')) {
          this.scheduleRefresh();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.isRealEditor(editor)) {
          void this.postActiveEditor();
        }
      }),
      app.onDidChangeFormatters(() => this.scheduleRefresh()),
    );
  }

  private isRealEditor(editor: vscode.TextEditor): boolean {
    const scheme = editor.document.uri.scheme;
    return scheme !== 'output' && scheme !== PREVIEW_SCHEME && scheme !== 'vscode-settings';
  }

  get isOpen(): boolean {
    return !!this.panel;
  }

  /** True when the dashboard UI has started, received its state and answered. */
  get isRendered(): boolean {
    return !!this.panel && this.rendered;
  }

  show(page?: string, languageId?: string): void {
    if (page) {
      this.pendingNavigation = { page, languageId };
    }
    if (this.panel) {
      this.panel.reveal(undefined, false);
      this.flushNavigation();
      return;
    }
    const webviewRoot = vscode.Uri.joinPath(this.app.context.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      'codeneat.dashboard',
      'CodeNeat Settings',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [webviewRoot], enableCommandUris: false },
    );
    this.panel = panel;
    this.ready = false;
    this.rendered = false;
    panel.iconPath = vscode.Uri.joinPath(this.app.context.extensionUri, 'assets', 'icon.png');
    panel.webview.html = this.html(panel.webview, webviewRoot);
    panel.webview.onDidReceiveMessage((raw: unknown) => void this.onMessage(raw), undefined, this.disposables);
    panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.ready = false;
        this.rendered = false;
        this.previewCancel?.cancel();
        this.previewCancel?.dispose();
        this.previewCancel = undefined;
      },
      undefined,
      this.disposables,
    );
  }

  private html(webview: vscode.Webview, root: vscode.Uri): string {
    const nonce = createNonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(root, 'main.css'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      "form-action 'none'",
      "base-uri 'none'",
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>CodeNeat Settings</title>
</head>
<body>
<div id="root" role="application" aria-label="CodeNeat Settings"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  private post(message: HostToWebviewMessage): void {
    if (this.panel && this.ready) {
      void this.panel.webview.postMessage(message);
    }
  }

  private flushNavigation(): void {
    if (this.ready && this.pendingNavigation) {
      this.post({ type: 'navigate', ...this.pendingNavigation });
      this.pendingNavigation = undefined;
    }
  }

  private scheduleRefresh(): void {
    if (!this.panel) {
      return;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.postState('refresh'), 150);
  }

  private activeEditorInfo(): ActiveEditorInfo | null {
    const editor = this.app.lastEditor;
    if (!editor || editor.document.isClosed) {
      return null;
    }
    const document = editor.document;
    const settings = this.app.config.read(document.uri);
    return {
      uri: document.uri.toString(),
      fileName: path.basename(document.fileName),
      languageId: this.app.languageOf(document)?.id,
      vscodeLanguageId: document.languageId,
      hasSelection: !editor.selection.isEmpty,
      lineCount: document.lineCount,
      tooLarge: Buffer.byteLength(document.getText(), 'utf8') / 1024 > settings.maxFileSizeKB,
    };
  }

  /** Reads what project files say about the active document, once per candidate formatter. */
  private async projectOverrides(): Promise<Record<string, ProjectOverrides>> {
    const result: Record<string, ProjectOverrides> = {};
    const document = this.app.lastEditor?.document;
    if (!document || document.isClosed) {
      return result;
    }
    const input = this.app.toInput(document);
    if (!input?.filePath) {
      return result;
    }
    const env = this.app.environment();
    const candidates = this.app.registry.adapters.filter((adapter) => adapter.descriptor.languages.includes(input.languageId));
    await Promise.all(
      candidates.map(async (adapter) => {
        result[adapter.descriptor.id] = await readProjectOverrides(adapter, input.filePath, input.workspaceRoot, env).catch(() => NO_OVERRIDES);
      }),
    );
    return result;
  }

  private async buildState(): Promise<DashboardState> {
    const app = this.app;
    const statuses = await app.registry.detectAll(app.environment());
    const folders = vscode.workspace.workspaceFolders ?? [];
    return {
      version: app.version,
      catalog: CATALOG,
      languages: app.registry.languages,
      formatters: app.registry.descriptors,
      statuses,
      builtinProfiles: BUILTIN_PROFILES,
      settings: app.config.read(app.lastEditor?.document.uri),
      editor: app.config.readEditor(),
      defaultFormatter: app.config.defaultFormatters(app.registry.languages),
      activeEditor: this.activeEditorInfo(),
      project: await this.projectOverrides(),
      trusted: vscode.workspace.isTrusted,
      hasWorkspace: folders.length > 0,
      workspaceName: vscode.workspace.name,
      platform: process.platform,
      samples: SAMPLES,
    };
  }

  private async postState(reason: 'init' | 'refresh' | 'applied'): Promise<void> {
    if (!this.panel) {
      return;
    }
    try {
      this.post({ type: 'state', state: await this.buildState(), reason });
    } catch (error) {
      this.app.log.error(`Could not build the dashboard state: ${String(error)}`);
    }
  }

  private async postActiveEditor(): Promise<void> {
    if (!this.panel) {
      return;
    }
    this.post({ type: 'activeEditor', activeEditor: this.activeEditorInfo(), project: await this.projectOverrides() });
  }

  private async onMessage(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) {
      this.app.log.warn('Ignored a malformed message from the settings dashboard.');
      return;
    }
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.postState('init');
        this.flushNavigation();
        break;
      case 'preview':
        await this.runPreview(message.request);
        break;
      case 'cancelPreview':
        this.previewCancel?.cancel();
        break;
      case 'apply':
        try {
          await this.app.config.applyDraft(message.draft);
          await this.app.refreshFormatters();
          await this.postState('applied');
        } catch (error) {
          this.post({ type: 'notice', level: 'error', message: `Your settings could not be saved: ${error instanceof Error ? error.message : String(error)}` });
        }
        break;
      case 'applyToDocument':
        await this.applyToDocument(message.draft);
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(message.text);
        this.post({ type: 'notice', level: 'info', message: 'Copied to the clipboard.' });
        break;
      case 'refreshFormatters':
        await this.app.refreshFormatters();
        await this.postState('refresh');
        this.post({ type: 'notice', level: 'info', message: 'Formatter detection finished.' });
        break;
      case 'dirty':
        this.rendered = true;
        if (this.panel) {
          this.panel.title = message.dirty ? '● CodeNeat Settings' : 'CodeNeat Settings';
        }
        break;
      case 'exportProfile':
        await this.exportProfile(message.profile);
        break;
      case 'importProfile':
        await this.importProfile();
        break;
      case 'command':
        await this.runCommand(message.command, message.args ?? {});
        break;
    }
  }

  private async runCommand(command: string, args: Record<string, string>): Promise<void> {
    switch (command) {
      case 'codeneat.openSettingsJson':
        await vscode.commands.executeCommand('workbench.action.openSettingsJson');
        return;
      case 'codeneat.openWalkthrough':
        await vscode.commands.executeCommand('workbench.action.openWalkthrough', 'pamaljayasinghe.codeneat#codeneat.gettingStarted', false);
        return;
      case 'codeneat.manageWorkspaceTrust':
        await vscode.commands.executeCommand('workbench.trust.manage');
        return;
      case 'codeneat.showLog':
        this.app.log.show(true);
        return;
      case 'codeneat.openExternal': {
        // Only links that CodeNeat itself ships (formatter home pages and install guides) may be opened.
        const allowed = new Set(
          this.app.registry.descriptors.flatMap((descriptor) => [descriptor.homepage, descriptor.install.url]).filter(Boolean),
        );
        allowed.add('https://github.com/pamaljayasinghe/CodeNeat');
        allowed.add('https://github.com/pamaljayasinghe/CodeNeat/issues');
        const url = args.url;
        if (url && allowed.has(url) && /^https:\/\//.test(url)) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        return;
      }
      case 'codeneat.openSettings':
        return;
      case 'codeneat.installFormatter':
        if (args.formatterId && this.app.registry.get(args.formatterId)) {
          await vscode.commands.executeCommand('codeneat.installFormatter', args.formatterId);
          await this.postState('refresh');
        }
        return;
      default:
        // Formatting commands act on the last real editor, so bring it to the front first.
        if (this.app.lastEditor && ['codeneat.formatDocument', 'codeneat.formatSelection', 'codeneat.previewFormatting', 'codeneat.checkFormatting', 'codeneat.selectFormatter'].includes(command)) {
          await vscode.window.showTextDocument(this.app.lastEditor.document, { viewColumn: this.app.lastEditor.viewColumn, preserveFocus: false });
        }
        await vscode.commands.executeCommand(command);
    }
  }

  private async runPreview(request: PreviewRequest): Promise<void> {
    this.previewCancel?.cancel();
    this.previewCancel?.dispose();
    const source = new vscode.CancellationTokenSource();
    this.previewCancel = source;
    const reply = (result: Omit<PreviewResult, 'requestId'>): void => {
      // A newer request has replaced this one: its answer would be stale, so drop it.
      if (this.previewCancel === source && !source.token.isCancellationRequested) {
        this.post({ type: 'previewResult', result: { requestId: request.requestId, ...result } });
      }
    };

    const language = this.app.registry.getLanguage(request.languageId);
    if (!language) {
      reply({ ok: false, original: '', error: 'CodeNeat does not support this language.', errorKind: 'unsupported' });
      return;
    }

    let text = request.code ?? '';
    let fileName = language.filenames?.[0] ?? `sample${language.extensions[0] ?? '.txt'}`;
    let filePath: string | undefined;
    let workspaceRoot: string | undefined;
    if (request.source === 'editor') {
      const document = this.app.lastEditor?.document;
      const input = document && !document.isClosed ? this.app.toInput(document) : undefined;
      if (!input || input.languageId !== language.id) {
        reply({ ok: false, original: '', error: `Open a ${language.label} file to preview your own code.`, errorKind: 'unsupported' });
        return;
      }
      ({ text, fileName, filePath, workspaceRoot } = input);
    } else if (request.source === 'sample') {
      text = request.code ?? SAMPLES[language.id] ?? '';
    }

    const outcome = await this.app.format(
      { text, languageId: language.id, fileName, filePath, workspaceRoot },
      draftToFormatting(request.draft),
      source.token,
      request.formatterId,
      true,
    );
    if (outcome.error) {
      const error = outcome.error;
      if (error.kind === 'cancelled') {
        return;
      }
      const descriptor = request.formatterId ? this.app.registry.get(request.formatterId)?.descriptor : undefined;
      reply({
        ok: false,
        original: text,
        error: error.message,
        errorKind: previewErrorKind(error),
        install: error.install ?? (error.kind === 'missing' ? descriptor?.install : undefined),
        formatterId: descriptor?.id,
        formatterName: descriptor?.displayName,
        fileName,
      });
      return;
    }
    const result = outcome.result;
    if (result) {
      reply({
        ok: true,
        original: text,
        formatted: result.text,
        changed: result.changed,
        formatterId: result.formatterId,
        formatterName: result.formatterName,
        durationMs: result.durationMs,
        fileName,
      });
    }
  }

  private async applyToDocument(draft: SettingsDraft): Promise<void> {
    const editor = this.app.lastEditor;
    const input = editor && !editor.document.isClosed ? this.app.toInput(editor.document) : undefined;
    if (!editor || !input) {
      this.post({ type: 'notice', level: 'error', message: 'Open a supported file first, then try again.' });
      return;
    }
    const outcome = await this.app.format(input, draftToFormatting(draft));
    if (outcome.error) {
      this.post({ type: 'notice', level: 'error', message: outcome.error.message });
      return;
    }
    if (!outcome.result?.changed) {
      this.post({ type: 'notice', level: 'info', message: `${input.fileName} is already formatted this way.` });
      return;
    }
    if (editor.document.getText() !== input.text) {
      this.post({ type: 'notice', level: 'error', message: 'The file changed in the meantime. Please try again.' });
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.set(editor.document.uri, this.app.toEdits(editor.document, input.text, outcome.result.text));
    const applied = await vscode.workspace.applyEdit(edit);
    this.post({
      type: 'notice',
      level: applied ? 'info' : 'error',
      message: applied
        ? `Formatted ${input.fileName} with ${outcome.result.formatterName}. Use Undo in the editor to revert.`
        : 'The editor rejected the change.',
    });
  }

  private async exportProfile(profile: ProfileDefinition): Promise<void> {
    const target = await vscode.window.showSaveDialog({
      title: `Export Profile "${profile.name}"`,
      defaultUri: vscode.workspace.workspaceFolders?.[0]
        ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, `${profile.id}.codeneat-profile.json`)
        : undefined,
      filters: { 'CodeNeat profile': ['json'] },
    });
    if (!target) {
      return;
    }
    const data = {
      format: PROFILE_EXPORT_FORMAT,
      version: EXPORT_VERSION,
      profile: { id: profile.id, name: profile.name, description: profile.description, style: profile.style, languages: profile.languages },
    };
    await vscode.workspace.fs.writeFile(target, Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'));
    this.post({ type: 'notice', level: 'info', message: `Profile exported to ${target.fsPath}.` });
  }

  private async importProfile(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: 'Import a CodeNeat Profile',
      canSelectMany: false,
      filters: { 'CodeNeat profile': ['json'] },
      openLabel: 'Import',
    });
    if (!picked?.[0]) {
      return;
    }
    try {
      const data = await vscode.workspace.fs.readFile(picked[0]);
      if (data.byteLength > 1_000_000) {
        throw new Error('The file is too large to be a CodeNeat profile.');
      }
      this.post({ type: 'profileImported', profile: parseProfileExport(Buffer.from(data).toString('utf8')) });
    } catch (error) {
      this.post({ type: 'notice', level: 'error', message: `Could not import the profile. ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.previewCancel?.dispose();
    this.panel?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}

function previewErrorKind(error: FormatterError): PreviewResult['errorKind'] {
  switch (error.kind) {
    case 'missing':
      return 'missing';
    case 'untrusted':
    case 'needs-approval':
      return 'untrusted';
    case 'unsupported':
    case 'ignored':
      return 'unsupported';
    case 'too-large':
      return 'too-large';
    default:
      return 'error';
  }
}
