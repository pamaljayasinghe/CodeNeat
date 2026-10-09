import * as vscode from 'vscode';
import { chooseFormatter } from '../shared/resolve';
import { allProfiles } from '../shared/profiles';
import { EXPORT_FORMAT, EXPORT_VERSION, parseSettingsExport } from '../shared/validate';
import type { CodeNeatApp } from './app';
import { EXTENSION_ID } from './configuration';
import { openDiagnostics } from './diagnostics';
import { installFormatter } from './install';
import { formatWorkspace } from './workspaceFormat';

export const PREVIEW_SCHEME = 'codeneat-preview';

/** Serves formatted text for the diff editor opened by "Preview Formatting". */
export class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
    if (this.contents.size > 20) {
      const oldest = this.contents.keys().next().value;
      if (oldest !== undefined) {
        this.contents.delete(oldest);
      }
    }
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  dispose(): void {
    this.contents.clear();
    this.emitter.dispose();
  }
}

function activeEditor(app: CodeNeatApp): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor ?? app.lastEditor;
  if (!editor) {
    vscode.window.showInformationMessage('CodeNeat: Open a file first.');
    return undefined;
  }
  if (editor.document.uri.scheme === PREVIEW_SCHEME) {
    vscode.window.showInformationMessage('CodeNeat: This is a formatting preview. Switch to the original file to format it.');
    return undefined;
  }
  return editor;
}

async function applyToEditor(app: CodeNeatApp, editor: vscode.TextEditor, original: string, formatted: string): Promise<boolean> {
  const document = editor.document;
  if (document.getText() !== original) {
    vscode.window.showWarningMessage('CodeNeat: The file changed while it was being formatted, so nothing was applied. Please try again.');
    return false;
  }
  const edits = app.toEdits(document, original, formatted);
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.set(document.uri, edits);
  // One WorkspaceEdit is one undo step, exactly like VS Code's own Format Document.
  return vscode.workspace.applyEdit(workspaceEdit);
}

function changedLineCount(original: string, formatted: string): number {
  const before = original.split(/\r?\n/);
  const after = new Set(formatted.split(/\r?\n/));
  return Math.max(1, before.filter((line) => !after.has(line)).length);
}

export function registerCommands(app: CodeNeatApp, openDashboard: (page?: string, languageId?: string) => void): vscode.Disposable {
  const previews = new PreviewContentProvider();

  const formatDocument = async (range?: vscode.Range): Promise<void> => {
    const editor = activeEditor(app);
    if (!editor) {
      return;
    }
    const original = editor.document.getText();
    const { result, error } = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'CodeNeat: formatting…' },
      () => app.formatDocument(editor.document, range),
    );
    if (error) {
      if (range && error.kind === 'unsupported') {
        const whole = 'Format Whole Document';
        const choice = await vscode.window.showInformationMessage(`CodeNeat: ${error.message}`, whole);
        if (choice === whole) {
          await formatDocument();
        }
        return;
      }
      void app.reportError(error, editor.document.uri.toString());
      return;
    }
    if (!result) {
      return;
    }
    if (!result.changed) {
      vscode.window.setStatusBarMessage(`$(check) CodeNeat: already formatted (${result.formatterName})`, 3000);
      return;
    }
    if (await applyToEditor(app, editor, original, result.text)) {
      vscode.window.setStatusBarMessage(`$(check) CodeNeat: formatted with ${result.formatterName}`, 3000);
    }
  };

  const previewFormatting = async (): Promise<void> => {
    const editor = activeEditor(app);
    if (!editor) {
      return;
    }
    const { result, error } = await app.formatDocument(editor.document);
    if (error) {
      void app.reportError(error, editor.document.uri.toString());
      return;
    }
    if (!result) {
      return;
    }
    if (!result.changed) {
      vscode.window.showInformationMessage(`CodeNeat: This file is already formatted (${result.formatterName}).`);
      return;
    }
    const name = editor.document.fileName.split(/[\\/]/).pop() ?? 'file';
    const uri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${name}`, query: encodeURIComponent(editor.document.uri.toString()) });
    previews.set(uri, result.text);
    await vscode.commands.executeCommand('vscode.diff', editor.document.uri, uri, `${name}: Current ↔ Formatted by ${result.formatterName}`, {
      preview: true,
    });
  };

  const checkFormatting = async (): Promise<void> => {
    const editor = activeEditor(app);
    if (!editor) {
      return;
    }
    const original = editor.document.getText();
    const { result, error } = await app.formatDocument(editor.document);
    if (error) {
      void app.reportError(error, editor.document.uri.toString());
      return;
    }
    if (!result) {
      return;
    }
    if (!result.changed) {
      vscode.window.showInformationMessage(`CodeNeat: This file is correctly formatted (${result.formatterName}).`);
      return;
    }
    const lines = changedLineCount(original, result.text);
    const show = 'Show Changes';
    const apply = 'Format Now';
    const choice = await vscode.window.showWarningMessage(
      `CodeNeat: This file is not formatted. About ${lines} ${lines === 1 ? 'line' : 'lines'} would change (${result.formatterName}).`,
      show,
      apply,
    );
    if (choice === show) {
      await previewFormatting();
    } else if (choice === apply) {
      await applyToEditor(app, editor, original, result.text);
    }
  };

  const selectFormatter = async (): Promise<void> => {
    const editor = activeEditor(app);
    const language = editor ? app.languageOf(editor.document) : undefined;
    if (!editor || !language) {
      if (editor) {
        vscode.window.showInformationMessage(`CodeNeat does not support "${editor.document.languageId}" files yet.`);
      }
      return;
    }
    const env = app.environment();
    const settings = app.config.read(editor.document.uri);
    const statuses = await app.registry.detectAll(env);
    const choice = chooseFormatter(language, app.registry.descriptors, statuses, settings.user, settings.workspace);
    type Item = vscode.QuickPickItem & { id?: string };
    const items: Item[] = [
      {
        label: '$(sparkle) Automatic',
        description: 'Use the first formatter that is installed',
        detail: choice.explicit ? undefined : `Currently: ${choice.formatter?.displayName ?? 'none'}`,
      },
      ...choice.candidates.map((candidate): Item => {
        const status = statuses[candidate.id];
        return {
          id: candidate.id,
          label: `${status?.available ? '$(check)' : '$(circle-slash)'} ${candidate.displayName}`,
          description: [candidate.kind === 'bundled' ? 'bundled' : status?.available ? `installed${status.version ? ` ${status.version}` : ''}` : 'not installed', choice.explicit && choice.formatter?.id === candidate.id ? 'selected' : '']
            .filter(Boolean)
            .join(' · '),
          detail: status?.available ? candidate.engine : candidate.install.summary,
        };
      }),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: `CodeNeat: Formatter for ${language.label}`,
      placeHolder: 'Choose the formatter CodeNeat should use for this language',
    });
    if (!picked) {
      return;
    }
    await app.config.updateUserLanguage(language.id, (entry) => ({ ...entry, formatter: picked.id }));
    if (picked.id && !statuses[picked.id]?.available) {
      const guide = 'Setup Guide';
      const answer = await vscode.window.showWarningMessage(
        `CodeNeat: ${picked.label.replace(/^\$\([^)]*\)\s*/, '')} is selected for ${language.label}, but it is not installed yet.`,
        guide,
      );
      if (answer === guide) {
        openDashboard('formatters');
      }
    }
  };

  const selectProfile = async (): Promise<void> => {
    const settings = app.config.read(app.lastEditor?.document.uri);
    const profiles = allProfiles(settings.profiles);
    const current = settings.workspace.defaultProfile ?? settings.user.defaultProfile ?? 'standard';
    const picked = await vscode.window.showQuickPick(
      profiles.map((profile) => ({
        label: profile.name,
        description: [profile.builtin ? 'built-in' : 'custom', profile.id === current ? 'current default' : ''].filter(Boolean).join(' · '),
        detail: profile.description,
        id: profile.id,
      })),
      { title: 'CodeNeat: Select Profile', placeHolder: 'Choose a formatting profile' },
    );
    if (!picked) {
      return;
    }
    const language = app.lastEditor ? app.languageOf(app.lastEditor.document) : undefined;
    type Scope = vscode.QuickPickItem & { scope: 'user' | 'workspace' | 'language' };
    const scopes: Scope[] = [{ label: 'All languages (my settings)', scope: 'user' }];
    if (app.config.hasWorkspace) {
      scopes.push({ label: 'All languages in this workspace', scope: 'workspace' });
    }
    if (language) {
      scopes.push({ label: `Only ${language.label} (my settings)`, scope: 'language' });
    }
    const scope = scopes.length === 1 ? scopes[0] : await vscode.window.showQuickPick(scopes, { title: `Use "${picked.label}" for…` });
    if (!scope) {
      return;
    }
    if (scope.scope === 'language' && language) {
      await app.config.updateUserLanguage(language.id, (entry) => ({ ...entry, profile: picked.id }));
    } else {
      await app.config.setDefaultProfile(
        picked.id,
        scope.scope === 'workspace' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global,
      );
    }
    vscode.window.setStatusBarMessage(`$(check) CodeNeat: profile "${picked.label}" selected`, 3000);
  };

  const exportSettings = async (): Promise<void> => {
    const settings = app.config.read();
    const target = await vscode.window.showSaveDialog({
      title: 'Export CodeNeat Settings',
      defaultUri: vscode.workspace.workspaceFolders?.[0]
        ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'codeneat-settings.json')
        : undefined,
      filters: { 'CodeNeat settings': ['json'] },
    });
    if (!target) {
      return;
    }
    const data = {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedBy: `CodeNeat ${app.version}`,
      style: settings.user.style,
      languages: settings.user.languages,
      defaultProfile: settings.user.defaultProfile,
      profiles: settings.profiles,
    };
    await vscode.workspace.fs.writeFile(target, Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'));
    vscode.window.showInformationMessage(`CodeNeat: Settings exported to ${target.fsPath}.`);
  };

  const importSettings = async (): Promise<void> => {
    const picked = await vscode.window.showOpenDialog({
      title: 'Import CodeNeat Settings',
      canSelectMany: false,
      filters: { 'CodeNeat settings': ['json'] },
      openLabel: 'Import',
    });
    if (!picked?.[0]) {
      return;
    }
    try {
      const data = await vscode.workspace.fs.readFile(picked[0]);
      if (data.byteLength > 2_000_000) {
        throw new Error('The file is too large to be a CodeNeat settings file.');
      }
      const parsed = parseSettingsExport(Buffer.from(data).toString('utf8'));
      const profileCount = Object.keys(parsed.profiles).length;
      const confirm = 'Replace My Settings';
      const answer = await vscode.window.showWarningMessage(
        'Import these CodeNeat settings?',
        {
          modal: true,
          detail: `Your personal CodeNeat style and per-language choices will be replaced. ${profileCount} custom ${profileCount === 1 ? 'profile' : 'profiles'} will be added. Workspace settings and tool paths are not affected.`,
        },
        confirm,
      );
      if (answer !== confirm) {
        return;
      }
      await app.config.importUserSettings(parsed);
      vscode.window.showInformationMessage('CodeNeat: Settings imported.');
    } catch (error) {
      vscode.window.showErrorMessage(`CodeNeat: Could not import settings. ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const setAsDefaultFormatter = async (): Promise<void> => {
    const language = app.lastEditor ? app.languageOf(app.lastEditor.document) : undefined;
    const vscodeLanguageId = app.lastEditor?.document.languageId;
    type Item = vscode.QuickPickItem & { languageId?: string; target: vscode.ConfigurationTarget };
    const items: Item[] = [];
    if (language && vscodeLanguageId) {
      items.push({ label: `For ${language.label} files`, description: 'my settings', languageId: vscodeLanguageId, target: vscode.ConfigurationTarget.Global });
      if (app.config.hasWorkspace) {
        items.push({ label: `For ${language.label} files`, description: 'this workspace', languageId: vscodeLanguageId, target: vscode.ConfigurationTarget.Workspace });
      }
    }
    items.push({ label: 'For all languages', description: 'my settings', target: vscode.ConfigurationTarget.Global });
    if (app.config.hasWorkspace) {
      items.push({ label: 'For all languages', description: 'this workspace', target: vscode.ConfigurationTarget.Workspace });
    }
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Use CodeNeat as the Default Formatter',
      placeHolder: 'Format on Save, Paste and Type use the default formatter',
    });
    if (!picked) {
      return;
    }
    const config = vscode.workspace.getConfiguration('editor', picked.languageId ? { languageId: picked.languageId } : null);
    const inspected = config.inspect<string>('defaultFormatter');
    const existing = picked.languageId
      ? picked.target === vscode.ConfigurationTarget.Global
        ? inspected?.globalLanguageValue
        : inspected?.workspaceLanguageValue
      : picked.target === vscode.ConfigurationTarget.Global
        ? inspected?.globalValue
        : inspected?.workspaceValue;
    if (existing && existing !== EXTENSION_ID) {
      const replace = 'Replace';
      const answer = await vscode.window.showWarningMessage(
        `"${existing}" is currently the default formatter here. Replace it with CodeNeat?`,
        { modal: true },
        replace,
      );
      if (answer !== replace) {
        return;
      }
    }
    await config.update('defaultFormatter', EXTENSION_ID, picked.target, !!picked.languageId);
    const note =
      !picked.languageId && inspected?.languageIds?.length
        ? ' Some languages have their own default formatter in your settings; those were left as they are.'
        : '';
    vscode.window.showInformationMessage(`CodeNeat is now the default formatter ${picked.label.toLowerCase()} (${picked.description}).${note}`);
  };

  return vscode.Disposable.from(
    previews,
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, previews),
    vscode.commands.registerCommand('codeneat.formatDocument', () => formatDocument()),
    vscode.commands.registerCommand('codeneat.formatSelection', async () => {
      const editor = activeEditor(app);
      if (!editor) {
        return;
      }
      if (editor.selection.isEmpty) {
        vscode.window.showInformationMessage('CodeNeat: Select the code you want to format first.');
        return;
      }
      await formatDocument(new vscode.Range(editor.selection.start, editor.selection.end));
    }),
    vscode.commands.registerCommand('codeneat.formatWorkspace', (resource?: vscode.Uri) =>
      formatWorkspace(app, resource instanceof vscode.Uri ? resource : undefined),
    ),
    vscode.commands.registerCommand('codeneat.previewFormatting', previewFormatting),
    vscode.commands.registerCommand('codeneat.checkFormatting', checkFormatting),
    vscode.commands.registerCommand('codeneat.openSettings', (page?: unknown, languageId?: unknown) =>
      openDashboard(typeof page === 'string' ? page : undefined, typeof languageId === 'string' ? languageId : undefined),
    ),
    vscode.commands.registerCommand('codeneat.selectFormatter', selectFormatter),
    vscode.commands.registerCommand('codeneat.selectProfile', selectProfile),
    vscode.commands.registerCommand('codeneat.manageFormatters', () => openDashboard('formatters')),
    vscode.commands.registerCommand('codeneat.openDiagnostics', () => openDiagnostics(app)),
    vscode.commands.registerCommand('codeneat.importSettings', importSettings),
    vscode.commands.registerCommand('codeneat.exportSettings', exportSettings),
    vscode.commands.registerCommand('codeneat.setAsDefaultFormatter', setAsDefaultFormatter),
    vscode.commands.registerCommand('codeneat.installFormatter', async (formatterId?: unknown) => {
      let id = typeof formatterId === 'string' ? formatterId : undefined;
      if (!id) {
        const statuses = await app.registry.detectAll(app.environment());
        const missing = app.registry.descriptors.filter((descriptor) => descriptor.kind === 'external' && !statuses[descriptor.id]?.available);
        if (missing.length === 0) {
          vscode.window.showInformationMessage('CodeNeat: Every formatter is already installed.');
          return false;
        }
        const picked = await vscode.window.showQuickPick(
          missing.map((descriptor) => ({
            label: descriptor.displayName,
            description: app.registry.languages.filter((language) => descriptor.languages.includes(language.id)).map((language) => language.label).join(', '),
            detail: descriptor.install.summary,
            id: descriptor.id,
          })),
          { title: 'CodeNeat: Install a Formatter', placeHolder: 'Which formatter do you want to install?', matchOnDescription: true },
        );
        id = picked?.id;
      }
      return id ? installFormatter(app, id) : false;
    }),
    vscode.commands.registerCommand('codeneat.refreshFormatters', async () => {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'CodeNeat: looking for formatters…' }, () =>
        app.refreshFormatters(),
      );
      const statuses = app.registry.statuses;
      const available = Object.values(statuses).filter((status) => status.available).length;
      vscode.window.setStatusBarMessage(`$(check) CodeNeat: ${available} of ${Object.keys(statuses).length} formatters available`, 4000);
    }),
  );
}
