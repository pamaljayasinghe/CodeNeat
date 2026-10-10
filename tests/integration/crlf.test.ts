import { beforeAll, describe, expect, it } from 'vitest';
import { LANGUAGES } from '../../src/shared/languages';
import type { FormatterStatus } from '../../src/shared/types';
import { createService, loadFixture, makeSettings } from '../helpers/harness';

/**
 * Windows files use CRLF line endings. Every built-in formatter must give the same result for a
 * CRLF file as for the same file with LF endings, and must hand it back with CRLF endings.
 */
const { registry, service, env } = createService();
let statuses: Record<string, FormatterStatus> = {};
const toLf = (text: string): string => text.replace(/\r\n/g, '\n');
const toCrlf = (text: string): string => toLf(text).replace(/\n/g, '\r\n');

beforeAll(async () => {
  statuses = await registry.detectAll(env);
}, 60000);

describe('Windows line endings', () => {
  for (const language of LANGUAGES) {
    for (const formatterId of language.formatters) {
      const descriptor = registry.get(formatterId)?.descriptor;
      if (descriptor?.kind !== 'bundled') {
        continue;
      }
      it(`${language.id} with ${formatterId}: a CRLF file formats like its LF twin and stays CRLF`, async (context) => {
        if (!statuses[formatterId]?.available) {
          context.skip(`${formatterId} cannot run in this Node.js version`);
          return;
        }
        const fixture = loadFixture(language.id);
        const settings = makeSettings();
        const lf = await service.format({ text: toLf(fixture.text), languageId: language.id, fileName: fixture.fileName }, settings, undefined, formatterId);
        const crlf = await service.format({ text: toCrlf(fixture.text), languageId: language.id, fileName: fixture.fileName }, settings, undefined, formatterId);
        expect(lf.text).not.toContain('\r');
        expect(crlf.text.replace(/\r\n/g, ''), 'no stray carriage returns').not.toContain('\r');
        expect(toLf(crlf.text)).toBe(lf.text);
        expect(crlf.text).toBe(toCrlf(lf.text));
      }, 60000);
    }
  }
});
