// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createBuiltinAdapters } from '../../src/core/registry';
import { CATALOG } from '../../src/shared/catalog';
import { LANGUAGES } from '../../src/shared/languages';
import { BUILTIN_PROFILES } from '../../src/shared/profiles';
import type { DashboardState } from '../../src/shared/types';
import { DEFAULT_EDITOR_SETTINGS } from '../../src/shared/validate';

/** Drives the real dashboard in a DOM: it must render every page and every control must be editable. */
const posted: { type: string; [key: string]: unknown }[] = [];
const formatters = createBuiltinAdapters().map((adapter) => adapter.descriptor);
const bundled = formatters.filter((formatter) => formatter.kind === 'bundled').map((formatter) => formatter.id);

function makeState(languageId: string | undefined): DashboardState {
  return {
    version: '1.0.0',
    catalog: CATALOG,
    languages: LANGUAGES,
    formatters,
    statuses: Object.fromEntries(formatters.map((formatter) => [formatter.id, { id: formatter.id, available: bundled.includes(formatter.id) }])),
    builtinProfiles: BUILTIN_PROFILES,
    settings: {
      user: { style: {}, languages: {} },
      workspace: { style: {}, languages: {} },
      profiles: {},
      respectProjectConfig: true,
      codeneatFormatOnType: true,
      previewOnSave: false,
      inlineReview: false,
      timeoutMs: 10000,
      maxFileSizeKB: 2048,
      workspaceExclude: [],
      useGitignore: true,
      toolPaths: {},
      showStatusBar: true,
      enabled: true,
      showEditorButton: true,
      showContextMenu: true,
    },
    editor: DEFAULT_EDITOR_SETTINGS,
    defaultFormatter: { global: null, byLanguage: {} },
    activeEditor: languageId
      ? { uri: 'file:///a', fileName: 'a', languageId, vscodeLanguageId: languageId, hasSelection: false, lineCount: 3, tooLarge: false, revision: 1 }
      : null,
    project: {},
    trusted: true,
    hasWorkspace: true,
    workspaceName: 'demo',
    platform: 'darwin',
    samples: { typescript: 'const a=1\n', java: 'class A{}\n', go: 'package main\n', cpp: 'int a;\n' },
  };
}

let container: HTMLElement;
const send = async (data: unknown): Promise<void> => {
  await act(async () => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: 'vscode-webview://test' }));
  });
};
const click = async (element: Element | null | undefined): Promise<void> => {
  expect(element, 'element to click exists').toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
  });
};
const nav = (title: string): Element | undefined => [...container.querySelectorAll('.nav-item')].find((item) => item.textContent === title);
const row = (optionId: string): Element | null => container.querySelector(`[data-option="${optionId}"]`);
const text = (): string => container.textContent ?? '';
const lastApply = (): { draft: { user: { style: Record<string, unknown>; languages: Record<string, { style?: Record<string, unknown> }> } } } =>
  [...posted].reverse().find((message) => message.type === 'apply') as never;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({
    postMessage: (message: { type: string }) => posted.push(message),
    getState: () => undefined,
    setState: () => undefined,
  });
  Element.prototype.scrollTo = () => undefined;
  container = document.createElement('div');
  document.body.appendChild(container);
  const { App } = await import('../../webview/src/App');
  await act(async () => {
    createRoot(container).render(<App />);
  });
});

describe('settings dashboard in a real DOM', () => {
  it('asks the host for its state and shows the overview', async () => {
    expect(posted.some((message) => message.type === 'ready')).toBe(true);
    expect(text()).toContain('Loading CodeNeat settings');
    await send({ type: 'state', reason: 'init', state: makeState('typescript') });
    expect(text()).toContain('Welcome to CodeNeat');
    expect(text()).toContain('All changes saved');
  });

  it('renders every page for every language without crashing', async () => {
    const pages = [...container.querySelectorAll('.nav-item')].map((item) => item.textContent ?? '');
    expect(pages).toHaveLength(15);
    for (const language of LANGUAGES) {
      await send({ type: 'navigate', page: 'overview', languageId: language.id });
      for (const title of pages) {
        await click(nav(title));
        expect(text(), `${language.id} / ${title}`).not.toContain('ran into a problem');
        expect(container.querySelector('.main')?.textContent?.length ?? 0, `${language.id} / ${title}`).toBeGreaterThan(40);
      }
    }
  }, 120000);

  it('every option that a formatter supports has an enabled control', async () => {
    for (const language of LANGUAGES) {
      await send({ type: 'navigate', page: 'general', languageId: language.id });
      for (const title of ['General Formatting', 'Line Length and Wrapping', 'Indentation', 'Spaces and Blank Lines', 'Braces and Brackets', 'Quotes and Semicolons', 'Imports and Comments', 'Language-Specific Options']) {
        await click(nav(title));
        for (const element of container.querySelectorAll('.option-row:not(.is-unavailable)[data-option]')) {
          const controls = [...element.querySelectorAll('.option-control input, .option-control select, .option-control button.switch')];
          expect(controls.length, `${language.id}: ${element.getAttribute('data-option')} has a control`).toBeGreaterThan(0);
          expect(controls.some((control) => !(control as HTMLInputElement).disabled), `${language.id}: ${element.getAttribute('data-option')} is editable`).toBe(true);
        }
        for (const element of container.querySelectorAll('.option-row.is-unavailable[data-option]')) {
          expect(element.querySelector('.option-reason')?.textContent?.length ?? 0, `${language.id}: ${element.getAttribute('data-option')} explains why`).toBeGreaterThan(10);
        }
      }
    }
  }, 120000);

  it('editing a switch, a radio button, a number and a dropdown changes the draft and can be applied', async () => {
    await send({ type: 'navigate', page: 'spacing', languageId: 'typescript' });
    await click(row('bracketSpacing')?.querySelector('button.switch'));
    expect(text()).toContain('Unsaved changes');

    await click(nav('Quotes and Semicolons'));
    await click([...(row('quoteStyle')?.querySelectorAll('input[type=radio]') ?? [])].find((input) => (input as HTMLInputElement).value === 'single'));
    await click([...(row('semicolons')?.querySelectorAll('input[type=radio]') ?? [])].find((input) => (input as HTMLInputElement).value === 'never'));

    await click(nav('Line Length and Wrapping'));
    await click([...(row('lineLength')?.querySelectorAll('button.chip') ?? [])].find((chip) => chip.textContent === '100'));

    await click(nav('Indentation'));
    // Not an option for TypeScript: shown, but disabled with a reason.
    expect((row('htmlWhitespace')?.querySelector('select') as HTMLSelectElement).disabled).toBe(true);
    expect(row('htmlWhitespace')?.querySelector('.option-reason')?.textContent).toContain('for this language');
    await click([...(row('indentStyle')?.querySelectorAll('input[type=radio]') ?? [])].find((input) => (input as HTMLInputElement).value === 'tabs'));

    await click([...container.querySelectorAll('.topbar-actions button')].find((button) => button.textContent === 'Apply'));
    expect(lastApply().draft.user.style).toEqual({ bracketSpacing: false, quoteStyle: 'single', semicolons: 'never', lineLength: 100, indentStyle: 'tabs' });
    expect(text()).toContain('Saving…');
    // The host answers with the saved state; the dashboard is clean again.
    const saved = makeState('typescript');
    saved.settings.user.style = lastApply().draft.user.style as never;
    await send({ type: 'state', reason: 'applied', state: saved });
    expect(text()).toContain('All changes saved');
    expect(text()).toContain('Your settings were saved.');
  });

  it('"Only this language" stores the value for that language, and Reset removes it', async () => {
    await send({ type: 'state', reason: 'init', state: makeState('cpp') });
    await send({ type: 'navigate', page: 'braces', languageId: 'cpp' });
    await click([...container.querySelectorAll('.scopebar button')].find((button) => button.textContent === 'Only C++'));
    const select = row('braceStyle')?.querySelector('select') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    await act(async () => {
      select.value = 'allman';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click([...container.querySelectorAll('.topbar-actions button')].find((button) => button.textContent === 'Apply'));
    expect(lastApply().draft.user.languages.cpp.style).toEqual({ braceStyle: 'allman' });
    await send({ type: 'notice', level: 'error', message: 'Your settings could not be saved: test' });
    expect(text()).toContain('could not be saved');
    await click([...(row('braceStyle')?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'Reset'));
    expect(text()).toContain('All changes saved');
  });

  it('Cancel discards unsaved changes', async () => {
    await send({ type: 'state', reason: 'init', state: makeState('typescript') });
    await send({ type: 'navigate', page: 'spacing', languageId: 'typescript' });
    await click(row('bracketSpacing')?.querySelector('button.switch'));
    expect(text()).toContain('Unsaved changes');
    await click([...container.querySelectorAll('.topbar-actions button')].find((button) => button.textContent === 'Cancel'));
    expect(text()).toContain('All changes saved');
  });

  it('requests a live preview with the unsaved settings', async () => {
    posted.length = 0;
    await send({ type: 'navigate', page: 'quotes', languageId: 'typescript' });
    await click([...(row('quoteStyle')?.querySelectorAll('input[type=radio]') ?? [])].find((input) => (input as HTMLInputElement).value === 'single'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const preview = [...posted].reverse().find((message) => message.type === 'preview') as { request: { languageId: string; formatterId: string; draft: { user: { languages: Record<string, { style?: Record<string, unknown> }> } } } } | undefined;
    expect(preview?.request).toMatchObject({ languageId: 'typescript', formatterId: 'prettier' });
    // "Only this language" is still selected from the previous test, so the value is stored for TypeScript.
    expect(preview?.request.draft.user.languages.typescript?.style?.quoteStyle).toBe('single');
  });

  it('search finds settings by plain words and by native option names', async () => {
    const search = container.querySelector('input[type=search]') as HTMLInputElement;
    const type = async (value: string): Promise<void> => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, value);
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await type('printWidth');
    expect(text()).toContain('Preferred Line Length');
    await type('semicolon');
    expect(row('semicolons')).toBeTruthy();
    await type('zzzz-nothing');
    expect(text()).toContain('No formatting setting matches');
    await type('');
  });
});
