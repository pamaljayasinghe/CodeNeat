import { diffLines } from 'diff';
import * as vscode from 'vscode';
import type { CodeNeatApp } from './app';

interface Hunk {
  /** First changed line in the formatted text (zero-based). */
  line: number;
  /** Number of new or changed lines; 0 when lines were only removed. */
  added: number;
  /** The text these lines replaced. */
  before: string;
}

interface Session {
  uri: vscode.Uri;
  original: string;
  formatted: string;
  hunks: Hunk[];
  formatterName: string;
}

const CONTEXT_KEY = 'codeneat.inlineReviewActive';

/** Works out which lines of the formatted text are new, and what they replaced. */
export function computeHunks(original: string, formatted: string): Hunk[] {
  const hunks: Hunk[] = [];
  let line = 0;
  let pendingRemoved: string | undefined;
  const count = (value: string, reported?: number): number => reported ?? value.split('\n').length - (value.endsWith('\n') ? 1 : 0);
  for (const part of diffLines(original.replace(/\r\n?/g, '\n'), formatted.replace(/\r\n?/g, '\n'))) {
    const lines = count(part.value, part.count);
    if (part.removed) {
      pendingRemoved = (pendingRemoved ?? '') + part.value;
    } else if (part.added) {
      hunks.push({ line, added: lines, before: pendingRemoved ?? '' });
      pendingRemoved = undefined;
      line += lines;
    } else {
      if (pendingRemoved !== undefined) {
        hunks.push({ line, added: 0, before: pendingRemoved });
        pendingRemoved = undefined;
      }
      line += lines;
    }
  }
  if (pendingRemoved !== undefined) {
    hunks.push({ line, added: 0, before: pendingRemoved });
  }
  return hunks;
}

/**
 * Inline review: the formatted code is shown directly in the editor with every changed line
 * highlighted. Enter keeps the changes, Escape puts the original text back. Nothing is saved by
 * CodeNeat while a review is open.
 */
export class InlineReview implements vscode.Disposable, vscode.CodeLensProvider {
  private readonly sessions = new Map<string, Session>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly lensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensEmitter.event;
  /** True while CodeNeat itself is editing a document, so its own edits do not end the review. */
  private applying = false;

  private readonly addedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor('editorGutter.addedBackground'),
  });

  private readonly removedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    borderWidth: '2px 0 0 0',
    borderStyle: 'dashed',
    borderColor: new vscode.ThemeColor('editorGutter.deletedBackground'),
  });

  constructor(private readonly app: CodeNeatApp) {
    this.disposables.push(
      this.addedDecoration,
      this.removedDecoration,
      this.lensEmitter,
      vscode.languages.registerCodeLensProvider({ scheme: '*' }, this),
      vscode.window.onDidChangeActiveTextEditor(() => this.render()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
      vscode.workspace.onDidChangeTextDocument((event) => {
        // Typing during a review means the user has moved on: the formatted text is kept.
        const session = this.sessions.get(event.document.uri.toString());
        if (session && !this.applying && event.contentChanges.length > 0 && event.document.getText() !== session.formatted) {
          this.end(session.uri);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => this.end(document.uri)),
    );
  }

  isActive(uri?: vscode.Uri): boolean {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    return !!target && this.sessions.has(target.toString());
  }

  /** Formats the document in place and marks what changed. Returns true when a review was started. */
  /**
   * @param prompt also show a message with Keep and Undo buttons, for people who start the review
   *               with the mouse and may not know the Enter and Escape keys.
   */
  async start(editor: vscode.TextEditor, prompt = false): Promise<boolean> {
    const document = editor.document;
    this.end(document.uri);
    const original = document.getText();
    const { result, error } = await this.app.formatDocument(document);
    if (error) {
      void this.app.reportError(error, document.uri.toString());
      return false;
    }
    if (!result) {
      return false;
    }
    if (!result.changed) {
      vscode.window.setStatusBarMessage(`$(check) CodeNeat: already formatted (${result.formatterName})`, 3000);
      return false;
    }
    if (document.getText() !== original) {
      vscode.window.showWarningMessage('CodeNeat: The file changed while it was being formatted, so nothing was applied. Please try again.');
      return false;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, this.app.toEdits(document, original, result.text));
    this.applying = true;
    let applied = false;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } finally {
      this.applying = false;
    }
    if (!applied) {
      return false;
    }
    const formatted = document.getText();
    const hunks = computeHunks(original, formatted);
    this.sessions.set(document.uri.toString(), { uri: document.uri, original, formatted, hunks, formatterName: result.formatterName });
    this.render();
    const first = hunks[0];
    if (first) {
      editor.revealRange(new vscode.Range(first.line, 0, first.line, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
    vscode.window.setStatusBarMessage(`$(diff) CodeNeat: review the highlighted changes — Enter keeps them, Escape undoes them`, 8000);
    if (prompt) {
      void this.ask(document.uri, hunks.length, result.formatterName);
    }
    return true;
  }

  private async ask(uri: vscode.Uri, changes: number, formatterName: string): Promise<void> {
    const keep = 'Keep Changes';
    const undo = 'Undo Changes';
    const name = uri.path.split('/').pop() ?? 'this file';
    const choice = await vscode.window.showInformationMessage(
      `CodeNeat formatted ${name} with ${formatterName}: ${changes} ${changes === 1 ? 'change is' : 'changes are'} highlighted in green. Keep them?`,
      keep,
      undo,
    );
    // The review may already have been answered with Enter or Escape, or ended by typing.
    if (!this.sessions.has(uri.toString())) {
      return;
    }
    if (choice === keep) {
      this.keep(uri);
    } else if (choice === undo) {
      await this.discard(uri);
    }
  }

  /** Keeps the formatted text and removes the highlights. */
  keep(uri?: vscode.Uri): boolean {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!target || !this.sessions.has(target.toString())) {
      return false;
    }
    this.end(target);
    vscode.window.setStatusBarMessage('$(check) CodeNeat: changes kept', 3000);
    return true;
  }

  /** Puts the original text back. */
  async discard(uri?: vscode.Uri): Promise<boolean> {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    const session = target ? this.sessions.get(target.toString()) : undefined;
    const document = session ? vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === session.uri.toString()) : undefined;
    if (!session || !document) {
      return false;
    }
    this.end(session.uri);
    if (document.getText() !== session.formatted) {
      vscode.window.showWarningMessage('CodeNeat: The file was edited after formatting, so the original text was not restored. Use Undo instead.');
      return false;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, this.app.toEdits(document, session.formatted, session.original));
    const restored = await vscode.workspace.applyEdit(edit);
    if (restored) {
      vscode.window.setStatusBarMessage('$(discard) CodeNeat: formatting undone', 3000);
    }
    return restored;
  }

  private end(uri: vscode.Uri): void {
    if (this.sessions.delete(uri.toString())) {
      this.render();
    }
  }

  private render(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const session = this.sessions.get(editor.document.uri.toString());
      const added: vscode.DecorationOptions[] = [];
      const removed: vscode.DecorationOptions[] = [];
      for (const hunk of session?.hunks ?? []) {
        const hover = new vscode.MarkdownString();
        if (hunk.before) {
          hover.appendMarkdown('**Before formatting**\n');
          hover.appendCodeblock(hunk.before.replace(/\n$/, ''), editor.document.languageId);
        } else {
          hover.appendMarkdown('**Added by formatting**');
        }
        const lastLine = Math.max(0, editor.document.lineCount - 1);
        if (hunk.added > 0) {
          const start = Math.min(hunk.line, lastLine);
          const end = Math.min(hunk.line + hunk.added - 1, lastLine);
          added.push({ range: new vscode.Range(start, 0, end, 0), hoverMessage: hover });
        } else {
          const line = Math.min(hunk.line, lastLine);
          removed.push({ range: new vscode.Range(line, 0, line, 0), hoverMessage: hover });
        }
      }
      editor.setDecorations(this.addedDecoration, added);
      editor.setDecorations(this.removedDecoration, removed);
    }
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, this.isActive());
    this.lensEmitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const session = this.sessions.get(document.uri.toString());
    if (!session) {
      return [];
    }
    const lenses: vscode.CodeLens[] = [];
    const total = session.hunks.length;
    const place = (line: number): vscode.Range => {
      const safe = Math.min(Math.max(line, 0), Math.max(0, document.lineCount - 1));
      return new vscode.Range(safe, 0, safe, 0);
    };
    const top = place(session.hunks[0]?.line ?? 0);
    lenses.push(
      new vscode.CodeLens(top, { title: `CodeNeat (${session.formatterName}): ${total} ${total === 1 ? 'change' : 'changes'} highlighted`, command: '' }),
      new vscode.CodeLens(top, { title: '$(check) Keep (Enter)', command: 'codeneat.keepInlineReview', arguments: [document.uri] }),
      new vscode.CodeLens(top, { title: '$(discard) Undo (Esc)', command: 'codeneat.discardInlineReview', arguments: [document.uri] }),
    );
    return lenses;
  }

  dispose(): void {
    this.sessions.clear();
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, false);
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
