import { describe, expect, it } from 'vitest';
import { createBuiltinAdapters } from '../../src/core/registry';
import { CATALOG } from '../../src/shared/catalog';
import { LANGUAGES } from '../../src/shared/languages';
import { BUILTIN_PROFILES } from '../../src/shared/profiles';
import type { DashboardState, SettingsDraft } from '../../src/shared/types';
import { DEFAULT_EDITOR_SETTINGS, sanitizeDraft } from '../../src/shared/validate';
import { diffMarks, highlightLines, splitHighlightedLines } from '../../webview/src/highlight';
import { draftFromState, sameDraft, setDefaultProfile, setLanguageFormatter, setSlotValue, slotValue, viewLanguage } from '../../webview/src/state';

const formatters = createBuiltinAdapters().map((adapter) => adapter.descriptor);

function makeState(available: string[] = ['prettier', 'prettier-java']): DashboardState {
  return {
    version: '1.0.0',
    catalog: CATALOG,
    languages: LANGUAGES,
    formatters,
    statuses: Object.fromEntries(formatters.map((formatter) => [formatter.id, { id: formatter.id, available: available.includes(formatter.id) }])),
    builtinProfiles: BUILTIN_PROFILES,
    settings: {
      user: { style: {}, languages: {} },
      workspace: { style: {}, languages: {} },
      profiles: {},
      respectProjectConfig: true,
      codeneatFormatOnType: true,
      timeoutMs: 10000,
      maxFileSizeKB: 2048,
      workspaceExclude: [],
      useGitignore: true,
      toolPaths: {},
      showStatusBar: true,
    },
    editor: DEFAULT_EDITOR_SETTINGS,
    defaultFormatter: { global: null, byLanguage: {} },
    activeEditor: null,
    project: {},
    trusted: true,
    hasWorkspace: true,
    platform: 'linux',
    samples: {},
  };
}

describe('dashboard draft editing', () => {
  const state = makeState();
  const draft: SettingsDraft = draftFromState(state);

  it('starts clean and matches what the host would accept', () => {
    expect(sameDraft(draft, draftFromState(state))).toBe(true);
    expect(sanitizeDraft(draft)).toEqual(draft);
  });

  it('stores a value in the chosen place and reports it back', () => {
    const all = setSlotValue(draft, 'user', 'all', 'python', 'lineLength', 100);
    expect(all.user.style).toEqual({ lineLength: 100 });
    expect(slotValue(all, 'user', 'all', 'python', 'lineLength')).toBe(100);
    const language = setSlotValue(draft, 'workspace', 'language', 'python', 'indentSize', 8);
    expect(language.workspace.languages).toEqual({ python: { style: { indentSize: 8 } } });
    expect(slotValue(language, 'workspace', 'language', 'python', 'indentSize')).toBe(8);
    expect(slotValue(language, 'user', 'language', 'python', 'indentSize')).toBeUndefined();
    expect(draft.user.style).toEqual({});
  });

  it('is no longer dirty after a change is reset', () => {
    const changed = setSlotValue(draft, 'user', 'language', 'python', 'indentSize', 8);
    expect(sameDraft(changed, draft)).toBe(false);
    expect(sameDraft(setSlotValue(changed, 'user', 'language', 'python', 'indentSize', undefined), draft)).toBe(true);
    const formatter = setLanguageFormatter(draft, 'user', 'python', 'black');
    expect(sameDraft(setLanguageFormatter(formatter, 'user', 'python', undefined), draft)).toBe(true);
    expect(sameDraft(setDefaultProfile(setDefaultProfile(draft, 'user', 'team'), 'user', undefined), draft)).toBe(true);
  });

  it('shows the effect of unsaved changes for the selected language', () => {
    const edited = setSlotValue(draft, 'user', 'all', 'typescript', 'semicolons', 'never');
    const view = viewLanguage(state, edited, 'typescript');
    expect(view?.formatter?.id).toBe('prettier');
    expect(view?.available).toBe(true);
    expect(view?.resolved?.options.semicolons).toMatchObject({ value: 'never', source: 'user' });
    expect(viewLanguage(state, edited, 'json')?.resolved?.options.semicolons.supported).toBe(false);
  });

  it('reports a missing formatter and disables what it cannot do', () => {
    const go = viewLanguage(state, draft, 'go');
    expect(go?.formatter?.id).toBe('gofmt');
    expect(go?.available).toBe(false);
    expect(go?.resolved?.options.indentStyle.unavailableReason).toContain('tabs');
    expect(viewLanguage(state, draft, 'klingon')).toBeUndefined();
  });

  it('applies project overrides only to the language of the open file, and never when untrusted', () => {
    const project = { prettier: { editorconfig: { indentSize: 8 }, formatterConfig: {}, formatterConfigTakesOver: false } };
    const withFile: DashboardState = {
      ...state,
      project,
      activeEditor: { uri: 'file:///a.ts', fileName: 'a.ts', languageId: 'typescript', vscodeLanguageId: 'typescript', hasSelection: false, lineCount: 1, tooLarge: false },
    };
    expect(viewLanguage(withFile, draft, 'typescript')?.resolved?.options.indentSize).toMatchObject({ value: 8, source: 'editorconfig', locked: true });
    expect(viewLanguage(withFile, draft, 'css')?.resolved?.options.indentSize.value).toBe(2);
    expect(viewLanguage({ ...withFile, trusted: false }, draft, 'typescript')?.resolved?.options.indentSize.value).toBe(2);
  });
});

describe('preview rendering helpers', () => {
  it('keeps one HTML fragment per line with balanced tags', () => {
    const lines = splitHighlightedLines('<span class="a">one\ntwo</span>\n<span class="b">three</span>');
    expect(lines).toEqual(['<span class="a">one</span>', '<span class="a">two</span>', '<span class="b">three</span>']);
    for (const line of highlightLines('/* a\n   b */\nconst s = `x\ny`;\n', 'javascript')) {
      expect((line.match(/<span/g) ?? []).length).toBe((line.match(/<\/span>/g) ?? []).length);
    }
  });

  it('escapes code so it can never become markup', () => {
    const html = highlightLines('<script>alert("x")</script> & more', 'plaintext-unknown').join('\n');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(highlightLines('<img src=x onerror=alert(1)>', 'xml').join('')).not.toMatch(/<img/);
  });

  it('marks exactly the lines that changed', () => {
    const marks = diffMarks('a\nb\nc\nd\n', 'a\nB\nc\nd\ne\n');
    expect([...marks.left]).toEqual([1]);
    expect([...marks.right]).toEqual([1, 4]);
    expect(diffMarks('same\n', 'same\n')).toEqual({ left: new Set(), right: new Set() });
    expect([...diffMarks('a\r\nb\r\n', 'a\nb\n').right]).toEqual([]);
  });
});
