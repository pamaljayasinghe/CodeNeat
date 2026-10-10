import { getOption } from './catalog';
import type {
  CustomFormatterConfig,
  EditorSettings,
  LanguageSettings,
  OptionValue,
  ProfileDefinition,
  SettingsDraft,
  SettingsLayer,
  StyleOptions,
  WebviewToHostMessage,
} from './types';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+#-]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeKey(key: string): boolean {
  return ID_PATTERN.test(key) && !FORBIDDEN_KEYS.has(key);
}

/** Validates one option value against the catalog. Returns undefined when invalid. */
export function sanitizeOptionValue(id: string, value: unknown): OptionValue | undefined {
  const definition = getOption(id);
  if (!definition) {
    return undefined;
  }
  switch (definition.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
      }
      return Math.min(definition.max, Math.max(definition.min, Math.round(value)));
    case 'enum':
      return typeof value === 'string' && definition.choices.some((choice) => choice.value === value) ? value : undefined;
  }
}

/** Keeps only known options with valid values. Never throws. */
export function sanitizeStyle(input: unknown): StyleOptions {
  const result: StyleOptions = {};
  if (!isRecord(input)) {
    return result;
  }
  for (const [id, value] of Object.entries(input)) {
    const clean = sanitizeOptionValue(id, value);
    if (clean !== undefined) {
      result[id] = clean;
    }
  }
  return result;
}

export function sanitizeLanguages(input: unknown): Record<string, LanguageSettings> {
  const result: Record<string, LanguageSettings> = {};
  if (!isRecord(input)) {
    return result;
  }
  for (const [languageId, raw] of Object.entries(input)) {
    if (!isSafeKey(languageId) || !isRecord(raw)) {
      continue;
    }
    const entry: LanguageSettings = {};
    if (typeof raw.formatter === 'string' && isSafeKey(raw.formatter)) {
      entry.formatter = raw.formatter;
    }
    if (typeof raw.profile === 'string' && isSafeKey(raw.profile)) {
      entry.profile = raw.profile;
    }
    const style = sanitizeStyle(raw.style);
    if (Object.keys(style).length > 0) {
      entry.style = style;
    }
    if (Object.keys(entry).length > 0) {
      result[languageId] = entry;
    }
  }
  return result;
}

export function sanitizeLayer(input: unknown): SettingsLayer {
  const raw = isRecord(input) ? input : {};
  const layer: SettingsLayer = {
    style: sanitizeStyle(raw.style),
    languages: sanitizeLanguages(raw.languages),
  };
  if (typeof raw.defaultProfile === 'string' && isSafeKey(raw.defaultProfile)) {
    layer.defaultProfile = raw.defaultProfile;
  }
  return layer;
}

export function sanitizeProfile(id: string, input: unknown): ProfileDefinition | undefined {
  if (!isSafeKey(id) || !isRecord(input)) {
    return undefined;
  }
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : '';
  if (!name) {
    return undefined;
  }
  const profile: ProfileDefinition = { id, name, style: sanitizeStyle(input.style) };
  if (typeof input.description === 'string' && input.description.trim()) {
    profile.description = input.description.trim().slice(0, 400);
  }
  if (isRecord(input.languages)) {
    const languages: Record<string, StyleOptions> = {};
    for (const [languageId, style] of Object.entries(input.languages)) {
      const clean = sanitizeStyle(style);
      if (isSafeKey(languageId) && Object.keys(clean).length > 0) {
        languages[languageId] = clean;
      }
    }
    if (Object.keys(languages).length > 0) {
      profile.languages = languages;
    }
  }
  return profile;
}

export function sanitizeProfiles(input: unknown): Record<string, ProfileDefinition> {
  const result: Record<string, ProfileDefinition> = {};
  if (!isRecord(input)) {
    return result;
  }
  for (const [id, raw] of Object.entries(input)) {
    const profile = sanitizeProfile(id, raw);
    if (profile) {
      result[id] = profile;
    }
  }
  return result;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  formatOnSave: false,
  formatOnSaveMode: 'file',
  formatOnPaste: false,
  formatOnType: false,
  insertFinalNewline: false,
  trimTrailingWhitespace: false,
  trimFinalNewlines: false,
};

export function sanitizeEditorSettings(input: unknown): EditorSettings {
  const raw = isRecord(input) ? input : {};
  const mode = raw.formatOnSaveMode;
  return {
    formatOnSave: bool(raw.formatOnSave, false),
    formatOnSaveMode: mode === 'modifications' || mode === 'modificationsIfAvailable' ? mode : 'file',
    formatOnPaste: bool(raw.formatOnPaste, false),
    formatOnType: bool(raw.formatOnType, false),
    insertFinalNewline: bool(raw.insertFinalNewline, false),
    trimTrailingWhitespace: bool(raw.trimTrailingWhitespace, false),
    trimFinalNewlines: bool(raw.trimFinalNewlines, false),
  };
}

export function sanitizeStringList(input: unknown, maxItems = 200, maxLength = 400): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxLength && !item.includes('\0'))
    .slice(0, maxItems);
}

export function sanitizeToolPaths(input: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(input)) {
    return result;
  }
  for (const [id, value] of Object.entries(input)) {
    if (isSafeKey(id) && typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed && trimmed.length <= 1024 && !trimmed.includes('\0') && !/[\r\n]/.test(trimmed)) {
        result[id] = trimmed;
      }
    }
  }
  return result;
}

export function sanitizeDraft(input: unknown): SettingsDraft {
  const raw = isRecord(input) ? input : {};
  return {
    user: sanitizeLayer(raw.user),
    workspace: sanitizeLayer(raw.workspace),
    profiles: sanitizeProfiles(raw.profiles),
    editor: sanitizeEditorSettings(raw.editor),
    respectProjectConfig: bool(raw.respectProjectConfig, true),
    codeneatFormatOnType: bool(raw.codeneatFormatOnType, true),
    previewOnSave: bool(raw.previewOnSave, false),
    inlineReview: bool(raw.inlineReview, false),
    timeoutMs: clampNumber(raw.timeoutMs, 500, 120000, 10000),
    maxFileSizeKB: clampNumber(raw.maxFileSizeKB, 16, 102400, 2048),
    workspaceExclude: sanitizeStringList(raw.workspaceExclude),
    useGitignore: bool(raw.useGitignore, true),
    toolPaths: sanitizeToolPaths(raw.toolPaths),
    showStatusBar: bool(raw.showStatusBar, true),
    enabled: bool(raw.enabled, true),
    showEditorButton: bool(raw.showEditorButton, true),
    editorButtonAction: raw.editorButtonAction === 'format' ? 'format' : 'review',
    showContextMenu: bool(raw.showContextMenu, true),
  };
}

const CUSTOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;
const ALLOWED_PLACEHOLDERS = new Set(['file', 'lineLength', 'indentSize', 'indentStyle']);

export interface CustomFormatterValidation {
  formatters: CustomFormatterConfig[];
  problems: string[];
}

/**
 * Validates `codeneat.customFormatters`. Commands are executable names or absolute paths only;
 * shell syntax is rejected because commands are never run through a shell.
 */
export function validateCustomFormatters(input: unknown, reservedIds: Iterable<string> = []): CustomFormatterValidation {
  const formatters: CustomFormatterConfig[] = [];
  const problems: string[] = [];
  const seen = new Set(reservedIds);
  if (!Array.isArray(input)) {
    return { formatters, problems };
  }
  input.forEach((raw, index) => {
    const where = `customFormatters[${index}]`;
    if (!isRecord(raw)) {
      problems.push(`${where}: must be an object.`);
      return;
    }
    const { id, name, command } = raw;
    if (typeof id !== 'string' || !CUSTOM_ID_PATTERN.test(id)) {
      problems.push(`${where}: "id" must be 2-41 lowercase letters, digits or dashes.`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${where}: the id "${id}" is already used by another formatter.`);
      return;
    }
    if (typeof name !== 'string' || !name.trim()) {
      problems.push(`${where}: "name" is required.`);
      return;
    }
    if (typeof command !== 'string' || !isSafeCommand(command)) {
      problems.push(
        `${where}: "command" must be an executable name or absolute path without shell characters, quotes or line breaks.`,
      );
      return;
    }
    const languages = sanitizeStringList(raw.languages, 50, 64).filter((language) => isSafeKey(language));
    if (languages.length === 0) {
      problems.push(`${where}: "languages" must list at least one language id.`);
      return;
    }
    const args = Array.isArray(raw.args) ? raw.args : [];
    if (args.length > 64 || args.some((arg) => typeof arg !== 'string' || arg.length > 2000 || arg.includes('\0'))) {
      problems.push(`${where}: "args" must be at most 64 strings.`);
      return;
    }
    const badPlaceholder = (args as string[])
      .flatMap((arg) => [...arg.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]))
      .find((placeholder) => !ALLOWED_PLACEHOLDERS.has(placeholder));
    if (badPlaceholder !== undefined) {
      problems.push(`${where}: unknown placeholder "\${${badPlaceholder}}".`);
      return;
    }
    const extensions = sanitizeStringList(raw.extensions, 50, 32).filter((extension) => /^\.[A-Za-z0-9._+-]+$/.test(extension));
    seen.add(id);
    formatters.push({ id, name: name.trim().slice(0, 80), languages, extensions, command: command.trim(), args: args as string[] });
  });
  return { formatters, problems };
}

/** A command is safe when it is a bare executable name or a path, with no shell metacharacters. */
export function isSafeCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || trimmed.length > 1024) {
    return false;
  }
  // Reject control characters and anything that only has meaning to a shell.
  for (const char of trimmed) {
    if (char.charCodeAt(0) < 32) {
      return false;
    }
  }
  if (/[|&;<>$`"'*?]/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith('-')) {
    return false;
  }
  return true;
}

const MESSAGE_TYPES = new Set([
  'ready',
  'preview',
  'cancelPreview',
  'apply',
  'applyToDocument',
  'command',
  'copy',
  'refreshFormatters',
  'exportProfile',
  'importProfile',
  'dirty',
]);

/** Commands the dashboard is allowed to trigger. */
export const WEBVIEW_COMMANDS = new Set([
  'codeneat.formatDocument',
  'codeneat.formatSelection',
  'codeneat.formatWorkspace',
  'codeneat.previewFormatting',
  'codeneat.checkFormatting',
  'codeneat.selectFormatter',
  'codeneat.selectProfile',
  'codeneat.openDiagnostics',
  'codeneat.importSettings',
  'codeneat.exportSettings',
  'codeneat.setAsDefaultFormatter',
  'codeneat.refreshFormatters',
  'codeneat.installFormatter',
  'codeneat.formatWithReview',
  'codeneat.openUserGuide',
  'codeneat.openSettings',
  'codeneat.openSettingsJson',
  'codeneat.openWalkthrough',
  'codeneat.manageWorkspaceTrust',
  'codeneat.openExternal',
  'codeneat.showLog',
]);

const MAX_PREVIEW_CODE = 400_000;

/**
 * Validates a message coming from the webview. Returns a cleaned message, or undefined when the
 * message is malformed and must be ignored.
 */
export function parseWebviewMessage(input: unknown): WebviewToHostMessage | undefined {
  if (!isRecord(input) || typeof input.type !== 'string' || !MESSAGE_TYPES.has(input.type)) {
    return undefined;
  }
  switch (input.type) {
    case 'ready':
    case 'cancelPreview':
    case 'refreshFormatters':
    case 'importProfile':
      return { type: input.type };
    case 'dirty':
      return { type: 'dirty', dirty: input.dirty === true };
    case 'copy':
      return typeof input.text === 'string' && input.text.length <= 2_000_000 ? { type: 'copy', text: input.text } : undefined;
    case 'apply':
    case 'applyToDocument':
      return isRecord(input.draft) ? { type: input.type, draft: sanitizeDraft(input.draft) } : undefined;
    case 'exportProfile': {
      const raw = input.profile;
      if (!isRecord(raw) || typeof raw.id !== 'string') {
        return undefined;
      }
      const profile = sanitizeProfile(raw.id, raw);
      return profile ? { type: 'exportProfile', profile } : undefined;
    }
    case 'command': {
      if (typeof input.command !== 'string' || !WEBVIEW_COMMANDS.has(input.command)) {
        return undefined;
      }
      const args: Record<string, string> = {};
      if (isRecord(input.args)) {
        for (const [key, value] of Object.entries(input.args)) {
          if (isSafeKey(key) && typeof value === 'string' && value.length <= 2048) {
            args[key] = value;
          }
        }
      }
      return { type: 'command', command: input.command, args };
    }
    case 'preview': {
      const request = input.request;
      if (!isRecord(request)) {
        return undefined;
      }
      const { requestId, languageId, formatterId, source, code } = request;
      if (typeof requestId !== 'number' || !Number.isSafeInteger(requestId) || requestId < 0) {
        return undefined;
      }
      if (typeof languageId !== 'string' || !isSafeKey(languageId)) {
        return undefined;
      }
      if (source !== 'sample' && source !== 'editor' && source !== 'custom') {
        return undefined;
      }
      if (formatterId !== undefined && (typeof formatterId !== 'string' || !isSafeKey(formatterId))) {
        return undefined;
      }
      if (code !== undefined && (typeof code !== 'string' || code.length > MAX_PREVIEW_CODE)) {
        return undefined;
      }
      return {
        type: 'preview',
        request: {
          requestId,
          languageId,
          formatterId: formatterId as string | undefined,
          source,
          code: code as string | undefined,
          draft: sanitizeDraft(request.draft),
        },
      };
    }
    default:
      return undefined;
  }
}

export const EXPORT_FORMAT = 'codeneat-settings';
export const PROFILE_EXPORT_FORMAT = 'codeneat-profile';
export const EXPORT_VERSION = 1;

export interface SettingsExport {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedBy?: string;
  style: StyleOptions;
  languages: Record<string, LanguageSettings>;
  defaultProfile?: string;
  profiles: Record<string, ProfileDefinition>;
}

/** Parses an exported settings file. Throws an Error with a readable message when invalid. */
export function parseSettingsExport(text: string): SettingsExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!isRecord(data) || data.format !== EXPORT_FORMAT) {
    throw new Error('This is not a CodeNeat settings file.');
  }
  if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) {
    throw new Error('This settings file was made by a newer version of CodeNeat.');
  }
  const layer = sanitizeLayer(data);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    style: layer.style,
    languages: layer.languages,
    defaultProfile: layer.defaultProfile,
    profiles: sanitizeProfiles(data.profiles),
  };
}

/** Parses an exported profile file. Throws an Error with a readable message when invalid. */
export function parseProfileExport(text: string): ProfileDefinition {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (!isRecord(data) || data.format !== PROFILE_EXPORT_FORMAT || !isRecord(data.profile)) {
    throw new Error('This is not a CodeNeat profile file.');
  }
  const rawId = typeof data.profile.id === 'string' && isSafeKey(data.profile.id) ? data.profile.id : 'imported';
  const profile = sanitizeProfile(rawId, data.profile);
  if (!profile) {
    throw new Error('The profile in this file has no name.');
  }
  return profile;
}
