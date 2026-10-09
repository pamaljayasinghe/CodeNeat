import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { AdapterEnvironment } from '../../src/core/adapter';
import { type FormattingSettings, FormattingService } from '../../src/core/formattingService';
import { FormatterRegistry } from '../../src/core/registry';
import type { SettingsLayer, StyleOptions } from '../../src/shared/types';

export const FIXTURES = path.resolve(__dirname, '..', 'fixtures');

export function emptyLayer(): SettingsLayer {
  return { style: {}, languages: {} };
}

export function makeSettings(partial: Partial<FormattingSettings> = {}): FormattingSettings {
  return {
    user: emptyLayer(),
    workspace: emptyLayer(),
    profiles: {},
    respectProjectConfig: true,
    timeoutMs: 30000,
    maxFileSizeKB: 2048,
    ...partial,
  };
}

/** Settings whose user layer contains the given style. */
export function withStyle(style: StyleOptions, partial: Partial<FormattingSettings> = {}): FormattingSettings {
  return makeSettings({ user: { style, languages: {} }, ...partial });
}

export function makeEnv(partial: Partial<AdapterEnvironment> = {}): AdapterEnvironment {
  return {
    trusted: true,
    toolPaths: {},
    workspaceRoots: [],
    approvedCommands: new Set(),
    log: () => undefined,
    ...partial,
  };
}

export function createService(env: AdapterEnvironment = makeEnv()): { registry: FormatterRegistry; service: FormattingService; env: AdapterEnvironment } {
  const registry = new FormatterRegistry();
  const service = new FormattingService(registry, () => env);
  return { registry, service, env };
}

export interface Fixture {
  languageId: string;
  fileName: string;
  filePath: string;
  text: string;
}

export function fixtureLanguages(): string[] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadFixture(languageId: string): Fixture {
  const directory = path.join(FIXTURES, languageId);
  const fileName = readdirSync(directory).find((name) => name.startsWith('input') || name === 'Dockerfile');
  if (!fileName) {
    throw new Error(`No fixture for ${languageId}`);
  }
  const filePath = path.join(directory, fileName);
  return { languageId, fileName, filePath, text: readFileSync(filePath, 'utf8') };
}
