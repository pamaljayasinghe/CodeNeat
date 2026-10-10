// Checks that codeneat.vsix contains everything the extension needs at runtime and nothing it should not.
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vsix = join(root, 'codeneat.vsix');
if (!existsSync(vsix)) {
  console.error('codeneat.vsix not found. Run "npm run package" first.');
  process.exit(1);
}

function listEntries(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      const names = [];
      zip.on('entry', (entry) => {
        names.push(entry.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

const entries = await listEntries(vsix);
// vsce stores README and CHANGELOG with lower-case names, so the comparison ignores case.
const lower = new Set(entries.map((entry) => entry.toLowerCase()));
const has = (name) => lower.has(`extension/${name}`.toLowerCase());
const required = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE.txt',
  'assets/icon.png',
  'assets/activity-icon.svg',
  'dist/extension.js',
  'dist/webview/main.js',
  'dist/webview/main.css',
  'dist/webview/sidebar.js',
  'dist/webview/sidebar.css',
  'docs/walkthrough/open-file.md',
  'docs/languages.md',
  'docs/usage.md',
  'THIRD_PARTY_NOTICES.md',
  'assets/button.png',
  'node_modules/prettier/package.json',
  'node_modules/prettier/index.cjs',
  'node_modules/prettier-plugin-java/package.json',
  'node_modules/@prettier/plugin-xml/package.json',
  'node_modules/prettier-plugin-toml/package.json',
  'node_modules/sql-formatter/package.json',
  'node_modules/editorconfig/package.json',
  'node_modules/@prettier/plugin-php/package.json',
  'node_modules/prettier-plugin-latex/package.json',
  'node_modules/@wasm-fmt/gofmt/gofmt.wasm',
  'node_modules/@wasm-fmt/ruff_fmt/ruff_fmt_bg.wasm',
  'node_modules/@wasm-fmt/clang-format/clang-format.wasm',
  'node_modules/@wasm-fmt/lua_fmt/lua_fmt_bg.wasm',
  'node_modules/@wasm-fmt/shfmt/shfmt.wasm',
  'node_modules/@wasm-fmt/dart_fmt/dart_fmt.wasm',
  'node_modules/@reteps/dockerfmt/dist/format.wasm',
];
const forbidden = [/^extension\/node_modules\/@reteps\/dockerfmt-/, /^extension\/src\//, /^extension\/webview\//, /^extension\/tests\//, /^extension\/scripts\//, /\.map$/, /^extension\/\.github\//, /^extension\/node_modules\/(typescript|esbuild|vitest|eslint|react|@vscode)\//];

const problems = [];
for (const name of required) {
  if (!has(name)) {
    problems.push(`missing: ${name}`);
  }
}
for (const entry of entries) {
  if (forbidden.some((pattern) => pattern.test(entry))) {
    problems.push(`should not be packaged: ${entry}`);
  }
}

const sizeMB = (statSync(vsix).size / 1024 / 1024).toFixed(2);
console.log(`codeneat.vsix: ${entries.length} files, ${sizeMB} MB`);
if (problems.length > 0) {
  console.error(problems.slice(0, 30).join('\n'));
  process.exit(1);
}
console.log('VSIX contents verified: all runtime files present, no sources, tests or dev dependencies.');
