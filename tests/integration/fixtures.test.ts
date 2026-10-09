import { beforeAll, describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../src/shared/languages';
import type { FormatterStatus } from '../../src/shared/types';
import { createService, fixtureLanguages, loadFixture, makeSettings } from '../helpers/harness';

/**
 * Runs the REAL formatter of every advertised language against its fixture.
 *
 * Bundled engines always run. External formatters run when the tool is installed on this machine
 * and are reported as skipped otherwise — a skipped language is NOT verified.
 */
const { registry, service, env } = createService();
let statuses: Record<string, FormatterStatus> = {};

beforeAll(async () => {
  statuses = await registry.detectAll(env);
}, 60000);

describe('fixtures exist for every advertised language', () => {
  it('has exactly one fixture directory per language', () => {
    expect(fixtureLanguages()).toEqual(LANGUAGES.map((language) => language.id).sort());
  });
});

for (const language of LANGUAGES) {
  describe(`${language.label} (${language.id})`, () => {
    for (const formatterId of language.formatters) {
      it(`${formatterId}: formats the fixture and is idempotent`, async (context) => {
        const status = statuses[formatterId];
        if (!status?.available) {
          context.skip(`${formatterId} is not installed on this machine`);
          return;
        }
        const fixture = loadFixture(language.id);
        const input = { text: fixture.text, languageId: language.id, fileName: fixture.fileName };
        const settings = makeSettings();

        const first = await service.format(input, settings, undefined, formatterId);
        expect(first.formatterId).toBe(formatterId);
        expect(first.text.trim().length).toBeGreaterThan(0);
        expect(first.changed, 'the fixture is deliberately untidy, so the formatter must change it').toBe(true);

        const second = await service.format({ ...input, text: first.text }, settings, undefined, formatterId);
        expect(second.text, 'formatting already formatted code must not change it').toBe(first.text);
        expect(second.changed).toBe(false);
      }, 60000);
    }
  });
}
