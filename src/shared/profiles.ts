import type { ProfileDefinition } from './types';

export const DEFAULT_PROFILE_ID = 'standard';

const FOUR_SPACE_LANGUAGES = ['python', 'java', 'c', 'cpp', 'csharp', 'fsharp', 'kotlin', 'rust', 'php', 'swift', 'powershell'];

function fourSpaces(extra: Record<string, ProfileDefinition['style']> = {}): Record<string, ProfileDefinition['style']> {
  const result: Record<string, ProfileDefinition['style']> = {};
  for (const language of FOUR_SPACE_LANGUAGES) {
    result[language] = { indentSize: 4, ...(extra[language] ?? {}) };
  }
  return result;
}

/** Profiles that ship with CodeNeat. They are read-only; duplicate one to customise it. */
export const BUILTIN_PROFILES: ProfileDefinition[] = [
  {
    id: 'standard',
    name: 'Standard',
    builtin: true,
    description: 'Each formatter\'s own recommended style with a 120 character line length.',
    style: { lineLength: 120 },
  },
  {
    id: 'compact',
    name: 'Compact',
    builtin: true,
    description: 'Fits more code on screen: long lines, 2-space indentation, short blocks kept on one line.',
    style: {
      lineLength: 160,
      indentStyle: 'spaces',
      indentSize: 2,
      bracketSpacing: false,
      objectWrap: 'collapse',
      arrowParens: 'avoid',
      trailingCommas: 'none',
      maxBlankLines: 1,
      shortFunctionsOnOneLine: 'all',
      shortIfOnOneLine: true,
      singleAttributePerLine: false,
    },
    languages: { python: { indentSize: 4 } },
  },
  {
    id: 'readable',
    name: 'Readable',
    builtin: true,
    description: 'Roomy and easy to scan: shorter lines, 4-space indentation, one thing per line.',
    style: {
      lineLength: 100,
      indentStyle: 'spaces',
      indentSize: 4,
      bracketSpacing: true,
      objectWrap: 'preserve',
      arrowParens: 'always',
      trailingCommas: 'all',
      maxBlankLines: 2,
      shortFunctionsOnOneLine: 'empty',
      shortIfOnOneLine: false,
      singleAttributePerLine: true,
      separateDefinitions: 'always',
    },
  },
  {
    id: 'team',
    name: 'Team Style',
    builtin: true,
    description:
      'A predictable shared baseline: 100 characters, spaces, LF line endings, single quotes and trailing commas in JavaScript, sorted imports.',
    style: {
      lineLength: 100,
      indentStyle: 'spaces',
      indentSize: 2,
      lineEndings: 'lf',
      quoteStyle: 'single',
      semicolons: 'always',
      trailingCommas: 'all',
      sortImports: true,
      maxBlankLines: 1,
    },
    languages: fourSpaces({ python: { quoteStyle: 'double' }, rust: { quoteStyle: 'double' } }),
  },
];

export function allProfiles(custom: Record<string, ProfileDefinition>): ProfileDefinition[] {
  const builtinIds = new Set(BUILTIN_PROFILES.map((profile) => profile.id));
  const customProfiles = Object.entries(custom)
    .filter(([id]) => !builtinIds.has(id))
    .map(([id, profile]) => ({ ...profile, id, builtin: false }));
  return [...BUILTIN_PROFILES, ...customProfiles];
}

export function findProfile(id: string | undefined, custom: Record<string, ProfileDefinition>): ProfileDefinition | undefined {
  if (!id) {
    return undefined;
  }
  return allProfiles(custom).find((profile) => profile.id === id);
}

/** Creates a URL-safe, unused profile id from a display name. */
export function makeProfileId(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (const builtin of BUILTIN_PROFILES) {
    taken.add(builtin.id);
  }
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'profile';
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter++}`;
  }
  return candidate;
}
