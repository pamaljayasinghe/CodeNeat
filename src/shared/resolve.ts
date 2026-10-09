import { CATALOG, getOption } from './catalog';
import { DEFAULT_PROFILE_ID, findProfile } from './profiles';
import type {
  FormatterDescriptor,
  FormatterStatus,
  LanguageDefinition,
  OptionCapability,
  OptionDefinition,
  OptionValue,
  ProfileDefinition,
  ProjectOverrides,
  ResolvedOption,
  SettingsLayer,
  StyleOptions,
  ValueSource,
} from './types';

export interface ResolveInput {
  languageId: string;
  formatter: FormatterDescriptor;
  user: SettingsLayer;
  workspace: SettingsLayer;
  profiles: Record<string, ProfileDefinition>;
  project?: ProjectOverrides;
  respectProjectConfig: boolean;
}

export interface ResolvedStyle {
  profile: ProfileDefinition;
  options: Record<string, ResolvedOption>;
  /** Values for every option the formatter supports and that is not fixed. */
  values: StyleOptions;
  /** Ids of options whose value does not simply come from the formatter's own default. */
  explicit: string[];
  /** True when the formatter should rely purely on its own project configuration file. */
  projectConfigTakesOver: boolean;
  projectConfigFile?: string;
}

/**
 * Precedence, lowest to highest:
 *   formatter default → CodeNeat default → profile → profile (language) → user → workspace →
 *   user (language) → workspace (language) → .editorconfig → formatter config file → fixed by formatter
 */
export const PRECEDENCE: { source: ValueSource; label: string }[] = [
  { source: 'formatter-default', label: 'Formatter default' },
  { source: 'codeneat-default', label: 'CodeNeat default' },
  { source: 'profile', label: 'Profile' },
  { source: 'user', label: 'Your settings' },
  { source: 'workspace', label: 'Workspace settings' },
  { source: 'user-language', label: 'Your settings for this language' },
  { source: 'workspace-language', label: 'Workspace settings for this language' },
  { source: 'editorconfig', label: '.editorconfig' },
  { source: 'project-config', label: 'Formatter configuration file' },
  { source: 'fixed', label: 'Fixed by the formatter' },
];

export function sourceLabel(source: ValueSource): string {
  return PRECEDENCE.find((entry) => entry.source === source)?.label ?? source;
}

export function capabilityFor(
  formatter: FormatterDescriptor,
  optionId: string,
  languageId: string,
): OptionCapability | undefined {
  const capability = formatter.options[optionId];
  if (!capability) {
    return undefined;
  }
  if (capability.languages && !capability.languages.includes(languageId)) {
    return undefined;
  }
  return capability;
}

/** Returns the value if the formatter accepts it (clamping numbers), otherwise undefined. */
export function acceptValue(
  definition: OptionDefinition,
  capability: OptionCapability,
  value: OptionValue,
): OptionValue | undefined {
  if (definition.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }
  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }
    const min = Math.max(definition.min, capability.min ?? definition.min);
    const max = Math.min(definition.max, capability.max ?? definition.max);
    return Math.min(max, Math.max(min, Math.round(value)));
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const allowed = capability.values ?? definition.choices.map((choice) => choice.value);
  return allowed.includes(value) ? value : undefined;
}

export function activeProfile(
  languageId: string,
  user: SettingsLayer,
  workspace: SettingsLayer,
  profiles: Record<string, ProfileDefinition>,
): ProfileDefinition {
  const candidates = [
    workspace.languages[languageId]?.profile,
    user.languages[languageId]?.profile,
    workspace.defaultProfile,
    user.defaultProfile,
    DEFAULT_PROFILE_ID,
  ];
  for (const id of candidates) {
    const profile = findProfile(id, profiles);
    if (profile) {
      return profile;
    }
  }
  // DEFAULT_PROFILE_ID is a built-in, so this is unreachable; keep the type checker satisfied.
  return { id: DEFAULT_PROFILE_ID, name: 'Standard', style: {} };
}

function unsupportedReason(formatter: FormatterDescriptor, definition: OptionDefinition, languageId: string): string {
  const capability = formatter.options[definition.id];
  if (capability?.languages && !capability.languages.includes(languageId)) {
    return `${formatter.displayName} does not use this option for this language.`;
  }
  return `${formatter.displayName} does not offer this option.`;
}

export function resolveStyle(input: ResolveInput): ResolvedStyle {
  const { languageId, formatter, user, workspace, profiles, project, respectProjectConfig } = input;
  const profile = activeProfile(languageId, user, workspace, profiles);
  const useProject = respectProjectConfig && !!project;
  const takesOver = useProject && !!project?.formatterConfigTakesOver;
  const configFileName = project?.formatterConfigFile ? fileBaseName(project.formatterConfigFile) : undefined;

  const options: Record<string, ResolvedOption> = {};
  const values: StyleOptions = {};
  const explicit: string[] = [];

  for (const definition of CATALOG) {
    const id = definition.id;
    const fixed = formatter.fixed[id];
    if (fixed && (!fixed.languages || fixed.languages.includes(languageId))) {
      options[id] = {
        id,
        value: fixed.value,
        source: 'fixed',
        supported: false,
        unavailableReason: fixed.reason,
      };
      continue;
    }

    const capability = capabilityFor(formatter, id, languageId);
    if (!capability) {
      options[id] = {
        id,
        value: definition.fallback,
        source: 'formatter-default',
        supported: false,
        unavailableReason: unsupportedReason(formatter, definition, languageId),
      };
      continue;
    }

    const formatterDefault = capability.languageDefaults?.[languageId] ?? capability.default ?? definition.fallback;
    const current: { value: OptionValue; source: ValueSource; detail?: string } = {
      value: acceptValue(definition, capability, formatterDefault) ?? formatterDefault,
      source: 'formatter-default',
    };
    const rejected: string[] = [];

    const layer = (candidate: OptionValue | undefined, from: ValueSource, detail?: string): void => {
      if (candidate === undefined) {
        return;
      }
      const accepted = acceptValue(definition, capability, candidate);
      if (accepted === undefined) {
        rejected.push(`${sourceLabel(from)} asks for "${String(candidate)}", which ${formatter.displayName} does not support.`);
        return;
      }
      current.value = accepted;
      current.source = from;
      current.detail = detail;
    };

    layer(definition.codeneatDefault, 'codeneat-default');
    layer(profile.style[id], 'profile', profile.name);
    layer(profile.languages?.[languageId]?.[id], 'profile', profile.name);
    layer(user.style[id], 'user');
    layer(workspace.style[id], 'workspace');
    layer(user.languages[languageId]?.style?.[id], 'user-language');
    layer(workspace.languages[languageId]?.style?.[id], 'workspace-language');

    if (useProject && project) {
      layer(project.editorconfig[id], 'editorconfig', '.editorconfig');
      layer(project.formatterConfig[id], 'project-config', configFileName);
    }
    const locked = current.source === 'editorconfig' || current.source === 'project-config';

    const notes = [capability.note, ...rejected].filter((note): note is string => !!note);
    const resolved: ResolvedOption = {
      id,
      value: current.value,
      source: current.source,
      sourceDetail: current.detail,
      supported: true,
      support: capability.support,
      native: capability.native,
      note: notes.length ? notes.join(' ') : undefined,
      locked,
    };
    if (takesOver) {
      resolved.locked = true;
      resolved.source = 'project-config';
      resolved.sourceDetail = configFileName;
      resolved.unavailableReason = `Controlled by ${configFileName ?? 'the project configuration file'}. Turn off "Respect project configuration" to use CodeNeat preferences instead.`;
    } else if (locked) {
      resolved.unavailableReason = `Set by ${current.detail ?? sourceLabel(current.source)}. Turn off "Respect project configuration" to override it.`;
    }
    options[id] = resolved;
    values[id] = current.value;
    if (current.source !== 'formatter-default') {
      explicit.push(id);
    }
  }

  return {
    profile,
    options,
    values,
    explicit,
    projectConfigTakesOver: takesOver,
    projectConfigFile: project?.formatterConfigFile,
  };
}

function fileBaseName(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** The formatter explicitly chosen by the user for a language, if any. */
export function chosenFormatterId(languageId: string, user: SettingsLayer, workspace: SettingsLayer): string | undefined {
  return workspace.languages[languageId]?.formatter ?? user.languages[languageId]?.formatter;
}

export interface FormatterChoice {
  formatter?: FormatterDescriptor;
  /** True when the user explicitly selected this formatter. */
  explicit: boolean;
  /** All formatters that can handle the language, in order of preference. */
  candidates: FormatterDescriptor[];
}

/**
 * Picks the formatter for a language: the user's explicit choice if it exists, otherwise the first
 * installed candidate, otherwise the first candidate (so that we can explain what is missing).
 */
export function chooseFormatter(
  language: LanguageDefinition,
  formatters: FormatterDescriptor[],
  statuses: Record<string, FormatterStatus>,
  user: SettingsLayer,
  workspace: SettingsLayer,
): FormatterChoice {
  const preferred = language.formatters
    .map((id) => formatters.find((formatter) => formatter.id === id))
    .filter((formatter): formatter is FormatterDescriptor => !!formatter);
  const others = formatters.filter(
    (formatter) => formatter.languages.includes(language.id) && !preferred.includes(formatter),
  );
  const candidates = [...preferred, ...others];
  const chosen = chosenFormatterId(language.id, user, workspace);
  const explicit = candidates.find((formatter) => formatter.id === chosen);
  if (explicit) {
    return { formatter: explicit, explicit: true, candidates };
  }
  const installed = candidates.find((formatter) => statuses[formatter.id]?.available);
  return { formatter: installed ?? candidates[0], explicit: false, candidates };
}

/** Lists profile options the given formatter cannot apply for a language. */
export function unsupportedProfileOptions(
  profile: ProfileDefinition,
  formatter: FormatterDescriptor,
  languageId: string,
): { id: string; label: string; reason: string }[] {
  const merged: StyleOptions = { ...profile.style, ...(profile.languages?.[languageId] ?? {}) };
  const result: { id: string; label: string; reason: string }[] = [];
  for (const [id, value] of Object.entries(merged)) {
    const definition = getOption(id);
    if (!definition) {
      continue;
    }
    const fixed = formatter.fixed[id];
    if (fixed && (!fixed.languages || fixed.languages.includes(languageId))) {
      if (fixed.value !== value) {
        result.push({ id, label: definition.label, reason: fixed.reason });
      }
      continue;
    }
    const capability = capabilityFor(formatter, id, languageId);
    if (!capability) {
      result.push({ id, label: definition.label, reason: unsupportedReason(formatter, definition, languageId) });
    } else if (acceptValue(definition, capability, value) === undefined) {
      result.push({
        id,
        label: definition.label,
        reason: `${formatter.displayName} does not accept "${String(value)}" here.`,
      });
    }
  }
  return result;
}
