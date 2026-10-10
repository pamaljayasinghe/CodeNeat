// Writes THIRD_PARTY_NOTICES.md: every package that ships inside the VSIX, with its licence.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folders = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .slice(1)
  // Native dockerfmt binaries are left out of the VSIX (see .vscodeignore).
  .filter((folder) => !/dockerfmt-[a-z0-9]+-[a-z0-9]+$/.test(folder));

// The WebAssembly packages are builds of other projects; those projects keep their own licences.
const UPSTREAM = {
  '@wasm-fmt/gofmt': ['gofmt (The Go Authors)', 'BSD-3-Clause', 'https://github.com/golang/go'],
  '@wasm-fmt/ruff_fmt': ['Ruff (Astral Software Inc.)', 'MIT', 'https://github.com/astral-sh/ruff'],
  '@wasm-fmt/clang-format': ['clang-format (LLVM Project)', 'Apache-2.0 WITH LLVM-exception', 'https://github.com/llvm/llvm-project'],
  '@wasm-fmt/lua_fmt': ['StyLua (JohnnyMorganz)', 'MPL-2.0', 'https://github.com/JohnnyMorganz/StyLua'],
  '@wasm-fmt/shfmt': ['shfmt (Daniel Martí)', 'BSD-3-Clause', 'https://github.com/mvdan/sh'],
  '@wasm-fmt/dart_fmt': ['dart_style (Dart project authors)', 'BSD-3-Clause', 'https://github.com/dart-lang/dart_style'],
  '@reteps/dockerfmt': ['dockerfmt (Peter Stenger), which includes mvdan/sh', 'MIT and BSD-3-Clause', 'https://github.com/reteps/dockerfmt'],
  'prettier-plugin-toml': ['Taplo (Ferenc Tamás)', 'MIT', 'https://github.com/tamasfe/taplo'],
};

const packages = new Map();
for (const folder of folders) {
  const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const licence = typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'UNKNOWN');
  const repository = (typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository?.url ?? '')).replace(/^git\+/, '').replace(/\.git$/, '');
  const hasLicenceFile = existsSync(folder) && readdirSync(folder).some((name) => /^licen[sc]e/i.test(name));
  packages.set(`${manifest.name}@${manifest.version}`, { name: manifest.name, version: manifest.version, licence, repository, hasLicenceFile });
}
const list = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const allowed = /^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|CC0-1\.0|Python-2\.0|BlueOak-1\.0\.0|Unlicense)$/;
const unexpected = list.filter((entry) => !allowed.test(entry.licence));
if (unexpected.length > 0) {
  console.error(`Packages with a licence that needs review: ${unexpected.map((entry) => `${entry.name} (${entry.licence})`).join(', ')}`);
  process.exit(1);
}

const lines = [
  '# Third-party notices',
  '',
  'CodeNeat is licensed under the Apache License 2.0 (see LICENSE). It includes the open-source software listed below. Each package keeps its own licence. Where a package ships a licence file, that file is included in its folder under `node_modules` inside the extension; for the others, the licence named below applies and its text is available from the source repository of the package.',
  '',
  'All included software is free to use and redistribute, including commercially, under permissive open-source licences.',
  '',
  '## Formatting engines built from other projects',
  '',
  'These packages contain builds of formatting engines maintained by other projects.',
  '',
  '| Package in CodeNeat | Engine and authors | Engine licence | Source code |',
  '| --- | --- | --- | --- |',
  ...Object.entries(UPSTREAM)
    .filter(([name]) => list.some((entry) => entry.name === name))
    .map(([name, [engine, licence, source]]) => `| ${name} | ${engine} | ${licence} | ${source} |`),
  '',
  'StyLua is licensed under the Mozilla Public License 2.0. CodeNeat distributes it unmodified in compiled form; its source code is available at the address above.',
  '',
  '## All included packages',
  '',
  '| Package | Version | Licence | Source |',
  '| --- | --- | --- | --- |',
  ...list.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} | ${entry.repository} |`),
  '',
];
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
const counts = {};
for (const entry of list) {
  counts[entry.licence] = (counts[entry.licence] ?? 0) + 1;
}
console.log(`notices: ${list.length} packages`, counts, `without a licence file: ${list.filter((entry) => !entry.hasLicenceFile).map((entry) => entry.name).join(', ') || 'none'}`);
