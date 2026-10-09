import { describe, expect, it } from 'vitest';
import { createBuiltinAdapters } from '../../src/core/registry';
import { CATALOG, getOption, LINE_LENGTH_DEFAULT, LINE_LENGTH_MAX, LINE_LENGTH_MIN, SECTIONS } from '../../src/shared/catalog';
import { LANGUAGES } from '../../src/shared/languages';
import { BUILTIN_PROFILES } from '../../src/shared/profiles';
import { acceptValue } from '../../src/shared/resolve';
import { sanitizeStyle } from '../../src/shared/validate';

const descriptors = createBuiltinAdapters().map((adapter) => adapter.descriptor);

describe('option catalog', () => {
  it('has unique ids that belong to a known section', () => {
    const ids = CATALOG.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const option of CATALOG) {
      expect(SECTIONS.some((section) => section.id === option.section), option.id).toBe(true);
      expect(option.label.length, option.id).toBeGreaterThan(2);
      expect(option.description.length, option.id).toBeGreaterThan(10);
    }
  });

  it('only offers options that at least one formatter really implements', () => {
    for (const option of CATALOG) {
      expect(descriptors.some((descriptor) => descriptor.options[option.id]), `no formatter implements "${option.id}"`).toBe(true);
    }
  });

  it('uses 120 as the default line length within a 40-300 range', () => {
    const lineLength = getOption('lineLength');
    expect(lineLength?.type).toBe('number');
    if (lineLength?.type === 'number') {
      expect(lineLength.codeneatDefault).toBe(120);
      expect(LINE_LENGTH_DEFAULT).toBe(120);
      expect([lineLength.min, lineLength.max]).toEqual([LINE_LENGTH_MIN, LINE_LENGTH_MAX]);
      expect(lineLength.presets).toEqual([60, 80, 100, 120, 140, 160]);
    }
  });

  it('keeps code-changing options off by default', () => {
    for (const option of CATALOG.filter((candidate) => candidate.semantic)) {
      expect(option.type).toBe('boolean');
      expect(option.fallback, option.id).toBe(false);
      for (const descriptor of descriptors) {
        const capability = descriptor.options[option.id];
        if (capability) {
          expect(capability.default ?? false, `${descriptor.id}.${option.id}`).toBe(false);
        }
      }
    }
  });
});

describe('formatter descriptors', () => {
  it('have unique ids', () => {
    const ids = descriptors.map((descriptor) => descriptor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only reference languages and options that exist', () => {
    const languageIds = new Set(LANGUAGES.map((language) => language.id));
    for (const descriptor of descriptors) {
      for (const language of descriptor.languages) {
        expect(languageIds.has(language), `${descriptor.id} → ${language}`).toBe(true);
      }
      for (const language of descriptor.rangeLanguages) {
        expect(descriptor.languages, `${descriptor.id} range language ${language}`).toContain(language);
      }
      for (const [optionId, capability] of Object.entries(descriptor.options)) {
        const definition = getOption(optionId);
        expect(definition, `${descriptor.id}.${optionId}`).toBeDefined();
        if (!definition) {
          continue;
        }
        expect(capability.native.length).toBeGreaterThan(0);
        for (const language of capability.languages ?? []) {
          expect(descriptor.languages, `${descriptor.id}.${optionId} language ${language}`).toContain(language);
        }
        if (definition.type === 'enum') {
          const known = definition.choices.map((choice) => choice.value);
          for (const value of capability.values ?? []) {
            expect(known, `${descriptor.id}.${optionId} value ${value}`).toContain(value);
          }
        }
        if (capability.default !== undefined) {
          expect(acceptValue(definition, capability, capability.default), `${descriptor.id}.${optionId} default`).toBe(capability.default);
        }
      }
      for (const optionId of Object.keys(descriptor.fixed)) {
        expect(getOption(optionId), `${descriptor.id} fixed ${optionId}`).toBeDefined();
        expect(descriptor.options[optionId], `${descriptor.id}.${optionId} is both fixed and configurable`).toBeUndefined();
        expect(descriptor.fixed[optionId].reason.length).toBeGreaterThan(10);
      }
    }
  });

  it('every language lists formatters that exist and declare that language', () => {
    for (const language of LANGUAGES) {
      for (const formatterId of language.formatters) {
        const descriptor = descriptors.find((candidate) => candidate.id === formatterId);
        expect(descriptor, `${language.id} → ${formatterId}`).toBeDefined();
        expect(descriptor?.languages, `${formatterId} should declare ${language.id}`).toContain(language.id);
      }
    }
  });

  it('external formatters explain how to install them and name their executable', () => {
    for (const descriptor of descriptors.filter((candidate) => candidate.kind === 'external')) {
      expect(descriptor.executables.length, descriptor.id).toBeGreaterThan(0);
      expect(descriptor.install.summary.length, descriptor.id).toBeGreaterThan(15);
      expect(descriptor.install.url, descriptor.id).toMatch(/^https:\/\//);
      expect(descriptor.license.length, descriptor.id).toBeGreaterThan(0);
      expect(descriptor.cancellation).toBe('kill-process');
    }
  });

  it('never claim a strict line limit and explain formatters without a width', () => {
    for (const descriptor of descriptors) {
      expect(descriptor.lineLength, descriptor.id).not.toBe('strict');
      if (descriptor.options.lineLength) {
        expect(descriptor.lineLength, descriptor.id).toBe('preferred');
        expect(descriptor.options.lineLength.note ?? descriptor.lineLengthNote, `${descriptor.id} must explain its width semantics`).toBeTruthy();
      } else {
        expect(descriptor.lineLength, descriptor.id).toBe('none');
      }
    }
  });

  it('gofmt is honest about having no style options', () => {
    const gofmt = descriptors.find((descriptor) => descriptor.id === 'gofmt');
    expect(Object.keys(gofmt?.options ?? {})).toEqual(['lineEndings']);
    expect(gofmt?.fixed.indentStyle?.value).toBe('tabs');
    expect(gofmt?.fixed.lineLength).toBeDefined();
    expect(gofmt?.fixed.braceStyle).toBeDefined();
  });
});

describe('built-in profiles', () => {
  it('are Standard, Compact, Readable and Team Style with valid options', () => {
    expect(BUILTIN_PROFILES.map((profile) => profile.name)).toEqual(['Standard', 'Compact', 'Readable', 'Team Style']);
    for (const profile of BUILTIN_PROFILES) {
      expect(sanitizeStyle(profile.style), profile.id).toEqual(profile.style);
      for (const [language, style] of Object.entries(profile.languages ?? {})) {
        expect(LANGUAGES.some((candidate) => candidate.id === language), `${profile.id} → ${language}`).toBe(true);
        expect(sanitizeStyle(style)).toEqual(style);
      }
    }
  });
});
