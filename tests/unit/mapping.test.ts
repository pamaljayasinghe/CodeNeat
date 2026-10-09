import { describe, expect, it } from 'vitest';
import type { BuildContext, ExternalSpec, Invocation } from '../../src/adapters/external';
import { fromPrettierConfig, parserFor, toPrettierOptions } from '../../src/adapters/prettier';
import { buf, dockerfmt, latexindent, sqlfluff, taplo, terraformFmt } from '../../src/adapters/tools/data';
import { csharpier, fantomas } from '../../src/adapters/tools/dotnet';
import { googleJavaFormat, ktfmt, ktlint, scalafmt } from '../../src/adapters/tools/jvm';
import { dartFormat, swiftFormat } from '../../src/adapters/tools/mobile';
import { black, ruff } from '../../src/adapters/tools/python';
import { air, phpCsFixer, psScriptAnalyzer, rubocop, shfmt, styler, stylua } from '../../src/adapters/tools/scripting';
import { clangFormat, clangFormatStyle, gofmt, rustfmt } from '../../src/adapters/tools/systems';
import { type FormatRequest, StyleReader } from '../../src/core/adapter';
import type { StyleOptions } from '../../src/shared/types';

interface Built {
  invocations: Invocation[];
  args: string[];
  temp: Record<string, string>;
}

/** Runs a spec's argument builder without needing the real tool. */
async function build(spec: ExternalSpec, style: StyleOptions, extra: Partial<FormatRequest> = {}, version?: string, lines?: { start: number; end: number }): Promise<Built> {
  const temp: Record<string, string> = {};
  const request: FormatRequest = {
    text: 'x',
    languageId: spec.descriptor.languages[0],
    fileName: `input${spec.descriptor.extensions[0] ?? ''}`,
    style,
    explicit: Object.keys(style),
    projectConfigTakesOver: false,
    useProjectConfig: true,
    timeoutMs: 1000,
    ...extra,
  };
  const context: BuildContext = {
    request,
    style: StyleReader.of(request),
    version,
    applyStyle: !request.projectConfigTakesOver,
    inputFile: async () => '/tmp/codeneat/src/input',
    writeTemp: async (name, content) => {
      temp[name] = content;
      return `/tmp/codeneat/${name}`;
    },
    lineRange: lines,
    byteRange: lines ? { start: 10, end: 20 } : undefined,
  };
  const invocations = await spec.build(context);
  return { invocations, args: invocations[invocations.length - 1].args, temp };
}

describe('Prettier option mapping', () => {
  it('maps CodeNeat preferences to Prettier options', () => {
    expect(
      toPrettierOptions(
        {
          lineLength: 100,
          indentSize: 4,
          indentStyle: 'tabs',
          lineEndings: 'crlf',
          quoteStyle: 'single',
          jsxQuoteStyle: 'single',
          semicolons: 'never',
          trailingCommas: 'none',
          bracketSpacing: false,
          arrowParens: 'avoid',
          operatorLinePosition: 'start',
          htmlWhitespace: 'ignore',
          proseWrap: 'always',
        },
        'prettier',
      ),
    ).toEqual({
      printWidth: 100,
      tabWidth: 4,
      useTabs: true,
      endOfLine: 'crlf',
      singleQuote: true,
      jsxSingleQuote: true,
      semi: false,
      trailingComma: 'none',
      bracketSpacing: false,
      arrowParens: 'avoid',
      experimentalOperatorPosition: 'start',
      htmlWhitespaceSensitivity: 'ignore',
      proseWrap: 'always',
    });
  });

  it('passes nothing for preferences that are not set', () => {
    expect(toPrettierOptions({}, 'prettier')).toEqual({});
    expect(toPrettierOptions({ indentStyle: 'spaces', quoteStyle: 'double', semicolons: 'always' }, 'prettier')).toEqual({
      useTabs: false,
      singleQuote: false,
      semi: true,
    });
  });

  it('uses plugin-specific options for XML and TOML', () => {
    expect(toPrettierOptions({ quoteStyle: 'preserve', xmlWhitespace: 'ignore', xmlSortAttributes: true }, 'prettier-xml')).toEqual({
      xmlQuoteAttributes: 'preserve',
      xmlWhitespaceSensitivity: 'ignore',
      xmlSortAttributesByKey: true,
    });
    expect(toPrettierOptions({ maxBlankLines: 2, tomlAlignEntries: true, tomlReorderKeys: false }, 'prettier-toml')).toEqual({
      allowedBlankLines: 2,
      alignEntries: true,
      reorderKeys: false,
    });
    expect(toPrettierOptions({ maxBlankLines: 2 }, 'prettier')).toEqual({});
  });

  it('reads a .prettierrc back into CodeNeat preferences (round trip)', () => {
    const style: StyleOptions = { lineLength: 90, indentSize: 3, indentStyle: 'tabs', quoteStyle: 'single', semicolons: 'never', trailingCommas: 'es5', bracketSpacing: false };
    expect(fromPrettierConfig(toPrettierOptions(style, 'prettier'), 'prettier')).toEqual(style);
    expect(fromPrettierConfig({ printWidth: '80', plugins: ['x'], overrides: [] }, 'prettier')).toEqual({});
  });

  it('chooses the parser from the language, not from guesses', () => {
    expect(parserFor('typescript', 'a.ts')).toBe('typescript');
    expect(parserFor('angular', 'a.component.html')).toBe('angular');
    expect(parserFor('json', '/x/package.json')).toBe('json-stringify');
    expect(parserFor('json', 'data.json')).toBe('json');
    expect(parserFor('python', 'a.py')).toBeUndefined();
  });
});

describe('external formatter arguments', () => {
  it('ruff: line length, indentation, quotes and isolation', async () => {
    const { args } = await build(ruff, { lineLength: 100, indentStyle: 'tabs', indentSize: 2, quoteStyle: 'single', pythonMagicTrailingComma: false });
    expect(args.slice(0, 3)).toEqual(['format', '--line-length', '100']);
    expect(args).toEqual(expect.arrayContaining(['indent-width = 2', 'format.indent-style = "tab"', 'format.quote-style = "single"', 'format.skip-magic-trailing-comma = true']));
    expect(args.slice(-3)).toEqual(['--stdin-filename', 'input.py', '-']);
    expect(args).not.toContain('--isolated');
    expect((await build(ruff, {}, { useProjectConfig: false })).args).toContain('--isolated');
  });

  it('ruff: sorts imports in a separate, fix-only step and supports ranges', async () => {
    const sorted = await build(ruff, { sortImports: true });
    expect(sorted.invocations).toHaveLength(2);
    expect(sorted.invocations[0].args.slice(0, 5)).toEqual(['check', '--select', 'I', '--fix-only', '--exit-zero']);
    expect((await build(ruff, {})).invocations).toHaveLength(1);
    expect((await build(ruff, {}, {}, undefined, { start: 3, end: 7 })).args).toContain('--range=3-7');
  });

  it('passes no style flags at all when a project config file takes over', async () => {
    const takeover = { projectConfigTakesOver: true, projectConfigFile: '/repo/config' };
    const style: StyleOptions = { lineLength: 100, indentSize: 8, indentStyle: 'tabs', quoteStyle: 'single' };
    expect((await build(ruff, style, takeover)).args).toEqual(['format', '--stdin-filename', 'input.py', '-']);
    expect((await build(rustfmt, style, takeover)).args).toEqual(['--emit', 'stdout']);
    expect((await build(clangFormat, style, takeover)).args).toEqual(['--assume-filename=input.c', '--style=file', '--fallback-style=LLVM']);
    expect((await build(stylua, style, takeover)).args).toEqual(['--search-parent-directories', '--stdin-filepath', 'input.lua', '-']);
    expect((await build(taplo, style, takeover)).args).toEqual(['format', '--colors', 'never', '--config', '/repo/config', '-']);
    expect((await build(black, style, takeover)).args).toEqual(['--quiet', '--stdin-filename', 'input.py', '-']);
  });

  it('black: supports width, quote preservation and nothing else', async () => {
    const { args } = await build(black, { lineLength: 100, quoteStyle: 'preserve', pythonMagicTrailingComma: false });
    expect(args).toEqual(['--quiet', '--line-length', '100', '--skip-string-normalization', '--skip-magic-trailing-comma', '--stdin-filename', 'input.py', '-']);
  });

  it('rustfmt: stable options only', async () => {
    const { args } = await build(rustfmt, { lineLength: 120, indentSize: 2, indentStyle: 'tabs', sortImports: false, rustEdition: '2024' });
    expect(args).toEqual(['--emit', 'stdout', '--edition', '2024', '--config', 'max_width=120,tab_spaces=2,hard_tabs=true,reorder_imports=false']);
    expect((await build(rustfmt, {})).args).toEqual(['--emit', 'stdout', '--edition', '2021']);
  });

  it('gofmt, terraform fmt and buf take no style arguments', async () => {
    const style: StyleOptions = { lineLength: 100, indentSize: 8, indentStyle: 'spaces', braceStyle: 'allman' };
    expect((await build(gofmt, style)).args).toEqual([]);
    expect((await build(terraformFmt, style)).args).toEqual(['fmt', '-no-color', '-']);
    expect((await build(buf, style)).args).toEqual(['format', '--write', '/tmp/codeneat/src/input']);
  });

  it('clang-format: builds an inline style from explicit preferences only', async () => {
    const reader = new StyleReader(
      { cppBaseStyle: 'Google', lineLength: 100, indentSize: 4, indentStyle: 'tabs', braceStyle: 'allman', indentCaseLabels: true, sortImports: false, shortIfOnOneLine: true, operatorLinePosition: 'start', parenthesesIndent: 'block', spaceBeforeParens: 'never' },
      ['cppBaseStyle', 'lineLength', 'indentSize', 'indentStyle', 'braceStyle', 'indentCaseLabels', 'sortImports', 'shortIfOnOneLine', 'operatorLinePosition', 'parenthesesIndent', 'spaceBeforeParens'],
    );
    expect(clangFormatStyle(reader)).toBe(
      '{BasedOnStyle: Google, ColumnLimit: 100, IndentWidth: 4, TabWidth: 4, UseTab: Always, IndentCaseLabels: true, AlignAfterOpenBracket: BlockIndent, SpaceBeforeParens: Never, BreakBeforeBraces: Allman, AllowShortIfStatementsOnASingleLine: WithoutElse, BreakBeforeBinaryOperators: NonAssignment, SortIncludes: Never}',
    );
    // Formatter defaults (not chosen by the user) must not override the base style.
    expect(clangFormatStyle(new StyleReader({ cppBaseStyle: 'WebKit', lineLength: 80, indentSize: 2 }, ['cppBaseStyle']))).toBe('{BasedOnStyle: WebKit}');
    const ranged = await build(clangFormat, {}, {}, undefined, { start: 2, end: 5 });
    expect(ranged.args).toContain('--lines=2:5');
  });

  it('google-java-format: keeps unused imports unless removal is switched on', async () => {
    expect((await build(googleJavaFormat, {})).args).toEqual(['--skip-removing-unused-imports', '-']);
    expect((await build(googleJavaFormat, { javaStyleGuide: 'aosp', removeUnusedImports: true, sortImports: false, formatDocComments: false })).args).toEqual([
      '--aosp',
      '--skip-sorting-imports',
      '--skip-javadoc-formatting',
      '-',
    ]);
    expect((await build(googleJavaFormat, {}, {}, undefined, { start: 4, end: 9 })).args).toEqual(['--skip-removing-unused-imports', '--lines', '4:9', '-']);
  });

  it('ktfmt and ktlint: style guides', async () => {
    expect((await build(ktfmt, { kotlinStyleGuide: 'kotlinlang' })).args).toEqual(['--kotlinlang-style', '--do-not-remove-unused-imports', '-']);
    expect((await build(ktfmt, { removeUnusedImports: true })).args).toEqual(['-']);
    const lint = await build(ktlint, { kotlinStyleGuide: 'android', lineLength: 100, indentSize: 2, indentStyle: 'spaces' });
    expect(lint.args.slice(0, 3)).toEqual(['--format', '--stdin', '--log-level=none']);
    expect(lint.temp['ktlint.editorconfig']).toBe('root = true\n\n[*.{kt,kts}]\nktlint_code_style = android_studio\nmax_line_length = 100\nindent_size = 2\nindent_style = space\n');
    expect((await build(ktlint, {})).args).toHaveLength(3);
  });

  it('scalafmt: inline configuration pinned to the installed version', async () => {
    const { args } = await build(scalafmt, { lineLength: 100, indentSize: 4 }, {}, '3.8.3');
    expect(args).toEqual(['--stdin', '--stdout', '--quiet', '--assume-filename', 'input.scala', '--config-str', 'version = "3.8.3"\nrunner.dialect = scala3\nmaxColumn = 100\nindent.main = 4']);
  });

  it('csharpier and fantomas: generated config files', async () => {
    const modern = await build(csharpier, { lineLength: 110, indentStyle: 'tabs', indentSize: 2 }, {}, '1.0.2');
    expect(modern.args).toEqual(['format', '--config-path', '/tmp/codeneat/.csharpierrc.json']);
    expect(JSON.parse(modern.temp['.csharpierrc.json'])).toEqual({ printWidth: 110, useTabs: true, indentSize: 2, tabWidth: 2 });
    expect((await build(csharpier, {}, {}, '0.29.2')).args).toEqual([]);
    const fs = await build(fantomas, { lineLength: 100, indentSize: 2 });
    expect(fs.invocations[0]).toMatchObject({ mode: 'file', cwdIsTemp: true });
    expect(fs.temp['.editorconfig']).toBe('root = true\n\n[*.{fs,fsx,fsi}]\nmax_line_length = 100\nindent_size = 2\n');
  });

  it('swift-format: JSON configuration, tabs and byte ranges', async () => {
    const spaces = await build(swiftFormat, { lineLength: 120, indentSize: 4, indentStyle: 'spaces', maxBlankLines: 2 });
    expect(JSON.parse(spaces.temp['swift-format.json'])).toEqual({ version: 1, lineLength: 120, indentation: { spaces: 4 }, tabWidth: 4, maximumBlankLines: 2 });
    const tabs = await build(swiftFormat, { indentStyle: 'tabs', indentSize: 8 });
    expect(JSON.parse(tabs.temp['swift-format.json']).indentation).toEqual({ tabs: 1 });
    const ranged = await build(swiftFormat, {}, {}, undefined, { start: 1, end: 2 });
    expect(ranged.args.slice(-2)).toEqual(['--offsets', '10:20']);
  });

  it('dart format: page width flag depends on the SDK version', async () => {
    expect((await build(dartFormat, { lineLength: 100 }, {}, '3.9.0')).args).toEqual(['--page-width', '100']);
    expect((await build(dartFormat, { lineLength: 100 }, {}, '3.5.4')).args).toEqual(['--line-length', '100']);
    expect((await build(dartFormat, {})).args).toEqual([]);
    expect(dartFormat.prefixArgs).toEqual(['format']);
  });

  it('php-cs-fixer and rubocop', async () => {
    const php = await build(phpCsFixer, { phpRuleSet: '@Symfony', quoteStyle: 'single', sortImports: true });
    expect(php.args).toEqual(['fix', '--using-cache=no', '--quiet', '--no-interaction', '--rules={"@Symfony":true,"single_quote":true,"ordered_imports":true}', '/tmp/codeneat/src/input']);
    expect((await build(phpCsFixer, {})).args[4]).toBe('--rules={"@PSR12":true}');
    const ruby = await build(rubocop, { lineLength: 100, indentSize: 4, indentStyle: 'tabs' });
    expect(ruby.args).toEqual(expect.arrayContaining(['--stdin', 'input.rb', '--fix-layout', '--stderr']));
    expect(ruby.temp['rubocop.yml']).toContain('Layout/LineLength:\n  Max: 100');
    expect(ruby.temp['rubocop.yml']).toContain('Layout/IndentationStyle:\n  EnforcedStyle: tabs');
    expect(ruby.invocations[0].okCodes).toEqual([0, 1]);
  });

  it('stylua and shfmt', async () => {
    const lua = await build(stylua, { lineLength: 100, indentStyle: 'spaces', indentSize: 2, quoteStyle: 'single', luaCallParentheses: 'None' });
    expect(lua.args).toEqual(['--no-editorconfig', '--column-width', '100', '--indent-type', 'Spaces', '--indent-width', '2', '--quote-style', 'AutoPreferSingle', '--call-parentheses', 'None', '--stdin-filepath', 'input.lua', '-']);
    expect((await build(shfmt, { indentStyle: 'spaces', indentSize: 2, indentCaseLabels: true, operatorLinePosition: 'start', shellDialect: 'posix', shellSpaceRedirects: true, shellFunctionNextLine: true })).args).toEqual([
      '-filename', 'input.sh', '-i', '2', '-ci', '-bn', '-ln', 'posix', '-sr', '-fn',
    ]);
    expect((await build(shfmt, { indentStyle: 'tabs', indentSize: 8 })).args).toEqual(['-filename', 'input.sh', '-i', '0']);
    expect((await build(shfmt, {})).args).toEqual(['-filename', 'input.sh']);
  });

  it('PowerShell and R receive preferences through the environment, never inside the command', async () => {
    const ps = await build(psScriptAnalyzer, { indentStyle: 'tabs', indentSize: 2, braceStyle: 'allman' });
    expect(ps.invocations[0].env).toEqual({ CODENEAT_INDENT_KIND: 'tab', CODENEAT_INDENT_SIZE: '2', CODENEAT_BRACE: 'allman' });
    const neutral = await build(psScriptAnalyzer, {});
    expect(ps.args).toEqual(neutral.args);
    expect(ps.args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
    const r = await build(styler, { indentSize: 4 });
    expect(r.invocations[0].env).toEqual({ CODENEAT_INDENT_SIZE: '4' });
    expect(r.args).toEqual((await build(styler, {})).args);
  });

  it('air, sqlfluff, taplo, latexindent and dockerfmt', async () => {
    const r = await build(air, { lineLength: 100, indentSize: 4, indentStyle: 'tabs' });
    expect(r.temp['air.toml']).toBe('[format]\nline-width = 100\nindent-width = 4\nindent-style = "tab"\n');
    const sql = await build(sqlfluff, { sqlDialect: 'postgres', lineLength: 100, indentSize: 2, indentStyle: 'spaces' });
    expect(sql.args.slice(0, 5)).toEqual(['format', '--nocolor', '--disable-progress-bar', '--dialect', 'postgres']);
    expect(sql.temp['sqlfluff.cfg']).toBe('[sqlfluff]\nmax_line_length = 100\n\n[sqlfluff:indentation]\nindent_unit = space\ntab_space_size = 2\n');
    const toml = await build(taplo, { lineLength: 100, indentStyle: 'spaces', indentSize: 4, tomlAlignEntries: true });
    expect(toml.args).toEqual(['format', '--colors', 'never', '--no-auto-config', '--option', 'column_width=100', '--option', 'indent_string=    ', '--option', 'align_entries=true', '-']);
    expect((await build(latexindent, { indentStyle: 'spaces', indentSize: 2 })).args).toEqual(['-y=defaultIndent:"  "', '-g=indent.log', '/tmp/codeneat/src/input']);
    expect((await build(dockerfmt, { indentSize: 2, dockerfileSpaceRedirects: true })).args).toEqual(['--indent', '2', '--space-redirects', '--newline', '/tmp/codeneat/src/input']);
  });
});
