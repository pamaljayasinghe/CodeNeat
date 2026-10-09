import { allProfiles } from '../../src/shared/profiles';
import { chooseFormatter, type FormatterChoice, resolveStyle, type ResolvedStyle } from '../../src/shared/resolve';
import type {
  DashboardState,
  FormatterDescriptor,
  LanguageDefinition,
  OptionValue,
  ProfileDefinition,
  SettingsDraft,
  SettingsLayer,
} from '../../src/shared/types';

export type Scope = 'user' | 'workspace';
export type Target = 'all' | 'language';

export type PageId =
  | 'overview'
  | 'general'
  | 'wrapping'
  | 'indentation'
  | 'spacing'
  | 'braces'
  | 'quotes'
  | 'imports'
  | 'language'
  | 'auto'
  | 'profiles'
  | 'formatters'
  | 'workspace'
  | 'advanced'
  | 'help';

export const PAGES: { id: PageId; title: string; group: string }[] = [
  { id: 'overview', title: 'Overview', group: 'Start' },
  { id: 'general', title: 'General Formatting', group: 'Style' },
  { id: 'wrapping', title: 'Line Length and Wrapping', group: 'Style' },
  { id: 'indentation', title: 'Indentation', group: 'Style' },
  { id: 'spacing', title: 'Spaces and Blank Lines', group: 'Style' },
  { id: 'braces', title: 'Braces and Brackets', group: 'Style' },
  { id: 'quotes', title: 'Quotes and Semicolons', group: 'Style' },
  { id: 'imports', title: 'Imports and Comments', group: 'Style' },
  { id: 'language', title: 'Language-Specific Options', group: 'Style' },
  { id: 'auto', title: 'Auto Formatting', group: 'Behaviour' },
  { id: 'profiles', title: 'Formatting Profiles', group: 'Behaviour' },
  { id: 'formatters', title: 'Formatter Management', group: 'Behaviour' },
  { id: 'workspace', title: 'Workspace Settings', group: 'Behaviour' },
  { id: 'advanced', title: 'Advanced', group: 'More' },
  { id: 'help', title: 'Help and Diagnostics', group: 'More' },
];

export const STYLE_PAGES: PageId[] = ['general', 'wrapping', 'indentation', 'spacing', 'braces', 'quotes', 'imports', 'language'];

export function isPageId(value: string): value is PageId {
  return PAGES.some((page) => page.id === value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function draftFromState(state: DashboardState): SettingsDraft {
  const settings = state.settings;
  return clone({
    user: settings.user,
    workspace: settings.workspace,
    profiles: settings.profiles,
    editor: state.editor,
    respectProjectConfig: settings.respectProjectConfig,
    codeneatFormatOnType: settings.codeneatFormatOnType,
    timeoutMs: settings.timeoutMs,
    maxFileSizeKB: settings.maxFileSizeKB,
    workspaceExclude: settings.workspaceExclude,
    useGitignore: settings.useGitignore,
    toolPaths: settings.toolPaths,
    showStatusBar: settings.showStatusBar,
  });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

export function sameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

/** Removes empty language entries so that "set then reset" leaves no trace in the draft. */
function pruneLayer(layer: SettingsLayer): SettingsLayer {
  const languages: SettingsLayer['languages'] = {};
  for (const [id, entry] of Object.entries(layer.languages)) {
    const next = { ...entry };
    if (next.style && Object.keys(next.style).length === 0) {
      delete next.style;
    }
    if (next.formatter === undefined) {
      delete next.formatter;
    }
    if (next.profile === undefined) {
      delete next.profile;
    }
    if (Object.keys(next).length > 0) {
      languages[id] = next;
    }
  }
  const result: SettingsLayer = { style: { ...layer.style }, languages };
  if (layer.defaultProfile !== undefined) {
    result.defaultProfile = layer.defaultProfile;
  }
  return result;
}

export function updateLayer(draft: SettingsDraft, scope: Scope, change: (layer: SettingsLayer) => void): SettingsDraft {
  const layer = clone(draft[scope]);
  change(layer);
  return { ...draft, [scope]: pruneLayer(layer) };
}

/** The value stored in the slot that is currently being edited (scope × all/language). */
export function slotValue(draft: SettingsDraft, scope: Scope, target: Target, languageId: string, optionId: string): OptionValue | undefined {
  const layer = draft[scope];
  return target === 'all' ? layer.style[optionId] : layer.languages[languageId]?.style?.[optionId];
}

export function setSlotValue(
  draft: SettingsDraft,
  scope: Scope,
  target: Target,
  languageId: string,
  optionId: string,
  value: OptionValue | undefined,
): SettingsDraft {
  return updateLayer(draft, scope, (layer) => {
    const style = target === 'all' ? layer.style : ((layer.languages[languageId] ??= {}).style ??= {});
    if (value === undefined) {
      delete style[optionId];
    } else {
      style[optionId] = value;
    }
  });
}

export function setLanguageFormatter(draft: SettingsDraft, scope: Scope, languageId: string, formatterId: string | undefined): SettingsDraft {
  return updateLayer(draft, scope, (layer) => {
    const entry = (layer.languages[languageId] ??= {});
    entry.formatter = formatterId;
  });
}

export function setLanguageProfile(draft: SettingsDraft, scope: Scope, languageId: string, profileId: string | undefined): SettingsDraft {
  return updateLayer(draft, scope, (layer) => {
    const entry = (layer.languages[languageId] ??= {});
    entry.profile = profileId;
  });
}

export function setDefaultProfile(draft: SettingsDraft, scope: Scope, profileId: string | undefined): SettingsDraft {
  return updateLayer(draft, scope, (layer) => {
    layer.defaultProfile = profileId;
  });
}

export interface LanguageView {
  language: LanguageDefinition;
  choice: FormatterChoice;
  formatter: FormatterDescriptor | undefined;
  resolved: ResolvedStyle | undefined;
  available: boolean;
}

/** Everything the dashboard needs to know about one language under the current draft. */
export function viewLanguage(state: DashboardState, draft: SettingsDraft, languageId: string): LanguageView | undefined {
  const language = state.languages.find((candidate) => candidate.id === languageId);
  if (!language) {
    return undefined;
  }
  const choice = chooseFormatter(language, state.formatters, state.statuses, draft.user, draft.workspace);
  const formatter = choice.formatter;
  const projectApplies = state.activeEditor?.languageId === languageId && state.trusted;
  const resolved = formatter
    ? resolveStyle({
        languageId,
        formatter,
        user: draft.user,
        workspace: draft.workspace,
        profiles: draft.profiles,
        project: projectApplies ? state.project[formatter.id] : undefined,
        respectProjectConfig: draft.respectProjectConfig && state.trusted,
      })
    : undefined;
  return { language, choice, formatter, resolved, available: formatter ? !!state.statuses[formatter.id]?.available : false };
}

export function profilesOf(state: DashboardState, draft: SettingsDraft): ProfileDefinition[] {
  void state;
  return allProfiles(draft.profiles);
}

export function formatValue(value: OptionValue): string {
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off';
  }
  return String(value);
}
