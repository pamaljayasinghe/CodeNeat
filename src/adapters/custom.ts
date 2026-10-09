import { type AdapterEnvironment, type FormatRequest, FormatterError } from '../core/adapter';
import type { CancellationSignal } from '../core/process';
import type { CustomFormatterConfig, FormatterDescriptor, FormatterStatus, OptionCapability } from '../shared/types';
import { ExternalAdapter, type ExternalSpec } from './external';
import { externalDescriptor } from './toolkit';

/** Stable identity of a custom command. Approval is tied to it, so any edit needs a new approval. */
export function commandFingerprint(config: Pick<CustomFormatterConfig, 'command' | 'args'>): string {
  return JSON.stringify([config.command, ...(config.args ?? [])]);
}

function usesPlaceholder(config: CustomFormatterConfig, name: string): boolean {
  return (config.args ?? []).some((arg) => arg.includes(`\${${name}}`));
}

export function customDescriptor(config: CustomFormatterConfig): FormatterDescriptor {
  const options: Record<string, OptionCapability> = {};
  const placeholder = (id: string, name: string, fallback: OptionCapability['default']): void => {
    if (usesPlaceholder(config, name)) {
      options[id] = { native: `\${${name}} placeholder`, support: 'full', default: fallback };
    }
  };
  placeholder('lineLength', 'lineLength', 120);
  placeholder('indentSize', 'indentSize', 4);
  placeholder('indentStyle', 'indentStyle', 'spaces');
  const descriptor = externalDescriptor({
    id: config.id,
    displayName: config.name,
    engine: `Custom command: ${config.command}`,
    license: 'Unknown (your own tool)',
    homepage: '',
    languages: config.languages,
    extensions: config.extensions ?? [],
    requirement: `The "${config.command}" executable, run with the arguments you configured.`,
    executables: [config.command],
    install: {
      summary: `Make sure "${config.command}" is installed and on your PATH, or use an absolute path in the custom formatter's "command".`,
      commands: [],
      url: '',
    },
    options,
    lineLength: usesPlaceholder(config, 'lineLength') ? 'preferred' : 'none',
    limitations: [
      'Custom formatter: CodeNeat pipes the file to the command and uses whatever it prints. CodeNeat cannot check that the tool is language-aware or safe.',
    ],
  });
  return { ...descriptor, kind: 'custom' };
}

function customSpec(config: CustomFormatterConfig): ExternalSpec {
  return {
    descriptor: customDescriptor(config),
    versionArgs: ['--version'],
    versionOptional: true,
    build({ request, style }) {
      const values: Record<string, string> = {
        file: request.filePath ?? request.fileName,
        lineLength: String(style.effectiveNum('lineLength') ?? 120),
        indentSize: String(style.effectiveNum('indentSize') ?? 4),
        indentStyle: style.effectiveStr('indentStyle') ?? 'spaces',
      };
      const args = (config.args ?? []).map((arg) => arg.replace(/\$\{(\w+)\}/g, (match, name: string) => values[name] ?? match));
      return [{ mode: 'stdin', args }];
    },
  };
}

/** A user-defined external formatter. It only runs after the user approved its exact command. */
export class CustomAdapter extends ExternalAdapter {
  readonly fingerprint: string;

  constructor(readonly config: CustomFormatterConfig) {
    super(customSpec(config));
    this.fingerprint = commandFingerprint(config);
  }

  override async detect(env: AdapterEnvironment, nearDir?: string): Promise<FormatterStatus> {
    if (env.trusted && !env.approvedCommands.has(this.fingerprint)) {
      // Do not even start the command (not even with --version) before it has been approved.
      return {
        id: this.descriptor.id,
        available: false,
        problem: 'Waiting for your approval. You will be asked the first time this formatter is used.',
      };
    }
    return super.detect(env, nearDir);
  }

  override async format(request: FormatRequest, env: AdapterEnvironment, token: CancellationSignal): Promise<string> {
    if (!env.trusted) {
      throw new FormatterError('untrusted', 'Custom formatters are switched off in Restricted Mode.');
    }
    if (!env.approvedCommands.has(this.fingerprint)) {
      throw new FormatterError(
        'needs-approval',
        `The custom formatter "${this.descriptor.displayName}" has not been approved yet.`,
        this.fingerprint,
      );
    }
    return super.format(request, env, token);
  }
}
