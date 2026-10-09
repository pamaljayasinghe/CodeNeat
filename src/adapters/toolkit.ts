import { descriptorDefaults } from '../core/adapter';
import { EOL_BY_CODENEAT } from '../core/eol';
import type { FixedOption, FormatterDescriptor, OptionCapability } from '../shared/types';

type Required = 'id' | 'displayName' | 'engine' | 'license' | 'homepage' | 'languages' | 'requirement' | 'install' | 'executables';

/** Builds the descriptor of an external (separately installed) formatter. */
export function externalDescriptor(
  input: Pick<FormatterDescriptor, Required> & Partial<Omit<FormatterDescriptor, Required | 'kind'>>,
): FormatterDescriptor {
  return {
    ...descriptorDefaults(),
    kind: 'external',
    lineLength: 'none',
    cancellation: 'kill-process',
    ...input,
    options: { lineEndings: EOL_OPTION, ...(input.options ?? {}) },
  };
}

/** Line endings for external tools: CodeNeat converts the tool's output to the wanted line ending. */
export const EOL_OPTION: OptionCapability = {
  native: EOL_BY_CODENEAT,
  support: 'full',
  default: 'auto',
};

export function fixed(value: FixedOption['value'], reason: string): FixedOption {
  return { value, reason };
}

/** A YAML/TOML-safe double-quoted string. */
export function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
