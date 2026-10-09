import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanFolder } from '../../src/core/workspaceScan';
import { LANGUAGES } from '../../src/shared/languages';

const root = mkdtempSync(path.join(os.tmpdir(), 'codeneat-scan-'));
const write = (relative: string, content = 'x\n'): void => {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
};

beforeAll(() => {
  mkdirSync(path.join(root, '.git'));
  write('.gitignore', 'ignored/\n*.tmp.ts\n!keep.tmp.ts\n');
  write('src/app.ts');
  write('src/style.css');
  write('src/main.py');
  write('src/notes.txt');
  write('src/image.png');
  write('src/a.tmp.ts');
  write('src/keep.tmp.ts');
  write('src/nested/.gitignore', 'secret.ts\n');
  write('src/nested/secret.ts');
  write('src/nested/open.ts');
  write('ignored/hidden.ts');
  write('node_modules/pkg/index.js');
  write('dist/bundle.js');
  write('lib/vendor.min.js');
  write('package-lock.json');
  write('legacy/old.js');
  write('Dockerfile');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const options = { languages: LANGUAGES, exclude: [] as string[], useGitignore: true };
const names = async (extra: Partial<typeof options> = {}): Promise<string[]> =>
  (await scanFolder(root, { ...options, ...extra })).files.map((file) => file.relative).sort();

describe('workspace scan', () => {
  it('finds supported files and skips node_modules, build output, lock and minified files', async () => {
    expect(await names()).toEqual(['Dockerfile', 'legacy/old.js', 'src/app.ts', 'src/keep.tmp.ts', 'src/main.py', 'src/nested/open.ts', 'src/style.css']);
  });

  it('assigns the language of every file', async () => {
    const result = await scanFolder(root, options);
    const byName = Object.fromEntries(result.files.map((file) => [file.relative, file.languageId]));
    expect(byName).toMatchObject({ 'src/app.ts': 'typescript', 'src/main.py': 'python', Dockerfile: 'dockerfile', 'src/style.css': 'css' });
    expect(result.skippedByIgnore).toBeGreaterThan(0);
  });

  it('can ignore .gitignore while still skipping the built-in exclusions', async () => {
    const found = await names({ useGitignore: false });
    expect(found).toEqual(expect.arrayContaining(['ignored/hidden.ts', 'src/a.tmp.ts', 'src/nested/secret.ts']));
    expect(found.some((name) => name.startsWith('node_modules') || name.startsWith('dist'))).toBe(false);
  });

  it('applies custom exclusions and survives invalid patterns', async () => {
    const found = await names({ exclude: ['legacy/', '*.py', '\\'] });
    expect(found).not.toContain('legacy/old.js');
    expect(found).not.toContain('src/main.py');
    expect(found).toContain('src/app.ts');
  });

  it('stops at the file limit and reports it', async () => {
    const result = await scanFolder(root, { ...options, maxFiles: 2 });
    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('stops when cancelled', async () => {
    const token = { isCancellationRequested: true, onCancellationRequested: () => ({ dispose: () => undefined }) };
    expect((await scanFolder(root, { ...options, token })).files).toEqual([]);
  });

  it('honours a parent .gitignore when a sub-folder is scanned', async () => {
    const result = await scanFolder(path.join(root, 'src'), options);
    expect(result.files.map((file) => file.relative).sort()).toEqual(['app.ts', 'keep.tmp.ts', 'main.py', 'nested/open.ts', 'style.css']);
  });
});
