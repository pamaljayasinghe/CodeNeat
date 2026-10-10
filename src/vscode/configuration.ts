import * as vscode from 'vscode';
import type { FormattingSettings } from '../core/formattingService';
import { BUILTIN_PROFILES } from '../shared/profiles';
import type {
  CodeNeatSettings,
  CustomFormatterConfig,
  EditorSettings,
  LanguageSettings,
  ProfileDefinition,
  SettingsDraft,
  SettingsLayer,
  StyleOptions,
} from '../shared/types';
import {
  sanitizeLanguages,
  sanitizeProfiles,
  sanitizeStringList,
  sanitizeStyle,
  sanitizeToolPaths,
  validateCustomFormatters,
} from '../shared/validate';

export const EXTENSION_ID = 'pamaljayasinghe.codeneat';
const SECTION = 'codeneat';

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'object' && Object.keys(value as object).length === 0);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Sorts object keys recursively so that comparisons ignore key order. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  }
  return value;
}

function mergeLanguages(...sources: Record<string, LanguageSettings>[]): Record<string, LanguageSettings> {
  const result: Record<string, LanguageSettings> = {};
  for (const source of sources) {
    for (const [id, entry] of Object.entries(source)) {
      const previous = result[id] ?? {};
      result[id] = { ...previous, ...entry, style: { ...(previous.style ?? {}), ...(entry.style ?? {}) } };
      if (Object.keys(result[id].style ?? {}).length === 0) {
        delete result[id].style;
      }
    }
  }
  return result;
}

/** Reads and writes CodeNeat's settings through VS Code's configuration API. */
export class ConfigurationManager {
  private config(scope?: vscode.Uri): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(SECTION, scope ?? null);
  }

  get hasWorkspace(): boolean {
    return (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  }

  private layers(scope?: vscode.Uri): { user: SettingsLayer; workspace: SettingsLayer } {
    const config = this.config(scope);
    const style = config.inspect<StyleOptions>('style');
    const languages = config.inspect<Record<string, LanguageSettings>>('languages');
    const profile = config.inspect<string>('defaultProfile');
    const user: SettingsLayer = {
      style: sanitizeStyle(style?.globalValue),
      languages: sanitizeLanguages(languages?.globalValue),
    };
    if (typeof profile?.globalValue === 'string') {
      user.defaultProfile = profile.globalValue;
    }
    const workspace: SettingsLayer = {
      style: { ...sanitizeStyle(style?.workspaceValue), ...sanitizeStyle(style?.workspaceFolderValue) },
      languages: mergeLanguages(sanitizeLanguages(languages?.workspaceValue), sanitizeLanguages(languages?.workspaceFolderValue)),
    };
    const workspaceProfile = profile?.workspaceFolderValue ?? profile?.workspaceValue;
    if (typeof workspaceProfile === 'string') {
      workspace.defaultProfile = workspaceProfile;
    }
    return { user, workspace };
  }

  profiles(): Record<string, ProfileDefinition> {
    const inspected = this.config().inspect<Record<string, unknown>>('profiles');
    const merged = { ...sanitizeProfiles(inspected?.globalValue), ...sanitizeProfiles(inspected?.workspaceValue) };
    for (const builtin of BUILTIN_PROFILES) {
      delete merged[builtin.id];
    }
    return merged;
  }

  read(scope?: vscode.Uri): CodeNeatSettings {
    const config = this.config(scope);
    const { user, workspace } = this.layers(scope);
    return {
      user,
      workspace,
      profiles: this.profiles(),
      respectProjectConfig: config.get<boolean>('respectProjectConfig', true),
      codeneatFormatOnType: config.get<boolean>('formatOnType', true),
      previewOnSave: config.get<boolean>('previewOnSave', false),
      inlineReview: config.get<boolean>('inlineReview', false),
      timeoutMs: clamp(config.get<number>('timeoutMs', 10000), 500, 120000),
      maxFileSizeKB: clamp(config.get<number>('maxFileSizeKB', 2048), 16, 102400),
      workspaceExclude: sanitizeStringList(config.get('workspace.exclude')),
      useGitignore: config.get<boolean>('workspace.useGitignore', true),
      toolPaths: sanitizeToolPaths(config.get('toolPaths')),
      showStatusBar: config.get<boolean>('showStatusBar', true),
      enabled: config.get<boolean>('enabled', true),
      showEditorButton: config.get<boolean>('showEditorButton', true),
      showContextMenu: config.get<boolean>('showContextMenu', true),
    };
  }

  formattingSettings(scope?: vscode.Uri): FormattingSettings {
    const settings = this.read(scope);
    return {
      user: settings.user,
      workspace: settings.workspace,
      profiles: settings.profiles,
      respectProjectConfig: settings.respectProjectConfig,
      timeoutMs: settings.timeoutMs,
      maxFileSizeKB: settings.maxFileSizeKB,
    };
  }

  customFormatters(reservedIds: string[]): { formatters: CustomFormatterConfig[]; problems: string[] } {
    return validateCustomFormatters(this.config().get('customFormatters'), reservedIds);
  }

  readEditor(): EditorSettings {
    const editor = vscode.workspace.getConfiguration('editor', null);
    const files = vscode.workspace.getConfiguration('files', null);
    const mode = editor.get<string>('formatOnSaveMode', 'file');
    return {
      formatOnSave: editor.get<boolean>('formatOnSave', false),
      formatOnSaveMode: mode === 'modifications' || mode === 'modificationsIfAvailable' ? mode : 'file',
      formatOnPaste: editor.get<boolean>('formatOnPaste', false),
      formatOnType: editor.get<boolean>('formatOnType', false),
      insertFinalNewline: files.get<boolean>('insertFinalNewline', false),
      trimTrailingWhitespace: files.get<boolean>('trimTrailingWhitespace', false),
      trimFinalNewlines: files.get<boolean>('trimFinalNewlines', false),
    };
  }

  /** Reports which extension is the default formatter, globally and per CodeNeat language. */
  defaultFormatters(languages: { id: string; vscodeIds: string[] }[]): { global: string | null; byLanguage: Record<string, string | null> } {
    const global = vscode.workspace.getConfiguration('editor', null).get<string | null>('defaultFormatter') ?? null;
    const byLanguage: Record<string, string | null> = {};
    for (const language of languages) {
      const languageId = language.vscodeIds[0];
      byLanguage[language.id] = languageId
        ? (vscode.workspace.getConfiguration('editor', { languageId }).get<string | null>('defaultFormatter') ?? null)
        : global;
    }
    return { global, byLanguage };
  }

  /**
   * Writes a VS Code setting, choosing the scope that is actually in effect: when the workspace
   * already overrides the setting, the workspace value is updated, otherwise the user value.
   */
  private async writeEffective(section: string, key: string, value: unknown): Promise<void> {
    const config = vscode.workspace.getConfiguration(section, null);
    if (config.get(key) === value) {
      return;
    }
    const inspected = config.inspect(key);
    const target =
      inspected?.workspaceValue !== undefined && this.hasWorkspace
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update(key, value, target);
  }

  private async writeIfChanged(key: string, value: unknown, target: vscode.ConfigurationTarget): Promise<void> {
    const config = this.config();
    const inspected = config.inspect(key);
    const current = target === vscode.ConfigurationTarget.Global ? inspected?.globalValue : inspected?.workspaceValue;
    const next = isEmpty(value) && typeof value !== 'boolean' && typeof value !== 'number' ? undefined : value;
    if (sameJson(current, next)) {
      return;
    }
    await config.update(key, next, target);
  }

  /** Writes a setting only when it differs from the effective value, keeping settings.json tidy. */
  private async writeScalar(key: string, value: unknown): Promise<void> {
    const config = this.config();
    if (sameJson(config.get(key), value)) {
      return;
    }
    const inspected = config.inspect(key);
    const target =
      inspected?.workspaceValue !== undefined && this.hasWorkspace
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
    await config.update(key, sameJson(inspected?.defaultValue, value) ? undefined : value, target);
  }

  /** Persists everything the dashboard edited. Only settings that changed are written. */
  async applyDraft(draft: SettingsDraft): Promise<void> {
    const Global = vscode.ConfigurationTarget.Global;
    const Workspace = vscode.ConfigurationTarget.Workspace;

    await this.writeIfChanged('style', draft.user.style, Global);
    await this.writeIfChanged('languages', draft.user.languages, Global);
    await this.writeIfChanged('defaultProfile', draft.user.defaultProfile, Global);

    if (this.hasWorkspace) {
      await this.writeIfChanged('style', draft.workspace.style, Workspace);
      // `codeneat.languages` is a restricted setting: VS Code ignores it in untrusted workspaces.
      await this.writeIfChanged('languages', draft.workspace.languages, Workspace);
      await this.writeIfChanged('defaultProfile', draft.workspace.defaultProfile, Workspace);
    }

    const workspaceProfiles = sanitizeProfiles(this.config().inspect('profiles')?.workspaceValue);
    const userProfiles: Record<string, Omit<ProfileDefinition, 'id' | 'builtin'>> = {};
    for (const [id, profile] of Object.entries(draft.profiles)) {
      if (workspaceProfiles[id] || BUILTIN_PROFILES.some((builtin) => builtin.id === id)) {
        continue;
      }
      userProfiles[id] = {
        name: profile.name,
        ...(profile.description ? { description: profile.description } : {}),
        style: profile.style,
        ...(profile.languages ? { languages: profile.languages } : {}),
      };
    }
    await this.writeIfChanged('profiles', userProfiles, Global);

    await this.writeScalar('respectProjectConfig', draft.respectProjectConfig);
    await this.writeScalar('formatOnType', draft.codeneatFormatOnType);
    await this.writeScalar('previewOnSave', draft.previewOnSave);
    await this.writeScalar('inlineReview', draft.inlineReview);
    await this.writeScalar('timeoutMs', draft.timeoutMs);
    await this.writeScalar('maxFileSizeKB', draft.maxFileSizeKB);
    await this.writeScalar('workspace.exclude', draft.workspaceExclude);
    await this.writeScalar('workspace.useGitignore', draft.useGitignore);
    await this.writeScalar('showStatusBar', draft.showStatusBar);
    await this.writeScalar('enabled', draft.enabled);
    await this.writeScalar('showEditorButton', draft.showEditorButton);
    await this.writeScalar('showContextMenu', draft.showContextMenu);
    if (vscode.workspace.isTrusted) {
      await this.writeScalar('toolPaths', draft.toolPaths);
    }

    const editor = draft.editor;
    await this.writeEffective('editor', 'formatOnSave', editor.formatOnSave);
    await this.writeEffective('editor', 'formatOnSaveMode', editor.formatOnSaveMode);
    await this.writeEffective('editor', 'formatOnPaste', editor.formatOnPaste);
    await this.writeEffective('editor', 'formatOnType', editor.formatOnType);
    await this.writeEffective('files', 'insertFinalNewline', editor.insertFinalNewline);
    await this.writeEffective('files', 'trimTrailingWhitespace', editor.trimTrailingWhitespace);
    await this.writeEffective('files', 'trimFinalNewlines', editor.trimFinalNewlines);
  }

  /** Updates one language entry in the user's settings. */
  async updateUserLanguage(languageId: string, change: (entry: LanguageSettings) => LanguageSettings): Promise<void> {
    const config = this.config();
    const current = sanitizeLanguages(config.inspect('languages')?.globalValue);
    const next = { ...current };
    const entry = change({ ...(current[languageId] ?? {}) });
    if (isEmpty(entry) || Object.values(entry).every((value) => value === undefined || isEmpty(value))) {
      delete next[languageId];
    } else {
      next[languageId] = entry;
    }
    await config.update('languages', isEmpty(next) ? undefined : next, vscode.ConfigurationTarget.Global);
  }

  async setDefaultProfile(profileId: string, target: vscode.ConfigurationTarget): Promise<void> {
    await this.config().update('defaultProfile', profileId, target);
  }

  /** Replaces the user's CodeNeat style, languages and profiles (used by Import Settings). */
  async importUserSettings(data: {
    style: StyleOptions;
    languages: Record<string, LanguageSettings>;
    defaultProfile?: string;
    profiles: Record<string, ProfileDefinition>;
  }): Promise<void> {
    const Global = vscode.ConfigurationTarget.Global;
    const config = this.config();
    await config.update('style', isEmpty(data.style) ? undefined : data.style, Global);
    await config.update('languages', isEmpty(data.languages) ? undefined : data.languages, Global);
    await config.update('defaultProfile', data.defaultProfile, Global);
    const existing = sanitizeProfiles(config.inspect('profiles')?.globalValue);
    const merged: Record<string, unknown> = {};
    for (const [id, profile] of Object.entries({ ...existing, ...data.profiles })) {
      merged[id] = { name: profile.name, description: profile.description, style: profile.style, languages: profile.languages };
    }
    await config.update('profiles', isEmpty(merged) ? undefined : merged, Global);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
