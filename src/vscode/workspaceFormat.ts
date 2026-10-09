import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { looksBinary, looksGenerated, scanFolder, type ScannedFile } from '../core/workspaceScan';
import type { CodeNeatApp } from './app';

interface Candidate {
  file: ScannedFile;
  original: string;
  formatted: string;
  formatterName: string;
  /** Version of the open document the result was computed from, if the file is open. */
  documentVersion?: number;
  bom: boolean;
}

interface Report {
  folder: string;
  scanned: number;
  unchanged: number;
  changed: string[];
  skipped: { file: string; reason: string }[];
  failed: { file: string; reason: string }[];
  truncated: boolean;
}

const CONCURRENCY = 4;

function decodeUtf8(data: Buffer): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    return undefined;
  }
}

function openDocument(filePath: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'file' && document.uri.fsPath === filePath);
}

async function pickFolder(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (resource?.scheme === 'file') {
    return resource;
  }
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file');
  const browse = 'Choose another folder…';
  const items: (vscode.QuickPickItem & { uri?: vscode.Uri })[] = folders.map((folder) => ({
    label: `$(root-folder) ${folder.name}`,
    description: folder.uri.fsPath,
    uri: folder.uri,
  }));
  items.push({ label: `$(folder-opened) ${browse}` });
  const picked =
    folders.length === 0
      ? items[items.length - 1]
      : await vscode.window.showQuickPick(items, {
          title: 'CodeNeat: Format Workspace',
          placeHolder: 'Which folder do you want to format?',
        });
  if (!picked) {
    return undefined;
  }
  if (picked.uri) {
    return picked.uri;
  }
  const chosen = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: folders[0]?.uri,
    openLabel: 'Format This Folder',
  });
  return chosen?.[0];
}

/**
 * Formats many files: scan → dry run → let the user review → confirm → write. Nothing on disk is
 * touched before the user has confirmed the exact list of files.
 */
export async function formatWorkspace(app: CodeNeatApp, resource?: vscode.Uri): Promise<void> {
  const folder = await pickFolder(resource);
  if (!folder) {
    return;
  }
  const root = folder.fsPath;
  const settings = app.config.read(folder);
  const formatting = app.config.formattingSettings(folder);
  const report: Report = { folder: root, scanned: 0, unchanged: 0, changed: [], skipped: [], failed: [], truncated: false };
  const candidates: Candidate[] = [];

  const finished = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeNeat', cancellable: true },
    async (progress, token) => {
      progress.report({ message: 'Looking for files CodeNeat can format…' });
      const scan = await scanFolder(root, {
        languages: app.registry.languages.filter((language) => language.formatters.length > 0),
        exclude: settings.workspaceExclude,
        useGitignore: settings.useGitignore,
        token,
      });
      if (token.isCancellationRequested) {
        return false;
      }
      report.scanned = scan.files.length;
      report.truncated = scan.truncated;

      let done = 0;
      let next = 0;
      const unavailable = new Map<string, string>();
      const worker = async (): Promise<void> => {
        while (next < scan.files.length && !token.isCancellationRequested) {
          const file = scan.files[next++];
          try {
            const skipReason = unavailable.get(file.languageId);
            if (skipReason) {
              report.skipped.push({ file: file.relative, reason: skipReason });
              continue;
            }
            const document = openDocument(file.path);
            let text: string;
            let bom = false;
            if (document) {
              text = document.getText();
            } else {
              const data = await fs.promises.readFile(file.path);
              if (data.length / 1024 > settings.maxFileSizeKB) {
                report.skipped.push({ file: file.relative, reason: 'larger than the file size limit' });
                continue;
              }
              if (looksBinary(data)) {
                report.skipped.push({ file: file.relative, reason: 'binary file' });
                continue;
              }
              const decoded = decodeUtf8(data);
              if (decoded === undefined) {
                report.skipped.push({ file: file.relative, reason: 'not UTF-8 text' });
                continue;
              }
              bom = decoded.charCodeAt(0) === 0xfeff;
              text = bom ? decoded.slice(1) : decoded;
            }
            if (looksGenerated(text)) {
              report.skipped.push({ file: file.relative, reason: 'marked as generated' });
              continue;
            }
            const outcome = await app.format(
              { text, languageId: file.languageId, fileName: path.basename(file.path), filePath: file.path, workspaceRoot: root },
              formatting,
              token,
              undefined,
              false,
            );
            if (outcome.error) {
              const { kind, message } = outcome.error;
              if (kind === 'cancelled') {
                return;
              }
              if (kind === 'ignored') {
                report.skipped.push({ file: file.relative, reason: 'ignored by project configuration' });
              } else if (kind === 'missing' || kind === 'untrusted' || kind === 'needs-approval') {
                // The same formatter is missing for every file of this language: say so once per file, cheaply.
                const reason = message.split('\n')[0];
                unavailable.set(file.languageId, reason);
                report.skipped.push({ file: file.relative, reason });
              } else if (kind === 'too-large') {
                report.skipped.push({ file: file.relative, reason: 'larger than the file size limit' });
              } else {
                report.failed.push({ file: file.relative, reason: message.split('\n').slice(0, 2).join(' ') });
              }
              continue;
            }
            if (outcome.result?.changed) {
              candidates.push({
                file,
                original: text,
                formatted: outcome.result.text,
                formatterName: outcome.result.formatterName,
                documentVersion: document?.version,
                bom,
              });
            } else {
              report.unchanged++;
            }
          } catch (error) {
            report.failed.push({ file: file.relative, reason: error instanceof Error ? error.message : String(error) });
          } finally {
            done++;
            progress.report({
              message: `Checking ${done} of ${scan.files.length} files…`,
              increment: scan.files.length ? 100 / scan.files.length : 100,
            });
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      return !token.isCancellationRequested;
    },
  );

  if (!finished) {
    vscode.window.showInformationMessage('CodeNeat: Workspace formatting was cancelled. No files were changed.');
    return;
  }

  candidates.sort((a, b) => a.file.relative.localeCompare(b.file.relative));
  if (candidates.length === 0) {
    writeReport(app, report);
    const problems = report.failed.length + report.skipped.length;
    const message =
      report.scanned === 0
        ? 'CodeNeat: No supported files were found in this folder.'
        : `CodeNeat: All ${report.unchanged} checked files are already formatted.${problems ? ` ${problems} files were skipped or could not be checked.` : ''}`;
    const choice = await vscode.window.showInformationMessage(message, ...(problems ? ['Show Report'] : []));
    if (choice) {
      app.log.show(true);
    }
    return;
  }

  // Preview of affected files; the user chooses exactly which ones may be rewritten.
  const picked = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.file.relative,
      description: candidate.formatterName,
      picked: true,
      candidate,
    })),
    {
      canPickMany: true,
      title: `CodeNeat: ${candidates.length} of ${report.scanned} files would change`,
      placeHolder: 'Untick any file you do not want to format, then press Enter',
      matchOnDescription: true,
    },
  );
  if (!picked || picked.length === 0) {
    vscode.window.showInformationMessage('CodeNeat: No files were changed.');
    return;
  }

  const confirm = `Format ${picked.length} ${picked.length === 1 ? 'File' : 'Files'}`;
  const answer = await vscode.window.showWarningMessage(
    `Format ${picked.length} ${picked.length === 1 ? 'file' : 'files'} in "${path.basename(root)}"?`,
    {
      modal: true,
      detail:
        'The selected files will be rewritten with their formatted content. Files that are open with unsaved changes are updated in the editor but not saved. If you use Git, commit first so the change is easy to review.',
    },
    confirm,
  );
  if (answer !== confirm) {
    vscode.window.showInformationMessage('CodeNeat: No files were changed.');
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'CodeNeat', cancellable: true },
    async (progress, token) => {
      let index = 0;
      for (const { candidate } of picked) {
        if (token.isCancellationRequested) {
          report.skipped.push({ file: candidate.file.relative, reason: 'cancelled before it was written' });
          continue;
        }
        index++;
        progress.report({ message: `Formatting ${index} of ${picked.length}: ${candidate.file.relative}`, increment: 100 / picked.length });
        try {
          const reason = await writeCandidate(app, candidate);
          if (reason) {
            report.skipped.push({ file: candidate.file.relative, reason });
          } else {
            report.changed.push(candidate.file.relative);
          }
        } catch (error) {
          report.failed.push({ file: candidate.file.relative, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    },
  );

  writeReport(app, report);
  const summary = `CodeNeat: Formatted ${report.changed.length} ${report.changed.length === 1 ? 'file' : 'files'}` +
    (report.skipped.length ? `, skipped ${report.skipped.length}` : '') +
    (report.failed.length ? `, ${report.failed.length} with errors` : '') +
    '.';
  const choice = await vscode.window.showInformationMessage(summary, 'Show Report');
  if (choice) {
    app.log.show(true);
  }
}

/** Writes one formatted file. Returns a reason when the file had to be skipped. */
async function writeCandidate(app: CodeNeatApp, candidate: Candidate): Promise<string | undefined> {
  const document = openDocument(candidate.file.path);
  if (document) {
    // The file is open: edit it through the editor so undo works and unsaved work is kept.
    if (document.getText() !== candidate.original || (candidate.documentVersion !== undefined && document.version !== candidate.documentVersion)) {
      return 'changed in the editor after it was checked';
    }
    const wasDirty = document.isDirty;
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, app.toEdits(document, candidate.original, candidate.formatted));
    if (!(await vscode.workspace.applyEdit(edit))) {
      return 'the editor rejected the change';
    }
    if (!wasDirty) {
      await document.save();
    }
    return undefined;
  }

  // The file is closed: make sure it has not changed on disk since it was read.
  const current = await fs.promises.readFile(candidate.file.path);
  const decoded = decodeUtf8(current);
  const currentText = decoded === undefined ? undefined : decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  if (currentText !== candidate.original) {
    return 'changed on disk after it was checked';
  }
  const content = (candidate.bom ? '﻿' : '') + candidate.formatted;
  await fs.promises.writeFile(candidate.file.path, content, 'utf8');
  return undefined;
}

function writeReport(app: CodeNeatApp, report: Report): void {
  const lines = [
    '──────── Format Workspace report ────────',
    `Folder: ${report.folder}`,
    `Supported files found: ${report.scanned}${report.truncated ? ' (stopped at the file limit; format sub-folders separately to cover the rest)' : ''}`,
    `Formatted: ${report.changed.length}`,
    `Already formatted: ${report.unchanged}`,
    `Skipped: ${report.skipped.length}`,
    `Errors: ${report.failed.length}`,
  ];
  if (report.changed.length) {
    lines.push('', 'Formatted files:', ...report.changed.map((file) => `  ${file}`));
  }
  if (report.skipped.length) {
    lines.push('', 'Skipped files:', ...report.skipped.map((entry) => `  ${entry.file} — ${entry.reason}`));
  }
  if (report.failed.length) {
    lines.push('', 'Files with errors:', ...report.failed.map((entry) => `  ${entry.file} — ${entry.reason}`));
  }
  app.log.info(lines.join('\n'));
}
