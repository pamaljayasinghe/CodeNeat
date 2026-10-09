import { CustomAdapter } from '../adapters/custom';
import { ExternalAdapter } from '../adapters/external';
import { createPrettierAdapters } from '../adapters/prettier';
import { SqlFormatterAdapter } from '../adapters/sqlFormatter';
import { createEngineAdapters } from '../adapters/wasm';
import { buf, dockerfmt, latexindent, sqlfluff, taplo, terraformFmt } from '../adapters/tools/data';
import { csharpier, fantomas } from '../adapters/tools/dotnet';
import { googleJavaFormat, ktfmt, ktlint, scalafmt } from '../adapters/tools/jvm';
import { dartFormat, swiftFormat } from '../adapters/tools/mobile';
import { black, ruff } from '../adapters/tools/python';
import { air, phpCsFixer, psScriptAnalyzer, rubocop, shfmt, styler, stylua } from '../adapters/tools/scripting';
import { clangFormat, gofmt, rustfmt } from '../adapters/tools/systems';
import { detectLanguage, LANGUAGES } from '../shared/languages';
import type { CustomFormatterConfig, FormatterDescriptor, FormatterStatus, LanguageDefinition } from '../shared/types';
import type { AdapterEnvironment, FormatterAdapter } from './adapter';

export const EXTERNAL_SPECS = [
  googleJavaFormat,
  ruff,
  black,
  clangFormat,
  csharpier,
  fantomas,
  phpCsFixer,
  rubocop,
  gofmt,
  rustfmt,
  ktfmt,
  ktlint,
  scalafmt,
  swiftFormat,
  dartFormat,
  shfmt,
  psScriptAnalyzer,
  stylua,
  air,
  styler,
  sqlfluff,
  taplo,
  dockerfmt,
  terraformFmt,
  buf,
  latexindent,
];

export function createBuiltinAdapters(): FormatterAdapter[] {
  return [...createPrettierAdapters(), new SqlFormatterAdapter(), ...createEngineAdapters(), ...EXTERNAL_SPECS.map((spec) => new ExternalAdapter(spec))];
}

/** Holds every formatter adapter and the languages they serve. */
export class FormatterRegistry {
  private readonly builtin: FormatterAdapter[];
  private custom: CustomAdapter[] = [];
  private languageList: LanguageDefinition[] = LANGUAGES;
  private readonly statusCache = new Map<string, FormatterStatus>();

  constructor(builtin: FormatterAdapter[] = createBuiltinAdapters()) {
    this.builtin = builtin;
  }

  get adapters(): FormatterAdapter[] {
    return [...this.builtin, ...this.custom];
  }

  get descriptors(): FormatterDescriptor[] {
    return this.adapters.map((adapter) => adapter.descriptor);
  }

  get languages(): LanguageDefinition[] {
    return this.languageList;
  }

  get builtinIds(): string[] {
    return this.builtin.map((adapter) => adapter.descriptor.id);
  }

  get(id: string): FormatterAdapter | undefined {
    return this.adapters.find((adapter) => adapter.descriptor.id === id);
  }

  getLanguage(id: string): LanguageDefinition | undefined {
    return this.languageList.find((language) => language.id === id);
  }

  detectLanguage(vscodeLanguageId: string, fileName: string): LanguageDefinition | undefined {
    return detectLanguage(vscodeLanguageId, fileName, this.languageList);
  }

  /** Replaces the user-defined formatters. Unknown languages they mention become selectable. */
  setCustomFormatters(configs: CustomFormatterConfig[]): void {
    this.custom = configs.map((config) => new CustomAdapter(config));
    const languages = LANGUAGES.map((language) => ({ ...language, formatters: [...language.formatters] }));
    for (const config of configs) {
      for (const languageId of config.languages) {
        let language = languages.find((candidate) => candidate.id === languageId || candidate.vscodeIds.includes(languageId));
        if (!language) {
          language = {
            id: languageId,
            label: languageId,
            group: 'Scripting and data',
            vscodeIds: [languageId],
            extensions: [],
            highlight: 'plaintext',
            formatters: [],
          };
          languages.push(language);
        }
        if (!language.formatters.includes(config.id)) {
          language.formatters.push(config.id);
        }
        for (const extension of config.extensions ?? []) {
          if (!languages.some((candidate) => candidate.extensions.includes(extension))) {
            language.extensions.push(extension);
          }
        }
      }
    }
    this.languageList = languages;
    for (const id of [...this.statusCache.keys()]) {
      if (!this.get(id)) {
        this.statusCache.delete(id);
      }
    }
  }

  /** Last known status of every formatter (empty until `detectAll` has run). */
  get statuses(): Record<string, FormatterStatus> {
    return Object.fromEntries(this.statusCache);
  }

  async detect(id: string, env: AdapterEnvironment, nearDir?: string): Promise<FormatterStatus> {
    const adapter = this.get(id);
    if (!adapter) {
      return { id, available: false, problem: `Unknown formatter "${id}".` };
    }
    const status = await adapter.detect(env, nearDir).catch(
      (error): FormatterStatus => ({ id, available: false, problem: error instanceof Error ? error.message : String(error) }),
    );
    if (!nearDir || !this.statusCache.has(id) || status.available) {
      this.statusCache.set(id, status);
    }
    return status;
  }

  async detectAll(env: AdapterEnvironment): Promise<Record<string, FormatterStatus>> {
    await Promise.all(this.adapters.map((adapter) => this.detect(adapter.descriptor.id, env)));
    return this.statuses;
  }

  /** Forgets cached detection results, e.g. after the user installed a tool. */
  reset(): void {
    this.statusCache.clear();
    for (const adapter of this.adapters) {
      adapter.reset();
    }
  }
}
