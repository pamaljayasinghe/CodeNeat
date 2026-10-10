import * as vscode from 'vscode';
import { chooseFormatter } from '../shared/resolve';
import { allProfiles } from '../shared/profiles';
import { EXPORT_FORMAT, EXPORT_VERSION, parseSettingsExport } from '../shared/validate';
import type { CodeNeatApp } from './app';
import { EXTENSION_ID } from './configuration';
import { openDiagnostics } from './diagnostics';
import { installFormatter } from './install';
import type { InlineReview } from './inlineReview';
import { changedLineCount, type LivePreview, PREVIEW_SCHEME } from './livePreview';
import { formatWorkspace } from './workspaceFormat';

export { PREVIEW_SCHEME } from './livePreview';

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
  // All replacements go into one editor edit with explicit undo stops, so a single Undo always
  // restores the whole file, exactly like VS Code's own Format Document.
  return editor.edit(
    (builder) => {
      for (const edit of edits) {
        builder.replace(edit.range, edit.newText);
      }
    },
    { undoStopBefore: true, undoStopAfter: true },
  );
}

export function registerCommands(app: CodeNeatApp, openDashboard: (page?: string, languageId?: string) => void, live: LivePreview, review: InlineReview): vscode.Disposable {

  const formatDocument = async (range?: vscode.Range): Promise<void> => {
    const editor = activeEditor(app);
    if (!editor) {
      return;
    }
    // With "Review Changes in the Editor" switched on, whole-file formatting is shown for approval.
    if (!range && app.config.read(editor.document.uri).inlineReview) {
      await review.start(editor);
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
    if (editor) {
      await live.open(editor.document);
    }
  };

  /** Applies the formatting shown in a preview diff to the file it belongs to. */
  const applyPreview = async (): Promise<void> => {
    const active = vscode.window.activeTextEditor?.document;
    const document = active ? (live.sourceOf(active.uri) ?? (active.uri.scheme === PREVIEW_SCHEME ? undefined : active)) : app.lastEditor?.document;
    if (!document) {
      vscode.window.showInformationMessage('CodeNeat: The file this preview belongs to is no longer open.');
      return;
    }
    if (await live.apply(document)) {
      vscode.window.setStatusBarMessage('$(check) CodeNeat: formatting applied. Use Undo to revert.', 4000);
    } else {
      vscode.window.setStatusBarMessage('$(check) CodeNeat: nothing to change.', 3000);
    }
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
    vscode.commands.registerCommand('codeneat.applyPreview', applyPreview),
    vscode.commands.registerCommand('codeneat.showMenu', async () => {
      const editor = vscode.window.activeTextEditor ?? app.lastEditor;
      const language = editor ? app.languageOf(editor.document) : undefined;
      type Item = vscode.QuickPickItem & { command?: string };
      const items: Item[] = [];
      if (language) {
        items.push(
          { label: '$(sparkle) Format Document', description: language.label, command: 'codeneat.formatDocument' },
          { label: '$(diff) Format Document with Review', description: 'see the changes, then Enter to keep or Escape to undo', command: 'codeneat.formatWithReview' },
          { label: '$(open-preview) Preview Formatting (Live)', description: 'side-by-side, nothing is changed', command: 'codeneat.previewFormatting' },
          { label: '$(checklist) Check Formatting', command: 'codeneat.checkFormatting' },
          { label: '', kind: vscode.QuickPickItemKind.Separator },
          { label: '$(tools) Select Formatter', description: `for ${language.label}`, command: 'codeneat.selectFormatter' },
        );
      }
      items.push(
        { label: '$(symbol-color) Select Profile', command: 'codeneat.selectProfile' },
        { label: '$(folder) Format Workspace…', command: 'codeneat.formatWorkspace' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        { label: '$(settings-gear) Open CodeNeat Settings', command: 'codeneat.openSettings' },
        { label: '$(book) User Guide', command: 'codeneat.openUserGuide' },
      );
      const picked = await vscode.window.showQuickPick(items, { title: 'CodeNeat', placeHolder: language ? `What do you want to do with this ${language.label} file?` : 'Open a supported file to format it' });
      if (picked?.command) {
        await vscode.commands.executeCommand(picked.command);
      }
    }),
    vscode.commands.registerCommand('codeneat.openUserGuide', () =>
      vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.joinPath(app.context.extensionUri, 'docs', 'usage.md')),
    ),
    vscode.commands.registerCommand('codeneat.formatWithReview', async () => {
      const editor = activeEditor(app);
      return editor ? review.start(editor) : false;
    }),
    vscode.commands.registerCommand('codeneat.keepInlineReview', (uri?: unknown) => review.keep(uri instanceof vscode.Uri ? uri : undefined)),
    vscode.commands.registerCommand('codeneat.discardInlineReview', (uri?: unknown) => review.discard(uri instanceof vscode.Uri ? uri : undefined)),
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
