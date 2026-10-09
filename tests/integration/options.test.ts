import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FormatterError } from '../../src/core/adapter';
import { applyChanges, computeChanges } from '../../src/core/edits';
import { createService, loadFixture, makeEnv, makeSettings, withStyle } from '../helpers/harness';

/** Real formatter output for the bundled engines: every assertion below is about actual formatted code. */
const { service, registry, env } = createService();
const scratch = mkdtempSync(path.join(os.tmpdir(), 'codeneat-options-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ts = (text: string, style = {}, extra = {}) => service.format({ text, languageId: 'typescript', fileName: 'a.ts', ...extra }, withStyle(style));
const longest = (text: string): number => Math.max(...text.split('\n').map((line) => line.length));
const CALL = 'const result = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour, argumentNumberFive);\n';

describe('line length', () => {
  it('uses 120 characters by default', async () => {
    const result = await ts(CALL);
    expect(result.plan.resolved.options.lineLength.value).toBe(120);
    expect(result.text.trimEnd().split('\n')).toHaveLength(7);
    const fits = 'const result = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour);\n';
    expect((await ts(fits)).text).toBe(fits);
  });

  it.each([60, 80, 100, 140, 160])('wraps at the preferred width of %i', async (width) => {
    const result = await ts(CALL, { lineLength: width });
    expect(longest(result.text)).toBeLessThanOrEqual(width);
  });

  it('keeps a line on one line when the width allows it', async () => {
    expect((await ts(CALL, { lineLength: 160 })).text).toBe(CALL);
    expect((await ts(CALL, { lineLength: 80 })).text.split('\n').length).toBeGreaterThan(2);
  });

  it('is a preferred width: unbreakable strings are never split', async () => {
    const text = 'const url = "https://example.com/a/very/long/path/that/cannot/be/split/without/changing/the/program";\n';
    const result = await ts(text, { lineLength: 40 });
    expect(result.text).toContain('"https://example.com/a/very/long/path/that/cannot/be/split/without/changing/the/program"');
    expect(longest(result.text)).toBeGreaterThan(40);
  });

  it('applies to other bundled engines too', async () => {
    const java = loadFixture('java');
    const narrow = await service.format({ text: java.text, languageId: 'java', fileName: java.fileName }, withStyle({ lineLength: 60 }));
    const wide = await service.format({ text: java.text, languageId: 'java', fileName: java.fileName }, withStyle({ lineLength: 160 }));
    expect(longest(narrow.text)).toBeLessThan(longest(wide.text));
    const toml = 'authors = ["Ada <ada@example.com>", "Linus <linus@example.com>", "Grace <grace@example.com>"]\n';
    const tomlNarrow = await service.format({ text: toml, languageId: 'toml', fileName: 'a.toml' }, withStyle({ lineLength: 40 }));
    expect(tomlNarrow.text.split('\n').length).toBeGreaterThan(3);
  });
});

describe('indentation', () => {
  const BLOCK = 'function f(){if(a){return 1}}\n';

  it('indents with spaces of the chosen size', async () => {
    expect((await ts(BLOCK, { indentStyle: 'spaces', indentSize: 2 })).text).toContain('\n  if (a) {\n    return 1;');
    expect((await ts(BLOCK, { indentStyle: 'spaces', indentSize: 4 })).text).toContain('\n    if (a) {\n        return 1;');
    expect((await ts(BLOCK, { indentSize: 8 })).text).toContain('\n        if (a) {');
  });

  it('indents with tabs', async () => {
    const result = await ts(BLOCK, { indentStyle: 'tabs' });
    expect(result.text).toContain('\n\tif (a) {\n\t\treturn 1;');
    expect(result.text).not.toMatch(/\n {2,}/);
  });

  it('works for Java, XML and SQL', async () => {
    const java = await service.format({ text: 'class A{void f(){int x=1;}}\n', languageId: 'java', fileName: 'A.java' }, withStyle({ indentStyle: 'tabs' }));
    expect(java.text).toContain('\n\tvoid f() {\n\t\tint x = 1;');
    const xml = await service.format({ text: '<a><b><c/></b></a>\n', languageId: 'xml', fileName: 'a.xml' }, withStyle({ indentSize: 4, xmlWhitespace: 'ignore' }));
    expect(xml.text).toContain('\n    <b>\n        <c />');
    const sql = await service.format({ text: 'select a,b from t where x=1;\n', languageId: 'sql', fileName: 'a.sql' }, withStyle({ indentSize: 4, sqlKeywordCase: 'upper' }));
    expect(sql.text).toBe('SELECT\n    a,\n    b\nFROM\n    t\nWHERE\n    x = 1;\n');
  });
});

describe('quotes, semicolons and commas', () => {
  const CODE = 'const a = "x"; const b = \'y\'\nconst list = [\n  1,\n  2\n]\n';

  it('single and double quotes', async () => {
    expect((await ts(CODE, { quoteStyle: 'single' })).text).toContain("const a = 'x';\nconst b = 'y';");
    expect((await ts(CODE, { quoteStyle: 'double' })).text).toContain('const a = "x";\nconst b = "y";');
  });

  it('keeps the other quote when that avoids escaping', async () => {
    expect((await ts('const s = "it\'s";\n', { quoteStyle: 'single' })).text).toBe('const s = "it\'s";\n');
  });

  it('semicolons on and off', async () => {
    expect((await ts(CODE, { semicolons: 'always' })).text).toContain('const a = "x";');
    const without = (await ts(CODE, { semicolons: 'never' })).text;
    expect(without).toContain('const a = "x"\n');
    expect(without).not.toContain(';');
  });

  it('trailing commas', async () => {
    expect((await ts(CODE, { trailingCommas: 'all', lineLength: 40 })).text).toContain('const list = [1, 2];');
    const multi = 'const o = {\n  alpha: 1,\n  beta: 2\n}\n';
    expect((await ts(multi, { trailingCommas: 'all' })).text).toContain('beta: 2,\n');
    expect((await ts(multi, { trailingCommas: 'none' })).text).toContain('beta: 2\n');
  });

  it('bracket spacing and arrow parentheses', async () => {
    const code = 'const o = {a:1}; const f = x => x\n';
    expect((await ts(code, { bracketSpacing: false, arrowParens: 'avoid' })).text).toBe('const o = {a: 1};\nconst f = x => x;\n');
    expect((await ts(code, { bracketSpacing: true, arrowParens: 'always' })).text).toBe('const o = { a: 1 };\nconst f = (x) => x;\n');
  });
});

describe('profiles and per-language settings', () => {
  it('a profile changes the result and a language override wins over it', async () => {
    const settings = makeSettings({ user: { style: {}, languages: {}, defaultProfile: 'team' } });
    const team = await service.format({ text: 'const a = "x"\n', languageId: 'typescript', fileName: 'a.ts' }, settings);
    expect(team.text).toBe("const a = 'x';\n");
    expect(team.plan.resolved.profile.name).toBe('Team Style');
    const overridden = makeSettings({ user: { style: {}, defaultProfile: 'team', languages: { typescript: { style: { quoteStyle: 'double' } } } } });
    expect((await service.format({ text: 'const a = "x"\n', languageId: 'typescript', fileName: 'a.ts' }, overridden)).text).toBe('const a = "x";\n');
    const css = await service.format({ text: 'a{content:"x"}\n', languageId: 'css', fileName: 'a.css' }, overridden);
    expect(css.text).toContain("content: 'x'");
  });

  it('a custom profile is applied', async () => {
    const settings = makeSettings({
      profiles: { tiny: { id: 'tiny', name: 'Tiny', style: { indentStyle: 'tabs', semicolons: 'never' } } },
      workspace: { style: {}, languages: {}, defaultProfile: 'tiny' },
    });
    expect((await service.format({ text: 'function f(){return 1}\n', languageId: 'javascript', fileName: 'a.js' }, settings)).text).toBe('function f() {\n\treturn 1\n}\n');
  });
});

describe('range formatting', () => {
  it('formats only the selected statement', async () => {
    const text = 'const   a=1\nconst   b=2\nconst   c=3\n';
    const start = text.indexOf('const   b');
    const result = await ts(text, {}, { range: { start, end: start + 'const   b=2'.length } });
    expect(result.text).toBe('const   a=1\nconst b = 2;\nconst   c=3\n');
    const changes = computeChanges(text, result.text);
    expect(changes).toHaveLength(1);
    expect(applyChanges(text, changes)).toBe(result.text);
  });

  it('refuses a selection where the formatter cannot do it', async () => {
    const error = await service
      .format({ text: '# A\n\n*  b\n', languageId: 'markdown', fileName: 'a.md', range: { start: 0, end: 3 } }, makeSettings())
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(FormatterError);
    expect((error as FormatterError).kind).toBe('unsupported');
  });
});

describe('project configuration', () => {
  const project = path.join(scratch, 'project');
  mkdirSync(path.join(project, 'src', 'generated'), { recursive: true });
  writeFileSync(path.join(project, '.prettierrc'), JSON.stringify({ singleQuote: true, semi: false, printWidth: 50 }));
  writeFileSync(path.join(project, '.editorconfig'), 'root = true\n[*]\nindent_style = tab\nmax_line_length = 70\n');
  writeFileSync(path.join(project, '.prettierignore'), 'src/generated/\n');
  const file = path.join(project, 'src', 'a.ts');
  const input = { text: 'function f(){const a = "x"; return a}\n', languageId: 'typescript', fileName: 'a.ts', filePath: file, workspaceRoot: project };

  it('lets .prettierrc and .editorconfig win by default, and says so', async () => {
    const result = await service.format(input, withStyle({ quoteStyle: 'double', semicolons: 'always', indentStyle: 'spaces', lineLength: 200 }));
    expect(result.text).toBe("function f() {\n\tconst a = 'x'\n\treturn a\n}\n");
    const options = result.plan.resolved.options;
    expect(options.quoteStyle).toMatchObject({ value: 'single', source: 'project-config', sourceDetail: '.prettierrc', locked: true });
    expect(options.lineLength).toMatchObject({ value: 50, source: 'project-config' });
    expect(options.indentStyle).toMatchObject({ value: 'tabs', source: 'editorconfig', locked: true });
    expect(result.plan.project.formatterConfigFile).toBe(path.join(project, '.prettierrc'));
  });

  it('uses CodeNeat preferences instead when asked to', async () => {
    const settings = withStyle({ quoteStyle: 'double', semicolons: 'always', indentStyle: 'spaces', indentSize: 2 }, { respectProjectConfig: false });
    expect((await service.format(input, settings)).text).toBe('function f() {\n  const a = "x";\n  return a;\n}\n');
  });

  it('never reads project files in an untrusted workspace', async () => {
    const untrusted = createService(makeEnv({ trusted: false }));
    const result = await untrusted.service.format(input, makeSettings());
    expect(result.text).toBe('function f() {\n  const a = "x";\n  return a;\n}\n');
    expect(result.plan.project.formatterConfigFile).toBeUndefined();
  });

  it('leaves files listed in .prettierignore alone', async () => {
    const ignored = { ...input, filePath: path.join(project, 'src', 'generated', 'g.ts'), fileName: 'g.ts' };
    await expect(service.format(ignored, makeSettings())).rejects.toMatchObject({ kind: 'ignored' });
  });

  it('does not use a config file from outside the workspace folder', async () => {
    const inner = path.join(project, 'src');
    const result = await service.format({ ...input, workspaceRoot: inner }, makeSettings());
    expect(result.text).toContain('"x";');
  });
});

describe('safety', () => {
  it('reports syntax errors and returns no text', async () => {
    const error = (await ts('const = ;\n').catch((reason: unknown) => reason)) as FormatterError;
    expect(error).toBeInstanceOf(FormatterError);
    expect(error.kind).toBe('failed');
    expect(error.message).toContain('syntax error');
    expect(error.message).toContain('nothing was changed');
    for (const [languageId, fileName, text] of [['java', 'A.java', 'class {'], ['json', 'a.json', '{"a":'], ['sql', 'a.sql', 'select (a from'], ['xml', 'a.xml', '<a><b></a>']]) {
      await expect(service.format({ text, languageId, fileName }, makeSettings()), languageId).rejects.toBeInstanceOf(FormatterError);
    }
  });

  it('skips files over the size limit', async () => {
    const big = `const a = "${'x'.repeat(20 * 1024)}";\n`;
    await expect(service.format({ text: big, languageId: 'typescript', fileName: 'a.ts' }, makeSettings({ maxFileSizeKB: 16 }))).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('honours cancellation', async () => {
    const token = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => undefined }) };
    await expect(service.format({ text: 'a', languageId: 'typescript', fileName: 'a.ts' }, makeSettings(), token)).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('rejects unknown languages and mismatched formatters', async () => {
    await expect(service.format({ text: 'a', languageId: 'cobol', fileName: 'a.cob' }, makeSettings())).rejects.toMatchObject({ kind: 'unsupported' });
    await expect(service.format({ text: 'a', languageId: 'python', fileName: 'a.py' }, makeSettings(), undefined, 'prettier')).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('reports a missing external formatter with setup guidance instead of pretending', async () => {
    // Rust has no bundled engine, so without rustfmt there is nothing that could format it.
    const status = await registry.detect('rustfmt', env);
    if (status.available) {
      return;
    }
    const error = (await service.format({ text: 'fn main(){}\n', languageId: 'rust', fileName: 'main.rs' }, makeSettings()).catch((reason: unknown) => reason)) as FormatterError;
    expect(error.kind).toBe('missing');
    expect(error.message).toContain('rustfmt was not found');
    expect(error.install?.commands[0].command).toBe('rustup component add rustfmt');
  });

  it('preserves Unicode exactly', async () => {
    const text = 'const greeting = "héllo 👋🏽 世界 ‮ \\u0000";  // commentaire été — ✓\n';
    const result = await ts(text);
    expect(result.text).toBe('const greeting = "héllo 👋🏽 世界 ‮ \\u0000"; // commentaire été — ✓\n');
  });

  it('keeps Windows line endings unless told otherwise', async () => {
    expect((await ts('const a=1\r\nconst b=2\r\n')).text).toBe('const a = 1;\r\nconst b = 2;\r\n');
    expect((await ts('const a=1\r\nconst b=2\r\n', { lineEndings: 'lf' })).text).toBe('const a = 1;\nconst b = 2;\n');
    expect((await ts('const a=1\n', { lineEndings: 'crlf' })).text).toBe('const a = 1;\r\n');
    const sql = await service.format({ text: 'select 1;\r\nselect 2;\r\n', languageId: 'sql', fileName: 'a.sql' }, makeSettings());
    expect(sql.text).toBe('select\r\n  1;\r\n\r\nselect\r\n  2;\r\n');
  });

  it('never removes or reorders imports as part of ordinary formatting', async () => {
    const text = 'import { z } from "z";\nimport { unused } from "a";\nconsole.log(z);\n';
    expect((await ts(text)).text).toBe(text);
    // The Java plugin sorts imports (declared as fixed behaviour) but never drops one.
    const java = 'import java.util.Map;\nimport java.util.List;\n\nclass A {}\n';
    const formatted = await service.format({ text: java, languageId: 'java', fileName: 'A.java' }, makeSettings());
    expect(formatted.text).toBe('import java.util.List;\nimport java.util.Map;\n\nclass A {}\n');
    expect(formatted.plan.resolved.options.sortImports).toMatchObject({ source: 'fixed', value: true });
    expect(formatted.plan.resolved.options.removeUnusedImports.supported).toBe(false);
  });
});

describe('language detection through the registry', () => {
  it('formats Angular templates with the Angular parser', async () => {
    const result = await service.format({ text: '@if (a) {<p>{{x|json}}</p>}\n', languageId: 'angular', fileName: 'a.component.html' }, makeSettings());
    expect(result.text).toBe('@if (a) {\n  <p>{{ x | json }}</p>\n}\n');
  });

  it('keeps the key order of package.json', async () => {
    const result = await service.format({ text: '{"name":"x","a":[1]}', languageId: 'json', fileName: 'package.json' }, makeSettings());
    // package.json is written exactly like npm writes it (JSON.stringify layout).
    expect(result.text).toBe(`${JSON.stringify({ name: 'x', a: [1] }, null, 2)}\n`);
  });
});

describe('swift-format (runs only where it is installed)', () => {
  it('applies line length and indentation', async (context) => {
    if (!(await registry.detect('swift-format', env)).available) {
      context.skip('swift-format is not installed on this machine');
      return;
    }
    const text = 'struct A{\nfunc f(){\nprint("hi")}}\n';
    const four = await service.format({ text, languageId: 'swift', fileName: 'a.swift' }, withStyle({ indentSize: 4, indentStyle: 'spaces' }));
    expect(four.text).toBe('struct A {\n    func f() {\n        print("hi")\n    }\n}\n');
    const tabs = await service.format({ text, languageId: 'swift', fileName: 'a.swift' }, withStyle({ indentStyle: 'tabs' }));
    expect(tabs.text).toContain('\n\tfunc f()');
    const call = 'let value = compute(firstArgument: 1, secondArgument: 2, thirdArgument: 3)\n';
    const narrow = await service.format({ text: call, languageId: 'swift', fileName: 'a.swift' }, withStyle({ lineLength: 40 }));
    const wide = await service.format({ text: call, languageId: 'swift', fileName: 'a.swift' }, withStyle({ lineLength: 120 }));
    expect(wide.text).toBe(call);
    expect(narrow.text.split('\n').length).toBeGreaterThan(2);
    await expect(service.format({ text: 'struct {', languageId: 'swift', fileName: 'a.swift' }, makeSettings())).rejects.toMatchObject({ kind: 'failed' });
  }, 60000);
});
