// Writes THIRD_PARTY_NOTICES.md: every package that ships inside the VSIX, with its licence and licence text.
import { execSync } from 'node:child_process';
import { readdirSync,readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendored = join(root, 'scripts', 'licenses');
const folders = execSync('npm ls --omit=dev --all --parseable', { cwd: root, encoding: 'utf8' })
  .trim()
  .split('\n')
  .slice(1)
  // Native dockerfmt binaries are left out of the VSIX (see .vscodeignore).
  .filter((folder) => !/dockerfmt-[a-z0-9]+-[a-z0-9]+$/.test(folder));

// The WebAssembly packages are builds of other projects; those projects keep their own licences.
// The last entry names the upstream licence texts kept in scripts/licenses.
const UPSTREAM = {
  '@wasm-fmt/gofmt': ['gofmt (The Go Authors)', 'BSD-3-Clause', 'https://github.com/golang/go', ['gofmt.txt']],
  '@wasm-fmt/ruff_fmt': ['Ruff (Astral Software Inc.)', 'MIT', 'https://github.com/astral-sh/ruff', ['ruff.txt']],
  '@wasm-fmt/clang-format': ['clang-format (LLVM Project)', 'Apache-2.0 WITH LLVM-exception', 'https://github.com/llvm/llvm-project', ['clang-format.txt']],
  '@wasm-fmt/lua_fmt': ['StyLua (JohnnyMorganz)', 'MPL-2.0', 'https://github.com/JohnnyMorganz/StyLua', ['stylua.txt']],
  '@wasm-fmt/shfmt': ['shfmt (Daniel Martí)', 'BSD-3-Clause', 'https://github.com/mvdan/sh', ['shfmt.txt']],
  '@wasm-fmt/dart_fmt': ['dart_style (Dart project authors)', 'BSD-3-Clause', 'https://github.com/dart-lang/dart_style', ['dart_style.txt']],
  '@reteps/dockerfmt': ['dockerfmt (Peter Stenger), which includes mvdan/sh and moby/buildkit', 'MIT, BSD-3-Clause and Apache-2.0', 'https://github.com/reteps/dockerfmt', ['dockerfmt.txt', 'shfmt.txt', 'buildkit.txt']],
  'prettier-plugin-toml': ['Taplo (Ferenc Tamás)', 'MIT', 'https://github.com/tamasfe/taplo', ['taplo.txt']],
  'prettier-plugin-java': ['tree-sitter-java-orchard (Java grammar)', 'MIT', 'https://codeberg.org/grammar-orchard/tree-sitter-java-orchard', []],
};

// Packages that publish no licence file of their own; the text comes from their source repository.
const WITHOUT_FILE = [
  [/^@reteps\/dockerfmt$/, 'dockerfmt.txt'],
  [/^@taplo\//, 'taplo.txt'],
  [/^@unified-latex\//, 'unified-latex.txt'],
  [/^trie-prefix-tree$/, 'trie-prefix-tree.txt'],
  [/^railroad-diagrams$/, 'cc0-1.0.txt'],
];

// Libraries that esbuild compiles into dist/ (see build.mjs). They are devDependencies, so "npm ls" does not list them.
async function bundledFolders() {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const result = await esbuild.build({
    entryPoints: [join(root, 'src', 'extension.ts'), join(root, 'webview', 'src', 'main.tsx')],
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    outdir: join(root, 'dist'),
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    loader: { '.css': 'css' },
    external: ['vscode', ...Object.keys(manifest.dependencies).flatMap((name) => [name, `${name}/*`])],
  });
  const found = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match) {
      found.add(join(root, match[1]));
    }
  }
  return [...found];
}

function licenceTexts(folder, name) {
  const files = readdirSync(folder)
    .filter((file) => /^(licen[sc]e|copying|notice)/i.test(file) && statSync(join(folder, file)).isFile())
    .sort();
  if (files.length > 0) {
    return files.map((file) => readFileSync(join(folder, file), 'utf8'));
  }
  const fallback = WITHOUT_FILE.find(([pattern]) => pattern.test(name));
  return fallback ? [readFileSync(join(vendored, fallback[1]), 'utf8')] : [];
}

function describe(folder) {
  const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
  const licence = typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'UNKNOWN');
  const repository = (typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository?.url ?? '')).replace(/^git\+/, '').replace(/\.git$/, '');
  return { name: manifest.name, version: manifest.version, licence, repository, texts: licenceTexts(folder, manifest.name) };
}

function collect(list) {
  const packages = new Map();
  for (const folder of list) {
    const entry = describe(folder);
    packages.set(`${entry.name}@${entry.version}`, entry);
  }
  return [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const list = collect(folders);
const shipped = new Set(list.map((entry) => `${entry.name}@${entry.version}`));
const bundled = collect(await bundledFolders()).filter((entry) => !shipped.has(`${entry.name}@${entry.version}`));
const everything = [...list, ...bundled];

const allowed = /^(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|CC0-1\.0|Python-2\.0|BlueOak-1\.0\.0|Unlicense)$/;
const unexpected = everything.filter((entry) => !allowed.test(entry.licence));
if (unexpected.length > 0) {
  console.error(`Packages with a licence that needs review: ${unexpected.map((entry) => `${entry.name} (${entry.licence})`).join(', ')}`);
  process.exit(1);
}
const withoutText = everything.filter((entry) => entry.texts.length === 0);
if (withoutText.length > 0) {
  console.error(`Packages without a licence text. Add the text to scripts/licenses and list it in WITHOUT_FILE: ${withoutText.map((entry) => entry.name).join(', ')}`);
  process.exit(1);
}

// Identical texts are printed once, under the names of every package they cover.
const texts = new Map();
function addText(label, text) {
  const body = text.replace(/\r\n/g, '\n').trim();
  const key = body.replace(/\s+/g, ' ');
  const group = texts.get(key) ?? { labels: new Set(), body };
  group.labels.add(label);
  texts.set(key, group);
}
for (const entry of everything) {
  for (const text of entry.texts) {
    addText(`${entry.name} ${entry.version}`, text);
  }
}
const engines = Object.entries(UPSTREAM).filter(([name]) => list.some((entry) => entry.name === name));
for (const [name, [, , , files]] of engines) {
  for (const file of files) {
    addText(`${file.replace(/\.txt$/, '')}, inside ${name}`, readFileSync(join(vendored, file), 'utf8'));
  }
}

// The libraries compiled into each engine, collected by fetch-engine-licenses.mjs.
const inside = JSON.parse(readFileSync(join(vendored, 'engines.json'), 'utf8'));
const insideEngines = inside.engines.filter((engine) => list.some((entry) => entry.name === engine.package));
const outdated = insideEngines.filter((engine) => !list.some((entry) => entry.name === engine.package && entry.version === engine.version));
if (outdated.length > 0) {
  console.error(`The engine licence lists are out of date for ${outdated.map((engine) => engine.package).join(', ')}. Run "npm run notices:engines".`);
  process.exit(1);
}
for (const engine of insideEngines) {
  for (const component of engine.components) {
    for (const key of component.texts) {
      addText(`${component.name} ${component.version}`.trim(), inside.texts[key]);
    }
  }
}
const row = (entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} | ${entry.repository} |`;

const lines = [
  '# Third-party notices',
  '',
  'CodeNeat is licensed under the Apache License 2.0 (see LICENSE). It includes the open-source software listed below. Each package keeps its own licence. The copyright notices and the full text of every licence are reproduced under "Licence texts" at the end of this file.',
  '',
  'All included software is free to use and redistribute, including commercially, under permissive open-source licences.',
  '',
  '## Formatting engines built from other projects',
  '',
  'These packages contain builds of formatting engines maintained by other projects.',
  '',
  '| Package in CodeNeat | Engine and authors | Engine licence | Source code |',
  '| --- | --- | --- | --- |',
  ...engines.map(([name, [engine, licence, source]]) => `| ${name} | ${engine} | ${licence} | ${source} |`),
  '',
  'StyLua is licensed under the Mozilla Public License 2.0. CodeNeat distributes it unmodified in compiled form; its source code is available at the address above.',
  '',
  'These engines are compiled together with the open-source libraries they depend on. Those libraries are listed under "Libraries inside the formatting engines" below.',
  '',
  'Prettier is built together with its own dependencies. Their notices are in `node_modules/prettier/THIRD-PARTY-NOTICES.md` inside the extension.',
  '',
  '## All included packages',
  '',
  '| Package | Version | Licence | Source |',
  '| --- | --- | --- | --- |',
  ...list.map(row),
  '',
  '## Libraries compiled into CodeNeat',
  '',
  'These libraries are built into the files under `dist` instead of being shipped as separate packages.',
  '',
  '| Package | Version | Licence | Source |',
  '| --- | --- | --- | --- |',
  ...bundled.map(row),
  '',
  '## Libraries inside the formatting engines',
  '',
  'Each list is taken from the dependency records the engine was built from. A list can name libraries that are only used while building the engine or on other operating systems. Where a library publishes no licence file, the licence named in the table applies.',
  '',
  ...insideEngines.flatMap((engine) => [
    `### ${engine.engine} (${engine.package} ${engine.version})`,
    '',
    `Taken from ${engine.basis}.`,
    '',
    '| Library | Version | Licence | Source |',
    '| --- | --- | --- | --- |',
    ...engine.components.map((component) => `| ${component.name} | ${component.version} | ${component.licence} | ${component.source} |`),
    '',
  ]),
  '## Licence texts',
  '',
  ...[...texts.values()].flatMap((group) => {
    const labels = [...group.labels];
    const heading = labels.length > 3 ? [`### ${labels[0]} and ${labels.length - 1} others`, '', `Applies to: ${labels.join('; ')}.`] : [`### ${labels.join('; ')}`];
    return [...heading, '', '````text', group.body, '````', ''];
  }),
];
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
const counts = {};
for (const entry of everything) {
  counts[entry.licence] = (counts[entry.licence] ?? 0) + 1;
}
console.log(`notices: ${list.length} packages, ${bundled.length} compiled in, ${insideEngines.reduce((sum, engine) => sum + engine.components.length, 0)} engine libraries, ${texts.size} licence texts`, counts);
