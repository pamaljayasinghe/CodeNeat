import { describe, expect, it } from 'vitest';
import { PRETTIER_DESCRIPTOR } from '../../src/adapters/prettier';
import { createBuiltinAdapters } from '../../src/core/registry';
import { getLanguage } from '../../src/shared/languages';
import { BUILTIN_PROFILES } from '../../src/shared/profiles';
import { activeProfile, chooseFormatter, resolveStyle, unsupportedProfileOptions } from '../../src/shared/resolve';
import type { FormatterDescriptor, FormatterStatus, ProfileDefinition, SettingsLayer } from '../../src/shared/types';

const descriptors = createBuiltinAdapters().map((adapter) => adapter.descriptor);
const find = (id: string): FormatterDescriptor => {
  const descriptor = descriptors.find((candidate) => candidate.id === id);
  if (!descriptor) {
    throw new Error(`missing descriptor ${id}`);
  }
  return descriptor;
};
const layer = (partial: Partial<SettingsLayer> = {}): SettingsLayer => ({ style: {}, languages: {}, ...partial });
const base = { user: layer(), workspace: layer(), profiles: {}, respectProjectConfig: true };

describe('style resolution precedence', () => {
  it('starts from the formatter default and applies the CodeNeat line length of 120', () => {
    const resolved = resolveStyle({ ...base, languageId: 'typescript', formatter: PRETTIER_DESCRIPTOR });
    // The Standard profile is active by default and carries the 120 character line length.
    expect(resolved.options.lineLength).toMatchObject({ value: 120, source: 'profile', sourceDetail: 'Standard', supported: true });
    // Without any profile value CodeNeat's own default still gives 120.
    const bare = resolveStyle({ ...base, languageId: 'typescript', formatter: PRETTIER_DESCRIPTOR, profiles: { empty: { id: 'empty', name: 'Empty', style: {} } }, user: layer({ defaultProfile: 'empty' }) });
    expect(bare.options.lineLength).toMatchObject({ value: 120, source: 'codeneat-default' });
    expect(resolved.options.indentSize).toMatchObject({ value: 2, source: 'formatter-default' });
    expect(resolved.options.semicolons).toMatchObject({ value: 'always', source: 'formatter-default' });
    expect(resolved.explicit).toContain('lineLength');
    expect(resolved.explicit).not.toContain('indentSize');
  });

  it('applies layers in the documented order', () => {
    const custom: ProfileDefinition = { id: 'mine', name: 'Mine', style: { lineLength: 90, indentSize: 3 }, languages: { typescript: { indentSize: 5 } } };
    const input = {
      ...base,
      languageId: 'typescript',
      formatter: PRETTIER_DESCRIPTOR,
      profiles: { mine: custom },
      user: layer({ defaultProfile: 'mine' }),
    };
    expect(resolveStyle(input).options.lineLength).toMatchObject({ value: 90, source: 'profile', sourceDetail: 'Mine' });
    expect(resolveStyle(input).options.indentSize).toMatchObject({ value: 5, source: 'profile' });

    const withUser = { ...input, user: layer({ defaultProfile: 'mine', style: { lineLength: 100 } }) };
    expect(resolveStyle(withUser).options.lineLength).toMatchObject({ value: 100, source: 'user' });

    const withWorkspace = { ...withUser, workspace: layer({ style: { lineLength: 110 } }) };
    expect(resolveStyle(withWorkspace).options.lineLength).toMatchObject({ value: 110, source: 'workspace' });

    const withUserLanguage = {
      ...withWorkspace,
      user: layer({ defaultProfile: 'mine', style: { lineLength: 100 }, languages: { typescript: { style: { lineLength: 130 } } } }),
    };
    expect(resolveStyle(withUserLanguage).options.lineLength).toMatchObject({ value: 130, source: 'user-language' });
    // The language-specific value must not leak into other languages.
    expect(resolveStyle({ ...withUserLanguage, languageId: 'css' }).options.lineLength.value).toBe(110);

    const withWorkspaceLanguage = {
      ...withUserLanguage,
      workspace: layer({ style: { lineLength: 110 }, languages: { typescript: { style: { lineLength: 140 } } } }),
    };
    expect(resolveStyle(withWorkspaceLanguage).options.lineLength).toMatchObject({ value: 140, source: 'workspace-language' });

    const project = { editorconfig: { lineLength: 150 }, formatterConfig: {}, formatterConfigTakesOver: false };
    const withEditorConfig = { ...withWorkspaceLanguage, project };
    expect(resolveStyle(withEditorConfig).options.lineLength).toMatchObject({ value: 150, source: 'editorconfig', locked: true });

    const withPrettierrc = { ...withEditorConfig, project: { ...project, formatterConfig: { lineLength: 160 }, formatterConfigFile: '/repo/.prettierrc' } };
    const final = resolveStyle(withPrettierrc).options.lineLength;
    expect(final).toMatchObject({ value: 160, source: 'project-config', sourceDetail: '.prettierrc', locked: true });
    expect(final.unavailableReason).toContain('.prettierrc');
  });

  it('ignores project files when "respect project configuration" is off', () => {
    const resolved = resolveStyle({
      ...base,
      respectProjectConfig: false,
      languageId: 'typescript',
      formatter: PRETTIER_DESCRIPTOR,
      user: layer({ style: { lineLength: 100 } }),
      project: { editorconfig: { lineLength: 150 }, formatterConfig: { lineLength: 160 }, formatterConfigTakesOver: false },
    });
    expect(resolved.options.lineLength).toMatchObject({ value: 100, source: 'user', locked: false });
  });

  it('hands control to an opaque formatter config file', () => {
    const resolved = resolveStyle({
      ...base,
      languageId: 'cpp',
      formatter: find('clang-format'),
      user: layer({ style: { lineLength: 100 } }),
      project: { editorconfig: {}, formatterConfig: {}, formatterConfigFile: '/repo/.clang-format', formatterConfigTakesOver: true },
    });
    expect(resolved.projectConfigTakesOver).toBe(true);
    expect(resolved.options.lineLength.locked).toBe(true);
    expect(resolved.options.lineLength.unavailableReason).toContain('.clang-format');
  });
});

describe('supported, unsupported and fixed options', () => {
  it('marks options the formatter lacks as unavailable with a reason', () => {
    const resolved = resolveStyle({ ...base, languageId: 'typescript', formatter: PRETTIER_DESCRIPTOR, user: layer({ style: { braceStyle: 'allman' } }) });
    expect(resolved.options.braceStyle.supported).toBe(false);
    expect(resolved.options.braceStyle.unavailableReason).toContain('Prettier does not offer this option');
    expect(resolved.values.braceStyle).toBeUndefined();
  });

  it('limits options to the languages they apply to', () => {
    const json = resolveStyle({ ...base, languageId: 'json', formatter: PRETTIER_DESCRIPTOR, user: layer({ style: { semicolons: 'never' } }) });
    expect(json.options.semicolons.supported).toBe(false);
    expect(json.options.semicolons.unavailableReason).toContain('for this language');
    const ts = resolveStyle({ ...base, languageId: 'typescript', formatter: PRETTIER_DESCRIPTOR, user: layer({ style: { semicolons: 'never' } }) });
    expect(ts.options.semicolons).toMatchObject({ supported: true, value: 'never' });
  });

  it('never pretends gofmt can be configured', () => {
    const resolved = resolveStyle({
      ...base,
      languageId: 'go',
      formatter: find('gofmt'),
      user: layer({ style: { indentStyle: 'spaces', indentSize: 2, lineLength: 80, braceStyle: 'allman' } }),
    });
    expect(resolved.options.indentStyle).toMatchObject({ source: 'fixed', value: 'tabs', supported: false });
    expect(resolved.options.indentStyle.unavailableReason).toMatch(/gofmt always indents with tabs/);
    expect(resolved.options.lineLength.supported).toBe(false);
    expect(resolved.options.braceStyle.supported).toBe(false);
    expect(Object.keys(resolved.values)).toEqual(['lineEndings']);
  });

  it('rejects values a formatter does not accept and keeps the previous layer', () => {
    const resolved = resolveStyle({ ...base, languageId: 'typescript', formatter: PRETTIER_DESCRIPTOR, user: layer({ style: { quoteStyle: 'preserve' } }) });
    expect(resolved.options.quoteStyle.value).toBe('double');
    expect(resolved.options.quoteStyle.note).toContain('preserve');
    const ruff = resolveStyle({ ...base, languageId: 'python', formatter: find('ruff'), user: layer({ style: { quoteStyle: 'preserve' } }) });
    expect(ruff.options.quoteStyle).toMatchObject({ value: 'preserve', source: 'user' });
  });

  it('clamps numbers to the range of the formatter', () => {
    const resolved = resolveStyle({ ...base, languageId: 'typescript', formatter: PRETTIER_DESCRIPTOR, user: layer({ style: { lineLength: 9999, indentSize: 0 } }) });
    expect(resolved.options.lineLength.value).toBe(300);
    expect(resolved.options.indentSize.value).toBe(1);
  });

  it('uses per-language formatter defaults where a formatter has them', () => {
    const black = resolveStyle({ ...base, languageId: 'python', formatter: find('black') });
    expect(black.options.indentSize).toMatchObject({ source: 'fixed', value: 4 });
    expect(black.options.lineLength).toMatchObject({ value: 120, source: 'profile' });
  });
});

describe('profiles', () => {
  it('picks language profile, then workspace default, then user default, then Standard', () => {
    const profiles = {};
    expect(activeProfile('go', layer(), layer(), profiles).id).toBe('standard');
    expect(activeProfile('go', layer({ defaultProfile: 'compact' }), layer(), profiles).id).toBe('compact');
    expect(activeProfile('go', layer({ defaultProfile: 'compact' }), layer({ defaultProfile: 'readable' }), profiles).id).toBe('readable');
    expect(
      activeProfile('go', layer({ defaultProfile: 'compact', languages: { go: { profile: 'team' } } }), layer({ defaultProfile: 'readable' }), profiles).id,
    ).toBe('team');
    expect(activeProfile('go', layer({ defaultProfile: 'deleted-profile' }), layer(), profiles).id).toBe('standard');
  });

  it('applies built-in profile values, including per-language additions', () => {
    const team = resolveStyle({ ...base, languageId: 'typescript', formatter: PRETTIER_DESCRIPTOR, user: layer({ defaultProfile: 'team' }) });
    expect(team.options.quoteStyle).toMatchObject({ value: 'single', source: 'profile', sourceDetail: 'Team Style' });
    expect(team.options.lineLength.value).toBe(100);
    const python = resolveStyle({ ...base, languageId: 'python', formatter: find('ruff'), user: layer({ defaultProfile: 'team' }) });
    expect(python.options.indentSize.value).toBe(4);
    expect(python.options.quoteStyle.value).toBe('double');
  });

  it('reports profile options a formatter cannot apply', () => {
    const compact = BUILTIN_PROFILES.find((profile) => profile.id === 'compact') as ProfileDefinition;
    const forGo = unsupportedProfileOptions(compact, find('gofmt'), 'go').map((issue) => issue.id);
    expect(forGo).toEqual(expect.arrayContaining(['lineLength', 'indentStyle', 'indentSize', 'bracketSpacing']));
    const forTs = unsupportedProfileOptions(compact, PRETTIER_DESCRIPTOR, 'typescript').map((issue) => issue.id);
    expect(forTs).toEqual(expect.arrayContaining(['maxBlankLines', 'shortFunctionsOnOneLine', 'shortIfOnOneLine']));
    expect(forTs).not.toContain('lineLength');
    expect(unsupportedProfileOptions(compact, find('clang-format'), 'cpp').map((issue) => issue.id)).not.toContain('shortIfOnOneLine');
  });
});

describe('formatter selection', () => {
  const status = (available: string[]): Record<string, FormatterStatus> =>
    Object.fromEntries(descriptors.map((descriptor) => [descriptor.id, { id: descriptor.id, available: available.includes(descriptor.id) }]));
  const python = getLanguage('python');
  const java = getLanguage('java');
  if (!python || !java) {
    throw new Error('languages missing');
  }

  it('uses the first installed formatter in order of preference', () => {
    expect(chooseFormatter(python, descriptors, status(['ruff', 'black']), layer(), layer()).formatter?.id).toBe('ruff');
    expect(chooseFormatter(python, descriptors, status(['black']), layer(), layer()).formatter?.id).toBe('black');
    expect(chooseFormatter(java, descriptors, status(['prettier-java', 'google-java-format']), layer(), layer()).formatter?.id).toBe('prettier-java');
  });

  it('falls back to the preferred formatter when none is installed so setup guidance can be shown', () => {
    const choice = chooseFormatter(python, descriptors, status([]), layer(), layer());
    expect(choice.formatter?.id).toBe('ruff');
    expect(choice.explicit).toBe(false);
    expect(choice.candidates.map((candidate) => candidate.id)).toEqual(['ruff', 'black', 'ruff-wasm']);
    // With only the bundled build available, that one is used.
    expect(chooseFormatter(python, descriptors, status(['ruff-wasm']), layer(), layer()).formatter?.id).toBe('ruff-wasm');
  });

  it('honours an explicit choice, workspace before user, even when not installed', () => {
    const user = layer({ languages: { python: { formatter: 'black' } } });
    expect(chooseFormatter(python, descriptors, status(['ruff']), user, layer())).toMatchObject({ explicit: true, formatter: { id: 'black' } });
    const workspace = layer({ languages: { python: { formatter: 'ruff' } } });
    expect(chooseFormatter(python, descriptors, status(['ruff', 'black']), user, workspace).formatter?.id).toBe('ruff');
  });

  it('ignores an explicit choice that cannot format the language', () => {
    const user = layer({ languages: { python: { formatter: 'gofmt' } } });
    expect(chooseFormatter(python, descriptors, status(['ruff']), user, layer())).toMatchObject({ explicit: false, formatter: { id: 'ruff' } });
  });
});
