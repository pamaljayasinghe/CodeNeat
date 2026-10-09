import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
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
import { findFileUpwards } from '../core/executables';
import type { CancellationSignal } from '../core/process';
import type { FormatterDescriptor, FormatterStatus, OptionCapability, StyleOptions } from '../shared/types';
import { isInside } from './external';

type PrettierOptions = Record<string, unknown>;

interface PrettierModule {
  version: string;
  format(source: string, options: PrettierOptions): Promise<string> | string;
  resolveConfig(file: string, options?: PrettierOptions): Promise<PrettierOptions | null>;
  resolveConfigFile(file?: string): Promise<string | null>;
  getFileInfo(file: string, options?: PrettierOptions): Promise<{ ignored: boolean; inferredParser: string | null }>;
  clearConfigCache(): Promise<void> | void;
}

const JS = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'];
const MARKUP = ['html', 'vue', 'angular'];
const STYLES = ['css', 'scss', 'less'];

const CORE_LANGUAGES = [
  ...MARKUP,
  ...STYLES,
  ...JS,
  'json',
  'jsonc',
  'yaml',
  'markdown',
  'mdx',
  'graphql',
];

const PARSERS: Record<string, string> = {
  html: 'html',
  vue: 'vue',
  angular: 'angular',
  css: 'css',
  scss: 'scss',
  less: 'less',
  javascript: 'babel',
  javascriptreact: 'babel',
  typescript: 'typescript',
  typescriptreact: 'typescript',
  json: 'json',
  jsonc: 'jsonc',
  yaml: 'yaml',
  markdown: 'markdown',
  mdx: 'mdx',
  graphql: 'graphql',
  java: 'java',
  xml: 'xml',
  toml: 'toml',
  php: 'php',
  latex: 'latex-parser',
};

const PRETTIER_CONFIG_FILES = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.json5',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.toml',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.ts',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'prettier.config.ts',
  'package.json (prettier key)',
];

const PRETTIER_LICENSE = 'MIT';

const widthNote =
  'Prettier treats this as the width it aims for, not a hard limit. Long strings, URLs and some expressions are never split.';

function common(defaultIndent = 2): Record<string, OptionCapability> {
  return {
    lineLength: { native: 'printWidth', support: 'full', default: 80, note: widthNote },
    indentStyle: { native: 'useTabs', support: 'full', default: 'spaces' },
    indentSize: { native: 'tabWidth', support: 'full', default: defaultIndent },
    lineEndings: { native: 'endOfLine', support: 'full', default: 'lf' },
  };
}

const prettierInstall = {
  summary: 'Prettier is bundled with CodeNeat, so there is nothing to install.',
  commands: [],
  url: 'https://prettier.io/docs/install',
};

export const PRETTIER_DESCRIPTOR: FormatterDescriptor = {
  ...descriptorDefaults(),
  id: 'prettier',
  displayName: 'Prettier',
  kind: 'bundled',
  engine: 'Prettier',
  license: PRETTIER_LICENSE,
  homepage: 'https://prettier.io',
  languages: CORE_LANGUAGES,
  extensions: ['.html', '.htm', '.vue', '.css', '.pcss', '.scss', '.less', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.json', '.jsonc', '.yaml', '.yml', '.md', '.markdown', '.mdx', '.graphql', '.gql'],
  requirement: 'Bundled with CodeNeat. A Prettier installed in your project (node_modules) is used instead when the workspace is trusted.',
  install: prettierInstall,
  options: {
    ...common(),
    indentStyle: {
      native: 'useTabs',
      support: 'full',
      default: 'spaces',
      note: 'YAML does not allow tabs, so YAML files are always indented with spaces.',
    },
    embeddedFormatting: { native: 'embeddedLanguageFormatting', support: 'full', default: 'auto', languages: [...MARKUP, ...JS, 'markdown', 'mdx'] },
    proseWrap: { native: 'proseWrap', support: 'full', default: 'preserve', languages: ['markdown', 'mdx', 'yaml'] },
    objectWrap: { native: 'objectWrap', support: 'full', default: 'preserve', languages: [...JS, ...MARKUP, 'json', 'jsonc', 'mdx'] },
    singleAttributePerLine: { native: 'singleAttributePerLine', support: 'full', default: false, languages: [...MARKUP, ...JS, 'mdx'] },
    operatorLinePosition: {
      native: 'experimentalOperatorPosition',
      support: 'partial',
      default: 'end',
      languages: [...JS, 'vue'],
      note: 'Prettier marks this option as experimental; its behaviour may change between Prettier versions.',
    },
    indentScriptAndStyle: { native: 'vueIndentScriptAndStyle', support: 'full', default: false, languages: ['vue'] },
    htmlWhitespace: { native: 'htmlWhitespaceSensitivity', support: 'full', default: 'css', languages: MARKUP },
    bracketSpacing: { native: 'bracketSpacing', support: 'full', default: true, languages: [...JS, ...MARKUP, 'json', 'jsonc', 'yaml', 'graphql', 'mdx'] },
    bracketSameLine: { native: 'bracketSameLine', support: 'full', default: false, languages: [...MARKUP, ...JS, 'mdx'] },
    arrowParens: { native: 'arrowParens', support: 'full', default: 'always', languages: [...JS, ...MARKUP, 'mdx'] },
    quoteStyle: {
      native: 'singleQuote',
      support: 'full',
      default: 'double',
      values: ['double', 'single'],
      languages: [...JS, ...MARKUP, ...STYLES, 'yaml', 'mdx'],
      note: 'Prettier always normalises quotes; it cannot keep them as written. It uses the other quote when that needs fewer escapes.',
    },
    jsxQuoteStyle: { native: 'jsxSingleQuote', support: 'full', default: 'double', languages: [...JS, 'mdx'] },
    quoteProps: { native: 'quoteProps', support: 'full', default: 'as-needed', languages: [...JS, 'vue'] },
    semicolons: { native: 'semi', support: 'full', default: 'always', languages: [...JS, ...MARKUP, 'mdx'] },
    trailingCommas: { native: 'trailingComma', support: 'full', default: 'all', languages: [...JS, ...MARKUP, 'mdx'] },
    experimentalTernaries: { native: 'experimentalTernaries', support: 'partial', default: false, languages: [...JS, 'vue'], note: 'Experimental in Prettier.' },
  },
  lineLength: 'preferred',
  lineLengthNote: widthNote,
  rangeLanguages: [...JS, ...STYLES, 'graphql', 'json', 'jsonc'],
  cancellation: 'discard-result',
  configFiles: PRETTIER_CONFIG_FILES,
  limitations: [
    'Brace position, spacing around operators and blank lines between members are fixed by Prettier and cannot be configured.',
    'Quotes cannot be preserved as written.',
    'Imports are never sorted or removed.',
    'Angular templates are detected from the ".component.html" file name or the Angular language id.',
  ],
};

export const PRETTIER_JAVA_DESCRIPTOR: FormatterDescriptor = {
  ...descriptorDefaults(),
  id: 'prettier-java',
  displayName: 'Prettier for Java',
  kind: 'bundled',
  engine: 'prettier-plugin-java (Prettier)',
  license: 'Apache-2.0',
  homepage: 'https://github.com/jhipster/prettier-java',
  languages: ['java'],
  extensions: ['.java'],
  requirement: 'Bundled with CodeNeat.',
  install: { ...prettierInstall, summary: 'The Java plugin for Prettier is bundled with CodeNeat.', url: 'https://github.com/jhipster/prettier-java' },
  options: {
    ...common(),
    arrowParens: { native: 'arrowParens', support: 'full', default: 'avoid', note: 'Applies to lambda parameters.' },
    trailingCommas: {
      native: 'trailingComma',
      support: 'full',
      default: 'all',
      note: 'Applies to enum constants and array initialisers.',
    },
    operatorLinePosition: { native: 'experimentalOperatorPosition', support: 'partial', default: 'end', note: 'Experimental.' },
  },
  fixed: {
    sortImports: { value: true, reason: 'The Java plugin for Prettier always sorts import statements. It never adds or removes one.' },
    braceStyle: { value: 'attach', reason: 'The Java plugin for Prettier always keeps the opening brace on the same line.' },
  },
  lineLength: 'preferred',
  lineLengthNote: widthNote,
  cancellation: 'discard-result',
  configFiles: PRETTIER_CONFIG_FILES,
  limitations: [
    'Import statements are always sorted (this cannot be switched off). Unused imports are never removed.',
    'Brace position is always "same line".',
  ],
};

export const PRETTIER_XML_DESCRIPTOR: FormatterDescriptor = {
  ...descriptorDefaults(),
  id: 'prettier-xml',
  displayName: 'Prettier for XML',
  kind: 'bundled',
  engine: '@prettier/plugin-xml (Prettier)',
  license: 'MIT',
  homepage: 'https://github.com/prettier/plugin-xml',
  languages: ['xml'],
  extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg', '.plist', '.wsdl'],
  requirement: 'Bundled with CodeNeat.',
  install: { ...prettierInstall, summary: 'The XML plugin for Prettier is bundled with CodeNeat.', url: 'https://github.com/prettier/plugin-xml' },
  options: {
    ...common(),
    bracketSameLine: { native: 'bracketSameLine', support: 'full', default: false },
    singleAttributePerLine: { native: 'singleAttributePerLine', support: 'full', default: false },
    quoteStyle: { native: 'xmlQuoteAttributes', support: 'full', default: 'preserve', note: 'Applies to attribute values.' },
    xmlWhitespace: {
      native: 'xmlWhitespaceSensitivity',
      support: 'full',
      default: 'strict',
      note: 'With the default "Meaningful" setting the formatter changes very little, because whitespace in XML can be data.',
    },
    xmlSelfClosingSpace: { native: 'xmlSelfClosingSpace', support: 'full', default: true },
    xmlSortAttributes: { native: 'xmlSortAttributesByKey', support: 'full', default: false },
  },
  lineLength: 'preferred',
  lineLengthNote: widthNote,
  cancellation: 'discard-result',
  configFiles: PRETTIER_CONFIG_FILES,
  limitations: ['Whitespace inside elements is treated as meaningful unless you change "XML: Whitespace in Text".'],
};

export const PRETTIER_TOML_DESCRIPTOR: FormatterDescriptor = {
  ...descriptorDefaults(),
  id: 'prettier-toml',
  displayName: 'Taplo (bundled)',
  kind: 'bundled',
  engine: 'Taplo, through prettier-plugin-toml',
  license: 'MIT',
  homepage: 'https://github.com/un-ts/prettier/tree/master/packages/toml',
  languages: ['toml'],
  extensions: ['.toml'],
  requirement: 'Bundled with CodeNeat.',
  install: { ...prettierInstall, summary: 'The TOML formatter is bundled with CodeNeat.', url: 'https://taplo.tamasfe.dev' },
  options: {
    ...common(),
    lineLength: { native: 'printWidth (column_width)', support: 'full', default: 80, note: 'Arrays longer than this width are expanded onto several lines.' },
    maxBlankLines: { native: 'allowedBlankLines', support: 'full', default: 1 },
    tomlAlignEntries: { native: 'alignEntries', support: 'full', default: false },
    tomlReorderKeys: { native: 'reorderKeys', support: 'full', default: false },
  },
  lineLength: 'preferred',
  cancellation: 'discard-result',
  configFiles: PRETTIER_CONFIG_FILES,
  limitations: [
    'Indentation only affects multi-line arrays; TOML tables are not indented.',
    'Taplo is error-tolerant: a file with a TOML syntax error is tidied where possible instead of being rejected.',
  ],
};

export const PRETTIER_PHP_DESCRIPTOR: FormatterDescriptor = {
  ...descriptorDefaults(),
  id: 'prettier-php',
  displayName: 'Prettier for PHP',
  kind: 'bundled',
  engine: '@prettier/plugin-php (Prettier)',
  license: 'MIT',
  homepage: 'https://github.com/prettier/plugin-php',
  languages: ['php'],
  extensions: ['.php'],
  requirement: 'Bundled with CodeNeat.',
  install: { ...prettierInstall, summary: 'The PHP plugin for Prettier is bundled with CodeNeat.', url: 'https://github.com/prettier/plugin-php' },
  options: {
    ...common(4),
    quoteStyle: { native: 'singleQuote', support: 'full', default: 'double', values: ['double', 'single'] },
    trailingCommas: {
      native: 'trailingCommaPHP',
      support: 'partial',
      default: 'all',
      values: ['all', 'none'],
      note: 'PHP only distinguishes "wherever possible" and "never".',
    },
  },
  lineLength: 'preferred',
  lineLengthNote: widthNote,
  cancellation: 'discard-result',
  configFiles: PRETTIER_CONFIG_FILES,
  limitations: [
    'Follows the PER Coding Style brace layout; brace position cannot be changed.',
    'Imports are never sorted or removed. Use PHP-CS-Fixer for that.',
  ],
};

export const PRETTIER_LATEX_DESCRIPTOR: FormatterDescriptor = {
  ...descriptorDefaults(),
  id: 'prettier-latex',
  displayName: 'Prettier for LaTeX',
  kind: 'bundled',
  engine: 'prettier-plugin-latex (unified-latex, Prettier)',
  license: 'MIT',
  homepage: 'https://github.com/siefkenj/prettier-plugin-latex',
  languages: ['latex'],
  extensions: ['.tex', '.sty', '.cls'],
  requirement: 'Bundled with CodeNeat.',
  install: { ...prettierInstall, summary: 'The LaTeX plugin for Prettier is bundled with CodeNeat.', url: 'https://github.com/siefkenj/prettier-plugin-latex' },
  options: {
    ...common(2),
    indentStyle: { native: 'useTabs', support: 'full', default: 'tabs' },
    lineLength: { native: 'printWidth', support: 'full', default: 80, note: 'Paragraph text is re-wrapped to this width.' },
  },
  lineLength: 'preferred',
  lineLengthNote: 'Paragraph text is re-wrapped to the line length. Verbatim blocks are left untouched.',
  cancellation: 'discard-result',
  configFiles: PRETTIER_CONFIG_FILES,
  limitations: [
    'This formatter re-wraps paragraphs, puts a blank line between list items and writes x^2 as x^{2}. These are equivalent in LaTeX, but the source changes more than with latexindent, which only adjusts indentation.',
    'Documents that redefine category codes or use unusual macro syntax may not be understood. Preview before applying.',
  ],
};

/** Converts resolved CodeNeat style values into Prettier options. */
export function toPrettierOptions(style: StyleOptions, descriptorId: string): PrettierOptions {
  const reader = new StyleReader(style);
  const options: PrettierOptions = {};
  const set = (key: string, value: unknown): void => {
    if (value !== undefined) {
      options[key] = value;
    }
  };
  set('printWidth', reader.num('lineLength'));
  set('tabWidth', reader.num('indentSize'));
  set('useTabs', reader.useTabs);
  set('endOfLine', reader.str('lineEndings'));
  set('embeddedLanguageFormatting', reader.str('embeddedFormatting'));
  set('proseWrap', reader.str('proseWrap'));
  set('objectWrap', reader.str('objectWrap'));
  set('singleAttributePerLine', reader.bool('singleAttributePerLine'));
  set('experimentalOperatorPosition', reader.str('operatorLinePosition'));
  set('vueIndentScriptAndStyle', reader.bool('indentScriptAndStyle'));
  set('htmlWhitespaceSensitivity', reader.str('htmlWhitespace'));
  set('bracketSpacing', reader.bool('bracketSpacing'));
  set('bracketSameLine', reader.bool('bracketSameLine'));
  set('arrowParens', reader.str('arrowParens'));
  set('quoteProps', reader.str('quoteProps'));
  set('trailingComma', reader.str('trailingCommas'));
  set('experimentalTernaries', reader.bool('experimentalTernaries'));
  const quotes = reader.str('quoteStyle');
  if (descriptorId === 'prettier-xml') {
    set('xmlQuoteAttributes', quotes);
    set('xmlWhitespaceSensitivity', reader.str('xmlWhitespace'));
    set('xmlSelfClosingSpace', reader.bool('xmlSelfClosingSpace'));
    set('xmlSortAttributesByKey', reader.bool('xmlSortAttributes'));
  } else if (quotes === 'single' || quotes === 'double') {
    set('singleQuote', quotes === 'single');
  }
  const jsxQuotes = reader.str('jsxQuoteStyle');
  if (jsxQuotes) {
    set('jsxSingleQuote', jsxQuotes === 'single');
  }
  const semicolons = reader.str('semicolons');
  if (semicolons) {
    set('semi', semicolons === 'always');
  }
  if (descriptorId === 'prettier-php') {
    delete options.trailingComma;
    const commas = reader.str('trailingCommas');
    if (commas) {
      set('trailingCommaPHP', commas !== 'none');
    }
  }
  if (descriptorId === 'prettier-toml') {
    set('allowedBlankLines', reader.num('maxBlankLines'));
    set('alignEntries', reader.bool('tomlAlignEntries'));
    set('reorderKeys', reader.bool('tomlReorderKeys'));
  }
  return options;
}

/** Converts a resolved Prettier configuration (from .prettierrc) into CodeNeat style values. */
export function fromPrettierConfig(config: PrettierOptions, descriptorId: string): StyleOptions {
  const style: StyleOptions = {};
  const copy = (key: string, id: string, type: 'number' | 'string' | 'boolean'): void => {
    const value = config[key];
    if (typeof value === type) {
      style[id] = value as string | number | boolean;
    }
  };
  copy('printWidth', 'lineLength', 'number');
  copy('tabWidth', 'indentSize', 'number');
  if (typeof config.useTabs === 'boolean') {
    style.indentStyle = config.useTabs ? 'tabs' : 'spaces';
  }
  if (config.endOfLine === 'lf' || config.endOfLine === 'crlf' || config.endOfLine === 'auto') {
    style.lineEndings = config.endOfLine;
  }
  copy('embeddedLanguageFormatting', 'embeddedFormatting', 'string');
  copy('proseWrap', 'proseWrap', 'string');
  copy('objectWrap', 'objectWrap', 'string');
  copy('singleAttributePerLine', 'singleAttributePerLine', 'boolean');
  copy('experimentalOperatorPosition', 'operatorLinePosition', 'string');
  copy('vueIndentScriptAndStyle', 'indentScriptAndStyle', 'boolean');
  copy('htmlWhitespaceSensitivity', 'htmlWhitespace', 'string');
  copy('bracketSpacing', 'bracketSpacing', 'boolean');
  copy('bracketSameLine', 'bracketSameLine', 'boolean');
  copy('arrowParens', 'arrowParens', 'string');
  copy('quoteProps', 'quoteProps', 'string');
  copy('trailingComma', 'trailingCommas', 'string');
  copy('experimentalTernaries', 'experimentalTernaries', 'boolean');
  if (descriptorId === 'prettier-xml') {
    copy('xmlQuoteAttributes', 'quoteStyle', 'string');
    copy('xmlWhitespaceSensitivity', 'xmlWhitespace', 'string');
    copy('xmlSelfClosingSpace', 'xmlSelfClosingSpace', 'boolean');
    copy('xmlSortAttributesByKey', 'xmlSortAttributes', 'boolean');
  } else if (typeof config.singleQuote === 'boolean') {
    style.quoteStyle = config.singleQuote ? 'single' : 'double';
  }
  if (typeof config.jsxSingleQuote === 'boolean') {
    style.jsxQuoteStyle = config.jsxSingleQuote ? 'single' : 'double';
  }
  if (typeof config.semi === 'boolean') {
    style.semicolons = config.semi ? 'always' : 'never';
  }
  if (descriptorId === 'prettier-toml') {
    copy('allowedBlankLines', 'maxBlankLines', 'number');
    copy('alignEntries', 'tomlAlignEntries', 'boolean');
    copy('reorderKeys', 'tomlReorderKeys', 'boolean');
  }
  return style;
}

const JSON_STRINGIFY_FILES = new Set(['package.json', 'package-lock.json', 'composer.json']);

export function parserFor(languageId: string, fileName: string): string | undefined {
  if (languageId === 'json' && JSON_STRINGIFY_FILES.has(path.basename(fileName))) {
    return 'json-stringify';
  }
  return PARSERS[languageId];
}

type PluginLoader = () => Promise<unknown[]>;

interface LoadedPrettier {
  module: PrettierModule;
  origin: 'bundled' | 'project';
  location: string;
}

// Kept as a real dynamic import in the CommonJS bundle so ESM-only plugins can be loaded.
const importModule = (specifier: string): Promise<{ default?: unknown } & Record<string, unknown>> => import(specifier);

function loadBundledPrettier(): PrettierModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('prettier') as PrettierModule;
}

/** In-process adapter for Prettier and its bundled plugins. */
export class PrettierAdapter implements FormatterAdapter {
  private plugins?: Promise<unknown[]>;
  private readonly projectModules = new Map<string, PrettierModule | null>();

  constructor(
    readonly descriptor: FormatterDescriptor,
    private readonly pluginLoader?: PluginLoader,
  ) {}

  reset(): void {
    this.projectModules.clear();
    void Promise.resolve(loadBundledPrettier().clearConfigCache()).catch(() => undefined);
  }

  private loadPlugins(): Promise<unknown[]> {
    if (!this.pluginLoader) {
      return Promise.resolve([]);
    }
    this.plugins ??= this.pluginLoader();
    return this.plugins;
  }

  /**
   * Finds a Prettier 3 installed in the project. Only attempted in trusted workspaces because
   * loading it executes code from the project. Plugin-based descriptors always use the bundled
   * Prettier so that the bundled plugin is guaranteed to be compatible.
   */
  private async loadPrettier(env: AdapterEnvironment, nearDir?: string, workspaceRoot?: string): Promise<LoadedPrettier> {
    const bundled = loadBundledPrettier();
    const bundledResult: LoadedPrettier = { module: bundled, origin: 'bundled', location: 'bundled with CodeNeat' };
    if (!env.trusted || this.pluginLoader || !nearDir) {
      return bundledResult;
    }
    const stop = workspaceRoot && isInside(workspaceRoot, nearDir) ? workspaceRoot : nearDir;
    const packageFile = await findFileUpwards(nearDir, [path.join('node_modules', 'prettier', 'package.json')], stop);
    if (!packageFile) {
      return bundledResult;
    }
    const directory = path.dirname(packageFile);
    if (!this.projectModules.has(directory)) {
      let loaded: PrettierModule | null = null;
      try {
        const candidate = createRequire(packageFile)(directory) as PrettierModule;
        if (typeof candidate?.format === 'function' && typeof candidate.version === 'string' && /^3\./.test(candidate.version)) {
          loaded = candidate;
        } else {
          env.log(`prettier: ignoring project installation ${candidate?.version ?? '(unknown version)'} at ${directory}; Prettier 3 is required.`);
        }
      } catch (error) {
        env.log(`prettier: could not load project installation at ${directory}: ${String(error)}`);
      }
      this.projectModules.set(directory, loaded);
    }
    const projectModule = this.projectModules.get(directory);
    return projectModule ? { module: projectModule, origin: 'project', location: directory } : bundledResult;
  }

  async detect(env: AdapterEnvironment, nearDir?: string): Promise<FormatterStatus> {
    try {
      const workspaceRoot = nearDir ? env.workspaceRoots.find((root) => isInside(root, nearDir)) : undefined;
      const loaded = await this.loadPrettier(env, nearDir ?? env.workspaceRoots[0], workspaceRoot ?? env.workspaceRoots[0]);
      await this.loadPlugins();
      return {
        id: this.descriptor.id,
        available: true,
        version: loaded.module.version,
        path: loaded.location,
        origin: loaded.origin,
      };
    } catch (error) {
      return {
        id: this.descriptor.id,
        available: false,
        problem: `The bundled formatter could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async readProjectConfig(filePath: string, workspaceRoot: string | undefined, env: AdapterEnvironment): Promise<ProjectConfigInfo> {
    if (!env.trusted) {
      return NO_PROJECT_CONFIG;
    }
    try {
      const prettier = loadBundledPrettier();
      const file = await prettier.resolveConfigFile(filePath);
      if (!file || (workspaceRoot && !isInside(workspaceRoot, file))) {
        return NO_PROJECT_CONFIG;
      }
      const config = await prettier.resolveConfig(filePath, { editorconfig: false, useCache: false });
      return { style: fromPrettierConfig(config ?? {}, this.descriptor.id), file, takesOver: false };
    } catch (error) {
      env.log(`prettier: could not read project configuration for ${filePath}: ${String(error)}`);
      return NO_PROJECT_CONFIG;
    }
  }

  async format(request: FormatRequest, env: AdapterEnvironment, token: CancellationSignal): Promise<string> {
    const parser = parserFor(request.languageId, request.fileName);
    if (!parser) {
      throw new FormatterError('unsupported', `${this.descriptor.displayName} does not support this language.`);
    }
    if (request.range && !this.descriptor.rangeLanguages.includes(request.languageId)) {
      throw new FormatterError('unsupported', `${this.descriptor.displayName} cannot format only a selection of this language.`);
    }

    const nearDir = request.filePath ? path.dirname(request.filePath) : request.workspaceRoot;
    const { module: prettier } = await this.loadPrettier(env, nearDir, request.workspaceRoot);
    const options: PrettierOptions = { ...toPrettierOptions(StyleReader.of(request).explicitValues(), this.descriptor.id) };
    const plugins: unknown[] = [...(await this.loadPlugins())];

    const mayUseProject = request.useProjectConfig && env.trusted && !!request.filePath;
    if (mayUseProject && request.filePath) {
      const configFile = await prettier.resolveConfigFile(request.filePath).catch(() => null);
      const inWorkspace = configFile && (!request.workspaceRoot || isInside(request.workspaceRoot, configFile));
      if (configFile && inWorkspace) {
        const projectConfig = (await prettier.resolveConfig(request.filePath, { editorconfig: false, useCache: false })) ?? {};
        for (const [key, value] of Object.entries(projectConfig)) {
          if (key === 'plugins') {
            plugins.push(...(await resolveProjectPlugins(value, configFile, env)));
          } else if (key !== 'parser' && key !== 'filepath' && key !== 'rangeStart' && key !== 'rangeEnd') {
            options[key] = value;
          }
        }
      }
      const ignoreFile = await findFileUpwards(path.dirname(request.filePath), ['.prettierignore'], request.workspaceRoot);
      if (ignoreFile) {
        const info = await prettier.getFileInfo(request.filePath, { ignorePath: ignoreFile, resolveConfig: false });
        if (info.ignored) {
          throw new FormatterError('ignored', `This file is listed in ${path.basename(ignoreFile)}, so it was not formatted.`);
        }
      }
    }

    options.parser = parser;
    if (request.filePath) {
      options.filepath = request.filePath;
    }
    if (plugins.length > 0) {
      options.plugins = plugins;
    }
    if (request.range) {
      options.rangeStart = request.range.start;
      options.rangeEnd = request.range.end;
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new FormatterError('timeout', `${this.descriptor.displayName} did not finish within ${Math.round(request.timeoutMs / 1000)} seconds.`)),
        request.timeoutMs,
      );
    });
    try {
      const formatted = await Promise.race([Promise.resolve(prettier.format(request.text, options)), timeout]);
      if (token.isCancellationRequested) {
        throw new FormatterError('cancelled', 'Formatting was cancelled.');
      }
      // The LaTeX plugin drops the final line break after some environments; files keep theirs.
      if (this.descriptor.id === 'prettier-latex' && formatted.length > 0 && !formatted.endsWith('\n')) {
        return `${formatted}\n`;
      }
      return formatted;
    } catch (error) {
      if (error instanceof FormatterError) {
        throw error;
      }
      throw new FormatterError('failed', describePrettierError(error, this.descriptor.displayName), error instanceof Error ? error.stack : undefined);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function resolveProjectPlugins(value: unknown, configFile: string, env: AdapterEnvironment): Promise<unknown[]> {
  if (!Array.isArray(value)) {
    return [];
  }
  const resolved: unknown[] = [];
  const projectRequire = createRequire(configFile);
  for (const plugin of value) {
    if (typeof plugin !== 'string') {
      resolved.push(plugin);
      continue;
    }
    try {
      const target = plugin.startsWith('.') ? path.resolve(path.dirname(configFile), plugin) : projectRequire.resolve(plugin);
      if (fs.existsSync(target)) {
        const loaded = await importModule(pathToFileURL(target).href);
        resolved.push(loaded.default ?? loaded);
      }
    } catch (error) {
      env.log(`prettier: could not load project plugin "${plugin}": ${String(error)}`);
    }
  }
  return resolved;
}

function describePrettierError(error: unknown, name: string): string {
  if (!(error instanceof Error)) {
    return `${name} failed: ${String(error)}`;
  }
  const firstLine = error.message.split('\n')[0];
  if (error.name === 'SyntaxError' || /SyntaxError|Unexpected|expected/i.test(error.message)) {
    return `${name} could not read this file because of a syntax error, so nothing was changed:\n${firstLine}`;
  }
  return `${name} failed: ${firstLine}`;
}

export function createPrettierAdapters(): FormatterAdapter[] {
  return [
    new PrettierAdapter(PRETTIER_DESCRIPTOR),
    new PrettierAdapter(PRETTIER_JAVA_DESCRIPTOR, async () => [(await importModule('prettier-plugin-java')).default]),
    new PrettierAdapter(PRETTIER_XML_DESCRIPTOR, async () => [(await importModule('@prettier/plugin-xml')).default]),
    new PrettierAdapter(PRETTIER_PHP_DESCRIPTOR, async () => {
      const loaded = await importModule('@prettier/plugin-php');
      return [loaded.default ?? loaded];
    }),
    new PrettierAdapter(PRETTIER_LATEX_DESCRIPTOR, async () => {
      const loaded = await importModule('prettier-plugin-latex');
      return [loaded.default ?? loaded];
    }),
    new PrettierAdapter(PRETTIER_TOML_DESCRIPTOR, async () => {
      const loaded = await importModule('prettier-plugin-toml');
      return [loaded.default ?? loaded];
    }),
  ];
}
