import * as path from 'node:path';
import { chooseFormatter, resolveStyle, type ResolvedStyle } from '../shared/resolve';
import type {
  FormatterDescriptor,
  FormatterStatus,
  LanguageDefinition,
  ProfileDefinition,
  ProjectOverrides,
  SettingsLayer,
} from '../shared/types';
import { type AdapterEnvironment, type FormatterAdapter, FormatterError } from './adapter';
import { EOL_BY_CODENEAT, normalizeEol, targetEol } from './eol';
import { type CancellationSignal, NEVER_CANCELLED } from './process';
import { NO_OVERRIDES, readProjectOverrides } from './projectConfig';
import type { FormatterRegistry } from './registry';

export interface DocumentInput {
  text: string;
  /** CodeNeat language id. */
  languageId: string;
  fileName: string;
  /** Absolute path when the document is a file on disk. */
  filePath?: string;
  workspaceRoot?: string;
  range?: { start: number; end: number };
}

/** The slice of CodeNeat settings that influences formatting. */
export interface FormattingSettings {
  user: SettingsLayer;
  workspace: SettingsLayer;
  profiles: Record<string, ProfileDefinition>;
  respectProjectConfig: boolean;
  timeoutMs: number;
  maxFileSizeKB: number;
}

export interface FormattingPlan {
  language: LanguageDefinition;
  adapter: FormatterAdapter;
  descriptor: FormatterDescriptor;
  status: FormatterStatus;
  explicitChoice: boolean;
  project: ProjectOverrides;
  resolved: ResolvedStyle;
}

export interface FormattingResult {
  text: string;
  changed: boolean;
  formatterId: string;
  formatterName: string;
  durationMs: number;
  plan: FormattingPlan;
}

/** Orchestrates one formatting run: pick the formatter, resolve the style, run the engine. */
export class FormattingService {
  constructor(
    private readonly registry: FormatterRegistry,
    private readonly environment: () => AdapterEnvironment,
  ) {}

  /** Works out which formatter and which style apply to a document, without formatting it. */
  async plan(input: Omit<DocumentInput, 'text'>, settings: FormattingSettings, formatterId?: string): Promise<FormattingPlan> {
    const env = this.environment();
    const language = this.registry.getLanguage(input.languageId);
    if (!language) {
      throw new FormatterError('unsupported', `CodeNeat does not have a formatter for "${input.languageId}" files.`);
    }
    const nearDir = input.filePath ? path.dirname(input.filePath) : input.workspaceRoot;

    let adapter: FormatterAdapter | undefined;
    let explicitChoice = false;
    if (formatterId) {
      adapter = this.registry.get(formatterId);
      explicitChoice = true;
      if (!adapter || !adapter.descriptor.languages.includes(language.id)) {
        throw new FormatterError('unsupported', `The formatter "${formatterId}" cannot format ${language.label}.`);
      }
    } else {
      const candidates = this.registry.descriptors.filter((descriptor) => descriptor.languages.includes(language.id));
      const statuses: Record<string, FormatterStatus> = {};
      await Promise.all(
        candidates.map(async (candidate) => {
          statuses[candidate.id] = await this.registry.detect(candidate.id, env, nearDir);
        }),
      );
      const choice = chooseFormatter(language, this.registry.descriptors, statuses, settings.user, settings.workspace);
      explicitChoice = choice.explicit;
      adapter = choice.formatter ? this.registry.get(choice.formatter.id) : undefined;
    }
    if (!adapter) {
      throw new FormatterError('unsupported', `CodeNeat does not have a formatter for ${language.label}.`);
    }

    const status = await this.registry.detect(adapter.descriptor.id, env, nearDir);
    const useProject = settings.respectProjectConfig && env.trusted;
    const project = useProject ? await readProjectOverrides(adapter, input.filePath, input.workspaceRoot, env) : NO_OVERRIDES;
    const resolved = resolveStyle({
      languageId: language.id,
      formatter: adapter.descriptor,
      user: settings.user,
      workspace: settings.workspace,
      profiles: settings.profiles,
      project,
      respectProjectConfig: useProject,
    });
    return { language, adapter, descriptor: adapter.descriptor, status, explicitChoice, project, resolved };
  }

  async format(
    input: DocumentInput,
    settings: FormattingSettings,
    token: CancellationSignal = NEVER_CANCELLED,
    formatterId?: string,
  ): Promise<FormattingResult> {
    const env = this.environment();
    const sizeKB = Buffer.byteLength(input.text, 'utf8') / 1024;
    if (sizeKB > settings.maxFileSizeKB) {
      throw new FormatterError(
        'too-large',
        `This file is ${Math.round(sizeKB)} KB, which is over the ${settings.maxFileSizeKB} KB limit for formatting. You can raise the limit under Advanced.`,
      );
    }

    const plan = await this.plan(input, settings, formatterId);
    const { adapter, descriptor, resolved } = plan;
    if (input.range && !descriptor.rangeLanguages.includes(plan.language.id)) {
      throw new FormatterError('unsupported', `${descriptor.displayName} cannot format only a selection of ${plan.language.label}.`);
    }
    if (token.isCancellationRequested) {
      throw new FormatterError('cancelled', 'Formatting was cancelled.');
    }

    const started = Date.now();
    let output: string;
    try {
      output = await adapter.format(
        {
          text: input.text,
          languageId: plan.language.id,
          filePath: input.filePath,
          fileName: input.fileName,
          workspaceRoot: input.workspaceRoot,
          style: resolved.values,
          explicit: resolved.explicit,
          projectConfigTakesOver: resolved.projectConfigTakesOver,
          projectConfigFile: resolved.projectConfigFile,
          useProjectConfig: settings.respectProjectConfig && env.trusted,
          range: input.range,
          timeoutMs: settings.timeoutMs,
        },
        env,
        token,
      );
    } catch (error) {
      if (error instanceof FormatterError) {
        error.formatterId = descriptor.id;
        if (error.kind === 'missing' && !error.install) {
          error.install = descriptor.install;
        }
        throw error;
      }
      throw new FormatterError('failed', `${descriptor.displayName} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (token.isCancellationRequested) {
      throw new FormatterError('cancelled', 'Formatting was cancelled.');
    }

    // A formatter must never silently wipe a document.
    if (output.trim().length === 0 && input.text.trim().length > 0) {
      throw new FormatterError('failed', `${descriptor.displayName} returned an empty result, so the file was left unchanged.`);
    }

    if (descriptor.options.lineEndings?.native === EOL_BY_CODENEAT) {
      const preference = resolved.projectConfigTakesOver ? 'auto' : (resolved.values.lineEndings as string | undefined);
      output = normalizeEol(output, targetEol(preference, input.text));
    }

    return {
      text: output,
      changed: output !== input.text,
      formatterId: descriptor.id,
      formatterName: descriptor.displayName,
      durationMs: Date.now() - started,
      plan,
    };
  }
}
