import * as vscode from 'vscode';
import type { CodeNeatApp } from './app';

export const PREVIEW_SCHEME = 'codeneat-preview';
const REFRESH_DELAY_MS = 400;

/** Serves formatted text for the diff editor opened by "Preview Formatting". */
class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(uri: vscode.Uri, content: string): void {
    const key = uri.toString();
    if (this.contents.get(key) !== content) {
      this.contents.set(key, content);
      this.emitter.fire(uri);
    }
  }

  delete(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  dispose(): void {
    this.contents.clear();
    this.emitter.dispose();
  }
}

interface Session {
  source: vscode.Uri;
  preview: vscode.Uri;
  timer?: NodeJS.Timeout;
}

export interface SaveReview {
  file: string;
  changedLines: number;
}

export function changedLineCount(original: string, formatted: string): number {
  const before = original.split(/\r?\n/);
  const after = new Set(formatted.split(/\r?\n/));
  return Math.max(1, before.filter((line) => !after.has(line)).length);
}

/**
 * Two ways of seeing what CodeNeat would change before it changes anything:
 *  - a live diff ("Preview Formatting") that follows the file while you edit it, and
 *  - an optional review prompt after each manual save ("Review Changes on Save").
 */
export class LivePreview implements vscode.Disposable {
  private readonly provider = new PreviewContentProvider();
  private readonly sessions = new Map<string, Session>();
  private readonly manualSaves = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];
  /** The most recent save review that was offered; read by the end-to-end tests. */
  lastSaveReview: SaveReview | undefined;

  constructor(private readonly app: CodeNeatApp) {
    this.disposables.push(
      this.provider,
      vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, this.provider),
      vscode.workspace.onDidChangeTextDocument((event) => this.schedule(event.document.uri)),
      vscode.workspace.onDidCloseTextDocument((document) => this.onClosed(document)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codeneat')) {
          for (const session of this.sessions.values()) {
            this.schedule(session.source);
          }
        }
      }),
      vscode.workspace.onWillSaveTextDocument((event) => {
        if (event.reason === vscode.TextDocumentSaveReason.Manual) {
          this.manualSaves.add(event.document.uri.toString());
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => void this.reviewAfterSave(document)),
    );
  }

  /** True while a live preview is open for the document. */
  isLive(source: vscode.Uri): boolean {
    return this.sessions.has(source.toString());
  }

  private previewUri(source: vscode.TextDocument): vscode.Uri {
    const name = source.fileName.split(/[\\/]/).pop() ?? 'file';
    return vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${name}`, query: encodeURIComponent(source.uri.toString()) });
  }

  /** The document a preview belongs to. */
  sourceOf(preview: vscode.Uri): vscode.TextDocument | undefined {
    if (preview.scheme !== PREVIEW_SCHEME) {
      return undefined;
    }
    const target = decodeURIComponent(preview.query);
    return vscode.workspace.textDocuments.find((document) => document.uri.toString() === target);
  }

  /** Opens a diff of the file and its formatted version. The diff keeps updating while it is open. */
  async open(document: vscode.TextDocument): Promise<boolean> {
    const { result, error } = await this.app.formatDocument(document);
    if (error) {
      void this.app.reportError(error, document.uri.toString());
      return false;
    }
    if (!result) {
      return false;
    }
    const preview = this.previewUri(document);
    this.provider.set(preview, result.text);
    this.sessions.set(document.uri.toString(), { source: document.uri, preview });
    const name = document.fileName.split(/[\\/]/).pop() ?? 'file';
    await vscode.commands.executeCommand('vscode.diff', document.uri, preview, `${name}: Current ↔ Formatted (live, ${result.formatterName})`, { preview: true });
    if (!result.changed) {
      vscode.window.setStatusBarMessage(`$(check) CodeNeat: ${name} is already formatted. The preview updates as you edit.`, 5000);
    }
    return true;
  }

  private schedule(source: vscode.Uri): void {
    const session = this.sessions.get(source.toString());
    if (!session) {
      return;
    }
    clearTimeout(session.timer);
    session.timer = setTimeout(() => void this.refresh(session), REFRESH_DELAY_MS);
  }

  private async refresh(session: Session): Promise<void> {
    const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === session.source.toString());
    const input = document ? this.app.toInput(document) : undefined;
    if (!document || !input) {
      return;
    }
    const outcome = await this.app.format(input, this.app.config.formattingSettings(document.uri), undefined, undefined, false);
    // Edits made while formatting was running make this result stale; a newer refresh is already queued.
    if (document.getText() !== input.text || !this.sessions.has(session.source.toString())) {
      return;
    }
    if (outcome.result) {
      this.provider.set(session.preview, outcome.result.text);
    } else if (outcome.error && outcome.error.kind !== 'cancelled') {
      // Half-typed code is often not valid; keep the last good preview and say why it paused.
      vscode.window.setStatusBarMessage(`$(warning) CodeNeat preview paused: ${outcome.error.message.split('\n')[0]}`, 4000);
    }
  }

  private onClosed(document: vscode.TextDocument): void {
    if (document.uri.scheme === PREVIEW_SCHEME) {
      for (const [key, session] of this.sessions) {
        if (session.preview.toString() === document.uri.toString()) {
          clearTimeout(session.timer);
          this.sessions.delete(key);
          this.provider.delete(session.preview);
        }
      }
      return;
    }
    const session = this.sessions.get(document.uri.toString());
    if (session) {
      clearTimeout(session.timer);
      this.sessions.delete(document.uri.toString());
      this.provider.delete(session.preview);
    }
  }

  /** Formats `document` and applies the result as one undoable edit. Returns true when something changed. */
  async apply(document: vscode.TextDocument): Promise<boolean> {
    const original = document.getText();
    const { result, error } = await this.app.formatDocument(document);
    if (error) {
      void this.app.reportError(error, document.uri.toString());
      return false;
    }
    if (!result?.changed || document.getText() !== original) {
      return false;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, this.app.toEdits(document, original, result.text));
    return vscode.workspace.applyEdit(edit);
  }

  /**
   * "Review Changes on Save": after a manual save, tell the user what CodeNeat would change and let
   * them look at the diff first. Nothing is modified unless they choose to.
   */
  private async reviewAfterSave(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const manual = this.manualSaves.delete(key);
    if (!manual || document.uri.scheme === PREVIEW_SCHEME || !this.app.config.read(document.uri).previewOnSave) {
      return;
    }
    const input = this.app.toInput(document);
    if (!input) {
      return;
    }
    const outcome = await this.app.format(input, this.app.config.formattingSettings(document.uri), undefined, undefined, false);
    if (!outcome.result?.changed || document.getText() !== input.text) {
      return;
    }
    const name = input.fileName;
    const lines = changedLineCount(input.text, outcome.result.text);
    this.lastSaveReview = { file: name, changedLines: lines };
    const show = 'Show Changes';
    const format = 'Format and Save';
    const choice = await vscode.window.showInformationMessage(
      `CodeNeat: ${name} was saved without formatting. ${outcome.result.formatterName} would change about ${lines} ${lines === 1 ? 'line' : 'lines'}.`,
      show,
      format,
    );
    if (choice === show) {
      await this.open(document);
    } else if (choice === format && (await this.apply(document))) {
      await document.save();
    }
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      clearTimeout(session.timer);
    }
    this.sessions.clear();
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
