// Regenerates the reference documentation from the formatter descriptors.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'out', 'docs-entry.cjs');
mkdirSync(join(root, 'out'), { recursive: true });
await esbuild.build({
  entryPoints: [join(root, 'scripts', 'docs-entry.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'warning',
  external: ['prettier', 'prettier-plugin-java', '@prettier/plugin-xml', 'prettier-plugin-toml', '@prettier/plugin-php', 'prettier-plugin-latex', 'sql-formatter', 'editorconfig', '@wasm-fmt/*', '@reteps/dockerfmt'],
});
const result = spawnSync(process.execPath, [outfile, root], { stdio: 'inherit' });
rmSync(outfile, { force: true });
process.exit(result.status ?? 1);
