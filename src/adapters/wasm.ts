import * as path from 'node:path';
import {
  type AdapterEnvironment,
  descriptorDefaults,
  type FormatRequest,
  type FormatterAdapter,
  FormatterError,
  NO_PROJECT_CONFIG,
  type ProjectConfigInfo,
  StyleReader,
} from '../core/adapter';
import { EOL_BY_CODENEAT } from '../core/eol';
import type { CancellationSignal } from '../core/process';
import type { FormatterDescriptor, FormatterStatus, OptionCapability } from '../shared/types';
import { dockerfmt, keepBracketForm } from './tools/data';
import { dartFormat } from './tools/mobile';
import { ruff } from './tools/python';
import { shfmt, stylua } from './tools/scripting';
import { clangFormat, clangFormatStyle, gofmt } from './tools/systems';

/**
 * Formatters that ship inside CodeNeat as WebAssembly builds of the official engines. They need
 * nothing installed. They cannot read a tool's own project configuration file (ruff.toml,
 * .clang-format, stylua.toml …); `.editorconfig` and CodeNeat preferences still apply. When the
 * real tool is installed, CodeNeat prefers it, because it does read those files.
 */
interface EngineSpec<M> {
  descriptor: FormatterDescriptor;
  packageName: string;
  load(): Promise<M>;
  format(engine: M, request: FormatRequest, style: StyleReader): string | Promise<string>;
  version?(engine: M): string | undefined;
}

// Kept as a real dynamic import in the CommonJS bundle: these packages are ES modules.
const importModule = <M>(specifier: string): Promise<M> => import(specifier) as Promise<M>;

const EOL: OptionCapability = { native: EOL_BY_CODENEAT, support: 'full', default: 'auto' };

function bundled(
  base: FormatterDescriptor,
  overrides: Pick<FormatterDescriptor, 'id' | 'displayName' | 'engine'> & Partial<FormatterDescriptor>,
  keepOptions: string[],
  extraLimitations: string[] = [],
): FormatterDescriptor {
  const options: Record<string, OptionCapability> = { lineEndings: EOL };
  for (const id of keepOptions) {
    if (base.options[id]) {
      options[id] = base.options[id];
    }
  }
  return {
    ...descriptorDefaults(),
    kind: 'bundled',
    license: base.license,
    homepage: base.homepage,
    languages: base.languages,
    extensions: base.extensions,
    requirement: 'Bundled with CodeNeat (WebAssembly build). Nothing to install.',
    install: { summary: `${overrides.displayName} is bundled with CodeNeat, so there is nothing to install.`, commands: [], url: base.homepage },
    fixed: base.fixed,
    lineLength: base.lineLength,
    lineLengthNote: base.lineLengthNote,
    cancellation: 'discard-result',
    configFiles: [],
    ...overrides,
    options: { ...options, ...(overrides.options ?? {}) },
    limitations: [...extraLimitations, ...base.limitations],
  };
}

const noConfigFile = (tool: string, files: string): string =>
  `The bundled build does not read ${files}. Install ${tool} to have that file respected; .editorconfig and your CodeNeat preferences always apply.`;

function packageVersion(packageName: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require(`${packageName}/package.json`) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('\n');
}

/** Adapter for an engine that runs inside the extension host. */
export class EngineAdapter<M> implements FormatterAdapter {
  readonly descriptor: FormatterDescriptor;
  private engine: Promise<M> | undefined;

  constructor(private readonly spec: EngineSpec<M>) {
    this.descriptor = spec.descriptor;
  }

  reset(): void {
    // A loaded engine stays valid; only a failed load is retried.
  }

  private load(): Promise<M> {
    if (!this.engine) {
      this.engine = this.spec.load();
      this.engine.catch(() => {
        this.engine = undefined;
      });
    }
    return this.engine;
  }

  async detect(): Promise<FormatterStatus> {
    const id = this.descriptor.id;
    try {
      const engine = await this.load();
      return {
        id,
        available: true,
        version: this.spec.version?.(engine) ?? packageVersion(this.spec.packageName),
        path: 'bundled with CodeNeat',
        origin: 'bundled',
      };
    } catch (error) {
      return {
        id,
        available: false,
        problem: `The bundled ${this.descriptor.displayName} could not be started in this version of VS Code: ${describeError(error).split('\n')[0]}`,
      };
    }
  }

  async readProjectConfig(): Promise<ProjectConfigInfo> {
    return NO_PROJECT_CONFIG;
  }

  async format(request: FormatRequest, _env: AdapterEnvironment, token: CancellationSignal): Promise<string> {
    if (request.range && !this.descriptor.rangeLanguages.includes(request.languageId)) {
      throw new FormatterError('unsupported', `${this.descriptor.displayName} cannot format only a selection.`);
    }
    let engine: M;
    try {
      engine = await this.load();
    } catch (error) {
      throw new FormatterError('missing', `The bundled ${this.descriptor.displayName} could not be started: ${describeError(error).split('\n')[0]}`);
    }
    let output: string;
    try {
      output = await this.spec.format(engine, request, StyleReader.of(request));
    } catch (error) {
      if (error instanceof FormatterError) {
        throw error;
      }
      throw new FormatterError(
        'failed',
        `${this.descriptor.displayName} could not format this file, so nothing was changed:\n${describeError(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
    if (token.isCancellationRequested) {
      throw new FormatterError('cancelled', 'Formatting was cancelled.');
    }
    if (typeof output !== 'string') {
      throw new FormatterError('failed', `${this.descriptor.displayName} could not format this file, so nothing was changed.`);
    }
    return output;
  }
}

// ───────────────────────────────────────────────────────────── gofmt

interface GofmtModule {
  format(input: string): string;
}

export const GOFMT_WASM: EngineSpec<GofmtModule> = {
  descriptor: bundled(gofmt.descriptor, { id: 'gofmt-wasm', displayName: 'gofmt (bundled)', engine: 'gofmt, compiled to WebAssembly (@wasm-fmt/gofmt)' }, []),
  packageName: '@wasm-fmt/gofmt',
  load: () => importModule<GofmtModule>('@wasm-fmt/gofmt'),
  format: (engine, request) => engine.format(request.text),
};

// ───────────────────────────────────────────────────────────── Ruff

export interface RuffConfig {
  indent_style?: 'tab' | 'space';
  indent_width?: number;
  line_width?: number;
  quote_style?: 'single' | 'double' | 'preserve';
  magic_trailing_comma?: 'respect' | 'ignore';
  docstring_code?: boolean;
}

interface RuffModule {
  format(input: string, path?: string | null, config?: RuffConfig | null): string;
}

export function ruffConfig(style: StyleReader): RuffConfig {
  const config: RuffConfig = {};
  if (style.useTabs !== undefined) {
    config.indent_style = style.useTabs ? 'tab' : 'space';
  }
  if (style.num('indentSize') !== undefined) {
    config.indent_width = style.num('indentSize');
  }
  if (style.num('lineLength') !== undefined) {
    config.line_width = style.num('lineLength');
  }
  const quotes = style.str('quoteStyle');
  if (quotes === 'single' || quotes === 'double' || quotes === 'preserve') {
    config.quote_style = quotes;
  }
  if (style.bool('pythonMagicTrailingComma') !== undefined) {
    config.magic_trailing_comma = style.bool('pythonMagicTrailingComma') ? 'respect' : 'ignore';
  }
  if (style.bool('formatDocComments') !== undefined) {
    config.docstring_code = style.bool('formatDocComments');
  }
  return config;
}

export const RUFF_WASM: EngineSpec<RuffModule> = {
  descriptor: bundled(
    ruff.descriptor,
    { id: 'ruff-wasm', displayName: 'Ruff (bundled)', engine: 'Ruff formatter, compiled to WebAssembly (@wasm-fmt/ruff_fmt)', rangeLanguages: [] },
    ['lineLength', 'indentStyle', 'indentSize', 'quoteStyle', 'pythonMagicTrailingComma', 'formatDocComments'],
    [noConfigFile('Ruff', 'ruff.toml or pyproject.toml'), 'Import sorting needs the installed Ruff; the bundled build only formats.'],
  ),
  packageName: '@wasm-fmt/ruff_fmt',
  load: () => importModule<RuffModule>('@wasm-fmt/ruff_fmt'),
  format: (engine, request, style) => engine.format(request.text, request.fileName, ruffConfig(style)),
};

// ───────────────────────────────────────────────────────────── clang-format

interface ClangModule {
  format(content: string, filename?: string, style?: string): string;
  format_line_range(content: string, from: number, to: number, filename?: string, style?: string): string;
  version(): string;
}

const CLANG_FILENAMES: Record<string, string> = { c: 'main.c', cpp: 'main.cpp', csharp: 'main.cs', proto: 'main.proto', java: 'main.java' };

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      line++;
    }
  }
  return line;
}

/**
 * clang-format does not know C# raw string literals ("""...""") or the u8 suffix and rewrites them
 * into code that no longer compiles. They are swapped for ordinary short strings while it runs.
 */
export function protectCsharpLiterals(text: string): { text: string; restore(formatted: string): string } | undefined {
  const hidden: string[] = [];
  let masked = '';
  let copied = 0;
  // Returns the index just after the string that starts at `start`, where `quote` is its first quote.
  const stringEnd = (start: number, quote: number): { end: number; raw: boolean } => {
    const prefix = text.slice(start, quote);
    let quotes = 0;
    while (text[quote + quotes] === '"') {
      quotes++;
    }
    if (!prefix.includes('@') && quotes >= 3) {
      const close = text.indexOf('"'.repeat(quotes), quote + quotes);
      let end = close < 0 ? text.length : close + quotes;
      while (text[end] === '"') {
        end++;
      }
      return { end, raw: true };
    }
    let index = quote + 1;
    let depth = 0;
    while (index < text.length) {
      const char = text[index];
      if (prefix.includes('@')) {
        if (char === '"' && depth === 0) {
          if (text[index + 1] !== '"') {
            return { end: index + 1, raw: false };
          }
          index++;
        }
      } else if (char === '\\') {
        index++;
      } else if (char === '"' && depth === 0) {
        return { end: index + 1, raw: false };
      } else if (char === '\n' && depth === 0) {
        return { end: index, raw: false };
      }
      if (prefix.includes('$')) {
        if (char === '{' && text[index + 1] === '{' && depth === 0) {
          index++;
        } else if (char === '{') {
          depth++;
        } else if (char === '}' && depth > 0) {
          depth--;
        } else if (char === '"' && depth > 0) {
          index = stringEnd(index, index).end - 1;
        }
      }
      index++;
    }
    return { end: text.length, raw: false };
  };
  const opening = /(?:\$+@|@\$+|\$+|@)?"/y;
  for (let index = 0; index < text.length; ) {
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index);
      index = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
    } else if (text[index] === "'") {
      const end = text[index + 1] === '\\' ? text.indexOf("'", index + 3) : text[index + 2] === "'" ? index + 2 : -1;
      index = end < 0 ? index + 1 : end + 1;
    } else {
      opening.lastIndex = index;
      const match = opening.exec(text);
      if (!match) {
        index++;
        continue;
      }
      const found = stringEnd(index, index + match[0].length - 1);
      const suffix = /^u8/i.test(text.slice(found.end, found.end + 2)) ? 2 : 0;
      if (found.raw || suffix > 0) {
        masked += `${text.slice(copied, index)}"${CSHARP_MASK}${hidden.length}__"`;
        hidden.push(text.slice(index, found.end + suffix));
        copied = found.end + suffix;
      }
      index = found.end + suffix;
    }
  }
  if (hidden.length === 0) {
    return undefined;
  }
  masked += text.slice(copied);
  return {
    text: masked,
    restore(formatted) {
      let result = formatted;
      for (const [position, original] of hidden.entries()) {
        const placeholder = `"${CSHARP_MASK}${position}__"`;
        if (result.split(placeholder).length !== 2) {
          throw new FormatterError('failed', 'clang-format could not keep a C# raw string literal intact, so nothing was changed. Install CSharpier for C#.');
        }
        result = result.replace(placeholder, () => original);
      }
      return result;
    },
  };
}
const CSHARP_MASK = '__codeneat_literal_';

export const CLANG_WASM: EngineSpec<ClangModule> = {
  descriptor: bundled(
    clangFormat.descriptor,
    {
      id: 'clang-format-wasm',
      displayName: 'clang-format (bundled)',
      engine: 'clang-format (LLVM), compiled to WebAssembly (@wasm-fmt/clang-format)',
      languages: ['c', 'cpp', 'csharp', 'proto', 'java'],
      extensions: [...clangFormat.descriptor.extensions, '.cs', '.java'],
      rangeLanguages: ['c', 'cpp', 'csharp', 'proto', 'java'],
      options: {
        cppBaseStyle: {
          native: 'BasedOnStyle',
          support: 'full',
          default: 'LLVM',
          languageDefaults: { csharp: 'Microsoft', proto: 'Google', java: 'Google' },
          note: 'For C# the Microsoft base style is used unless you choose another; for Java and Protocol Buffers, Google.',
        },
      },
    },
    Object.keys(clangFormat.descriptor.options).filter((id) => id !== 'cppBaseStyle' && id !== 'lineEndings'),
    [
      noConfigFile('clang-format', '.clang-format'),
      'For C#, newer syntax such as switch expressions, LINQ queries and generic constraints can come out awkwardly laid out (the code still works). Install CSharpier for properly formatted C#.',
    ],
  ),
  packageName: '@wasm-fmt/clang-format',
  load: () => importModule<ClangModule>('@wasm-fmt/clang-format'),
  version: (engine) => /\d+\.\d+\.\d+/.exec(engine.version())?.[0],
  format(engine, request, style) {
    const extension = path.extname(request.fileName).toLowerCase();
    const known = clangFormat.descriptor.extensions.includes(extension) || extension === '.cs' || extension === '.java';
    const filename = known ? `main${extension}` : (CLANG_FILENAMES[request.languageId] ?? 'main.cpp');
    const inline = clangFormatStyle(style);
    // Sorting imports can take clang-format a second run, so it is repeated until nothing changes.
    const settle = (text: string): string => {
      let output = engine.format(text, filename, inline);
      for (let pass = 1; pass < 3; pass++) {
        const again = engine.format(output, filename, inline);
        if (again === output) {
          break;
        }
        output = again;
      }
      return output;
    };
    const literals = request.languageId === 'csharp' && !request.text.includes(CSHARP_MASK) ? protectCsharpLiterals(request.text) : undefined;
    if (literals) {
      if (request.range) {
        throw new FormatterError('unsupported', 'clang-format cannot format only a selection of a C# file that contains raw string literals. Format the whole file instead.');
      }
      return literals.restore(settle(literals.text));
    }
    if (request.range) {
      const from = lineOf(request.text, request.range.start);
      const to = lineOf(request.text, Math.max(request.range.start, request.range.end - 1));
      return engine.format_line_range(request.text, from, to, filename, inline);
    }
    return settle(request.text);
  },
};

// ───────────────────────────────────────────────────────────── StyLua

export interface LuaConfig {
  indent_style?: 'tab' | 'space';
  indent_width?: number;
  line_width?: number;
  quote_style?: 'AutoPreferDouble' | 'AutoPreferSingle';
  call_parentheses?: string;
}

interface LuaModule {
  format(input: string, config?: LuaConfig | null): string;
}

export function luaConfig(style: StyleReader): LuaConfig {
  const config: LuaConfig = {};
  if (style.useTabs !== undefined) {
    config.indent_style = style.useTabs ? 'tab' : 'space';
  }
  if (style.num('indentSize') !== undefined) {
    config.indent_width = style.num('indentSize');
  }
  if (style.num('lineLength') !== undefined) {
    config.line_width = style.num('lineLength');
  }
  const quotes = style.str('quoteStyle');
  if (quotes === 'single' || quotes === 'double') {
    config.quote_style = quotes === 'single' ? 'AutoPreferSingle' : 'AutoPreferDouble';
  }
  if (style.str('luaCallParentheses')) {
    config.call_parentheses = style.str('luaCallParentheses');
  }
  return config;
}

export const STYLUA_WASM: EngineSpec<LuaModule> = {
  descriptor: bundled(
    stylua.descriptor,
    { id: 'stylua-wasm', displayName: 'StyLua (bundled)', engine: 'StyLua, compiled to WebAssembly (@wasm-fmt/lua_fmt)', rangeLanguages: [] },
    ['lineLength', 'indentStyle', 'indentSize', 'quoteStyle', 'luaCallParentheses'],
    [noConfigFile('StyLua', 'stylua.toml')],
  ),
  packageName: '@wasm-fmt/lua_fmt',
  load: () => importModule<LuaModule>('@wasm-fmt/lua_fmt'),
  format: (engine, request, style) => engine.format(request.text, luaConfig(style)),
};

// ───────────────────────────────────────────────────────────── shfmt

export interface ShfmtOptions {
  indent?: number;
  binaryNextLine?: boolean;
  switchCaseIndent?: boolean;
  spaceRedirects?: boolean;
  funcNextLine?: boolean;
}

interface ShfmtModule {
  format(source: string, path?: string, options?: ShfmtOptions): string;
}

export function shfmtOptions(style: StyleReader): ShfmtOptions {
  const options: ShfmtOptions = {};
  if (style.indentChosen) {
    options.indent = style.effectiveUseTabs ? 0 : (style.effectiveNum('indentSize') ?? 4);
  }
  if (style.bool('indentCaseLabels') !== undefined) {
    options.switchCaseIndent = style.bool('indentCaseLabels');
  }
  if (style.str('operatorLinePosition')) {
    options.binaryNextLine = style.str('operatorLinePosition') === 'start';
  }
  if (style.bool('shellSpaceRedirects') !== undefined) {
    options.spaceRedirects = style.bool('shellSpaceRedirects');
  }
  if (style.bool('shellFunctionNextLine') !== undefined) {
    options.funcNextLine = style.bool('shellFunctionNextLine');
  }
  return options;
}

export const SHFMT_WASM: EngineSpec<ShfmtModule> = {
  descriptor: bundled(
    shfmt.descriptor,
    { id: 'shfmt-wasm', displayName: 'shfmt (bundled)', engine: 'shfmt (mvdan/sh), compiled to WebAssembly (@wasm-fmt/shfmt)' },
    ['indentStyle', 'indentSize', 'indentCaseLabels', 'operatorLinePosition', 'shellSpaceRedirects', 'shellFunctionNextLine'],
    ['The shell dialect is detected from the file name and its first line; it cannot be forced in the bundled build.'],
  ),
  packageName: '@wasm-fmt/shfmt',
  load: () => importModule<ShfmtModule>('@wasm-fmt/shfmt'),
  format: (engine, request, style) => engine.format(request.text, request.fileName, shfmtOptions(style)),
};

// ───────────────────────────────────────────────────────────── dart format

interface DartModule {
  format(input: string, filename: string, config?: { line_width?: number }): string;
}

export const DART_WASM: EngineSpec<DartModule> = {
  descriptor: bundled(
    dartFormat.descriptor,
    { id: 'dart-format-wasm', displayName: 'dart format (bundled)', engine: 'dart_style, compiled to WebAssembly (@wasm-fmt/dart_fmt)' },
    ['lineLength'],
    [
      'The bundled build formats with the latest Dart language version and does not read analysis_options.yaml. Install the Dart SDK to have your project settings respected.',
      'Needs a VS Code whose runtime supports WebAssembly garbage collection (all recent versions do).',
    ],
  ),
  packageName: '@wasm-fmt/dart_fmt',
  load: () => importModule<DartModule>('@wasm-fmt/dart_fmt'),
  format: (engine, request, style) =>
    engine.format(request.text, request.fileName.endsWith('.dart') ? request.fileName : 'main.dart', style.num('lineLength') !== undefined ? { line_width: style.num('lineLength') } : {}),
};

// ───────────────────────────────────────────────────────────── dockerfmt

interface DockerfmtModule {
  formatDockerfileContents(contents: string, options: { indent: number; trailingNewline: boolean; spaceRedirects: boolean }): Promise<string | undefined>;
}

export const DOCKERFMT_WASM: EngineSpec<DockerfmtModule> = {
  descriptor: bundled(
    dockerfmt.descriptor,
    { id: 'dockerfmt-wasm', displayName: 'dockerfmt (bundled)', engine: 'dockerfmt, compiled to WebAssembly (@reteps/dockerfmt)' },
    ['indentSize', 'dockerfileSpaceRedirects'],
  ),
  packageName: '@reteps/dockerfmt',
  load: () => importModule<DockerfmtModule>('@reteps/dockerfmt'),
  async format(engine, request, style) {
    // On a syntax error the engine prints a long internal trace to the console and returns nothing.
    // The trace is of no use to the user, so it is kept out of the extension host log.
    const original = { log: console.log, error: console.error };
    let output: string | undefined;
    try {
      console.log = () => undefined;
      console.error = () => undefined;
      output = await engine.formatDockerfileContents(request.text, {
        indent: style.num('indentSize') ?? 4,
        trailingNewline: true,
        spaceRedirects: style.bool('dockerfileSpaceRedirects') ?? false,
      });
    } finally {
      console.log = original.log;
      console.error = original.error;
    }
    if (typeof output !== 'string') {
      throw new FormatterError('failed', 'dockerfmt could not read this Dockerfile (probably a syntax error in a RUN command), so nothing was changed.');
    }
    return keepBracketForm(request.text, output);
  },
};

export function createEngineAdapters(): FormatterAdapter[] {
  return [
    new EngineAdapter(RUFF_WASM),
    new EngineAdapter(GOFMT_WASM),
    new EngineAdapter(CLANG_WASM),
    new EngineAdapter(STYLUA_WASM),
    new EngineAdapter(SHFMT_WASM),
    new EngineAdapter(DART_WASM),
    new EngineAdapter(DOCKERFMT_WASM),
  ];
}
