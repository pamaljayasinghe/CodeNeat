import * as path from 'node:path';
import * as vscode from 'vscode';
import { CustomAdapter } from '../adapters/custom';
import { type AdapterEnvironment, FormatterError } from '../core/adapter';
import { computeChanges } from '../core/edits';
import { type DocumentInput, type FormattingResult, type FormattingSettings, FormattingService } from '../core/formattingService';
import { FormatterRegistry } from '../core/registry';
import type { InstallGuide, LanguageDefinition } from '../shared/types';
import { ConfigurationManager } from './configuration';

const APPROVED_KEY = 'codeneat.approvedCommands';

export interface FormatOutcome {
  result?: FormattingResult;
  error?: FormatterError;
}

/** Shared services of the running extension. */
export class CodeNeatApp {
  readonly registry = new FormatterRegistry();
  readonly config = new ConfigurationManager();
  readonly log: vscode.LogOutputChannel;
  readonly service: FormattingService;
  /** The last real text editor, remembered while a CodeNeat webview has the focus. */
  lastEditor: vscode.TextEditor | undefined;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when formatter availability or the custom formatter list changed. */
  readonly onDidChangeFormatters = this.changeEmitter.event;
  private customProblems: string[] = [];
  private readonly reported = new Map<string, number>();

  constructor(readonly context: vscode.ExtensionContext) {
    this.log = vscode.window.createOutputChannel('CodeNeat', { log: true });
    this.service = new FormattingService(this.registry, () => this.environment());
    this.lastEditor = vscode.window.activeTextEditor;
    context.subscriptions.push(this.log, this.changeEmitter);
    this.reloadCustomFormatters();
  }

  get version(): string {
    return String((this.context.extension.packageJSON as { version?: string }).version ?? '0.0.0');
  }

  get approvedCommands(): string[] {
    return this.context.globalState.get<string[]>(APPROVED_KEY, []);
  }

  environment(): AdapterEnvironment {
    const settings = this.config.read();
    return {
      trusted: vscode.workspace.isTrusted,
      toolPaths: vscode.workspace.isTrusted ? settings.toolPaths : {},
      workspaceRoots: (vscode.workspace.workspaceFolders ?? [])
        .filter((folder) => folder.uri.scheme === 'file')
        .map((folder) => folder.uri.fsPath),
      approvedCommands: new Set(this.approvedCommands),
      log: (message) => this.log.debug(message),
    };
  }

  get customFormatterProblems(): string[] {
    return this.customProblems;
  }

  reloadCustomFormatters(): void {
    const { formatters, problems } = vscode.workspace.isTrusted
      ? this.config.customFormatters(this.registry.builtinIds)
      : { formatters: [], problems: [] };
    this.customProblems = problems;
    for (const problem of problems) {
      this.log.warn(`codeneat.customFormatters: ${problem}`);
    }
    this.registry.setCustomFormatters(formatters);
  }

  /** Re-detects every formatter (after an install, a settings change or a trust change). */
  async refreshFormatters(): Promise<void> {
    this.reloadCustomFormatters();
    this.registry.reset();
    await this.registry.detectAll(this.environment());
    this.changeEmitter.fire();
  }

  languageOf(document: vscode.TextDocument): LanguageDefinition | undefined {
    return this.registry.detectLanguage(document.languageId, document.fileName);
  }

  /** Converts a VS Code document into the formatter-independent input of the core service. */
  toInput(document: vscode.TextDocument, range?: vscode.Range): DocumentInput | undefined {
    const language = this.languageOf(document);
    if (!language) {
      return undefined;
    }
    const isFile = document.uri.scheme === 'file';
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    let fileName = path.basename(document.fileName);
    if (!isFile && !path.extname(fileName)) {
      fileName = language.filenames?.[0] ?? `untitled${language.extensions[0] ?? '.txt'}`;
    }
    return {
      text: document.getText(),
      languageId: language.id,
      fileName,
      filePath: isFile ? document.uri.fsPath : undefined,
      workspaceRoot: folder?.uri.scheme === 'file' ? folder.uri.fsPath : undefined,
      range: range ? { start: document.offsetAt(range.start), end: document.offsetAt(range.end) } : undefined,
    };
  }

  /** Asks the user to approve a custom formatter command. Returns true when approved. */
  private async requestApproval(fingerprint: string): Promise<boolean> {
    const adapter = this.registry.adapters.find(
      (candidate): candidate is CustomAdapter => candidate instanceof CustomAdapter && candidate.fingerprint === fingerprint,
    );
    if (!adapter) {
      return false;
    }
    const command = [adapter.config.command, ...(adapter.config.args ?? [])].join(' ');
    const allow = 'Allow This Command';
    const choice = await vscode.window.showWarningMessage(
      `Allow CodeNeat to run the custom formatter "${adapter.descriptor.displayName}"?`,
      {
        modal: true,
        detail: `CodeNeat will run this program on your computer and send it the contents of the files you format:\n\n${command}\n\nOnly allow commands you trust. You will be asked again if the command changes.`,
      },
      allow,
    );
    if (choice !== allow) {
      return false;
    }
    await this.context.globalState.update(APPROVED_KEY, [...new Set([...this.approvedCommands, fingerprint])]);
    this.registry.reset();
    return true;
  }

  /** Formats text, transparently handling the one-time approval of custom formatters. */
  async format(
    input: DocumentInput,
    settings: FormattingSettings,
    token?: vscode.CancellationToken,
    formatterId?: string,
    allowPrompt = true,
  ): Promise<FormatOutcome> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.service.format(input, settings, token, formatterId);
        this.log.info(
          `Formatted ${input.fileName} with ${result.formatterName} in ${result.durationMs} ms (${result.changed ? 'changed' : 'no changes'}).`,
        );
        return { result };
      } catch (error) {
        const formatterError =
          error instanceof FormatterError ? error : new FormatterError('failed', error instanceof Error ? error.message : String(error));
        if (formatterError.kind === 'needs-approval' && attempt === 0 && allowPrompt && formatterError.detail) {
          if (await this.requestApproval(formatterError.detail)) {
            continue;
          }
          return { error: new FormatterError('cancelled', 'The custom formatter was not approved.') };
        }
        if (formatterError.kind !== 'cancelled') {
          this.log.warn(`Could not format ${input.fileName}: ${formatterError.message}`);
          if (formatterError.detail && formatterError.kind === 'failed') {
            this.log.debug(formatterError.detail);
          }
        }
        return { error: formatterError };
      }
    }
    return { error: new FormatterError('failed', 'Formatting failed.') };
  }

  async formatDocument(document: vscode.TextDocument, range?: vscode.Range, token?: vscode.CancellationToken): Promise<FormatOutcome> {
    const input = this.toInput(document, range);
    if (!input) {
      return {
        error: new FormatterError('unsupported', `CodeNeat does not have a formatter for "${document.languageId}" files.`),
      };
    }
    return this.format(input, this.config.formattingSettings(document.uri), token);
  }

  /** Turns a formatting result into minimal editor edits. */
  toEdits(document: vscode.TextDocument, original: string, formatted: string): vscode.TextEdit[] {
    return computeChanges(original, formatted).map(
      (change) => new vscode.TextEdit(new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)), change.text),
    );
  }

  /**
   * Shows a formatting problem to the user. The same problem for the same file is not repeated
   * within a short time, so Format on Save never floods the screen with notifications.
   */
  async reportError(error: FormatterError, subject: string, quiet = false): Promise<void> {
    if (error.kind === 'cancelled') {
      return;
    }
    if (error.kind === 'ignored') {
      vscode.window.setStatusBarMessage(`CodeNeat: ${error.message}`, 4000);
      return;
    }
    const key = `${subject}|${error.kind}|${error.message}`;
    const now = Date.now();
    const last = this.reported.get(key);
    if (quiet && last !== undefined && now - last < 30000) {
      vscode.window.setStatusBarMessage('$(warning) CodeNeat could not format this file (see earlier message)', 4000);
      return;
    }
    this.reported.set(key, now);
    if (this.reported.size > 200) {
      this.reported.clear();
    }

    const actions: string[] = [];
    const missing = error.kind === 'missing' && error.formatterId ? this.registry.get(error.formatterId)?.descriptor : undefined;
    const install = missing?.kind === 'external' ? `Install ${missing.displayName}…` : undefined;
    if (error.kind === 'missing') {
      if (install) {
        actions.push(install);
      }
      actions.push('Setup Guide');
    } else if (error.kind === 'untrusted') {
      actions.push('Manage Workspace Trust');
    } else if (error.kind === 'too-large') {
      actions.push('Open Settings');
    } else {
      actions.push('Show Log');
    }
    const message = error.kind === 'missing' ? (install ? error.message.split('\n')[0] : missingMessage(error.message, error.install)) : error.message;
    const show = error.kind === 'missing' || error.kind === 'untrusted' ? vscode.window.showWarningMessage : vscode.window.showErrorMessage;
    const choice = await show(`CodeNeat: ${message}`, ...actions);
    if (install && choice === install && missing) {
      // The user asked for it: install, and when that worked, format the file they were on.
      if (await vscode.commands.executeCommand<boolean>('codeneat.installFormatter', missing.id)) {
        await vscode.commands.executeCommand('codeneat.formatDocument');
      }
      return;
    }
    switch (choice) {
      case 'Setup Guide':
        await vscode.commands.executeCommand('codeneat.manageFormatters');
        break;
      case 'Manage Workspace Trust':
        await vscode.commands.executeCommand('workbench.trust.manage');
        break;
      case 'Open Settings':
        await vscode.commands.executeCommand('codeneat.openSettings', 'advanced');
        break;
      case 'Show Log':
        this.log.show(true);
        break;
    }
  }
}

function missingMessage(message: string, install?: InstallGuide): string {
  const command = install?.commands[0]?.command;
  return command ? `${message} For example: ${command}` : message;
}
