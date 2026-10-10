// Writes scripts/licenses/engines.json: the libraries compiled into the bundled formatting engines, with their licence texts.
// Needs network access. Run it ("npm run notices:engines") whenever a bundled engine is updated; gen-notices.mjs reads the result.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import semver from 'semver';
import yauzl from 'yauzl';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(tmpdir(), 'codeneat-licence-cache');
mkdirSync(cache, { recursive: true });
const RAW = 'https://raw.githubusercontent.com';

const installed = (name) => JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
const sha = (text) => createHash('sha1').update(text).digest('hex');

async function download(url, optional = false) {
  const file = join(cache, sha(url));
  if (existsSync(file)) {
    return readFileSync(file);
  }
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'codeneat-notices (https://github.com/pamaljayasinghe/CodeNeat)' } });
    if (response.ok) {
      const data = Buffer.from(await response.arrayBuffer());
      writeFileSync(file, data);
      return data;
    }
    if (optional && response.status === 404) {
      return undefined;
    }
    if (attempt === 4) {
      throw new Error(`${response.status} for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
}
const text = async (url) => (await download(url)).toString('utf8');

async function pool(items, worker, size = 8) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

// Archive readers: both return a Map of path to Buffer for the files the filter accepts.
function untar(buffer, filter) {
  const data = gunzipSync(buffer);
  const files = new Map();
  for (let offset = 0; offset + 512 <= data.length; ) {
    const header = data.subarray(offset, offset + 512);
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = field(0, 100);
    if (!name) {
      break;
    }
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const path = (field(345, 155) ? `${field(345, 155)}/` : '') + name;
    if ((type === '0' || type === '') && filter(path)) {
      files.set(path, data.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function unzip(buffer, filter) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      const files = new Map();
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith('/') || !filter(entry.fileName)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            reject(streamError);
            return;
          }
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

const LICENCE_FILE = /^(un)?(licen[sc]e|copying|notice|copyright)s?([-_.][\w.-]*)?$/i;
const NOT_A_TEXT = /\.(rs|go|dart|js|ts|py|sh|toml|json|ya?ml|html|png|svg)$/i;
// A licence file in the top folder of an archive; `depth` is how many folders the archive wraps its content in.
const isLicence = (depth) => (path) => {
  const parts = path.split('/');
  return parts.length === depth + 1 && LICENCE_FILE.test(parts[depth]) && !NOT_A_TEXT.test(parts[depth]);
};
const licenceTexts = (files) =>
  [...files.entries()]
    .filter(([path]) => isLicence(path.split('/').length - 1)(path))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, data]) => data.toString('utf8'));

// Names the licence of a text that comes without a declared identifier (Go modules, Dart packages).
function classify(texts) {
  const all = texts.join('\n');
  const found = [];
  const add = (pattern, id) => pattern.test(all) && !found.includes(id) && found.push(id);
  add(/Apache License\s+Version 2\.0/, 'Apache-2.0');
  add(/Mozilla Public License,? [Vv]ersion 2\.0/, 'MPL-2.0');
  add(/Permission is hereby granted, free of charge/, 'MIT');
  add(/Permission to use, copy, modify, and(\/or)? distribute this software/, 'ISC');
  if (/Redistribution and use in source and binary forms/.test(all)) {
    found.push(/Neither the name|may be used to endorse/.test(all) ? 'BSD-3-Clause' : 'BSD-2-Clause');
  }
  return found.join(' AND ') || 'See licence text';
}

// --- Rust -----------------------------------------------------------------------------------

// The tables of a Cargo.toml as [header, body] pairs.
function tomlSections(manifest) {
  const sections = [];
  for (const line of manifest.split('\n')) {
    const header = /^\[([^\]]+)\]\s*$/.exec(line)?.[1];
    if (header) {
      sections.push([header, '']);
    } else if (sections.length > 0) {
      sections[sections.length - 1][1] += `${line}\n`;
    }
  }
  return sections;
}

function parseCargoLock(lock) {
  const packages = [];
  for (const block of lock.split('[[package]]').slice(1)) {
    const value = (key) => new RegExp(`^${key} = "([^"]*)"`, 'm').exec(block)?.[1];
    const dependencies = /^dependencies = \[([^\]]*)\]/m.exec(block)?.[1] ?? '';
    packages.push({
      name: value('name'),
      version: value('version'),
      source: value('source') ?? '',
      dependencies: [...dependencies.matchAll(/"([^"]+)"/g)].map((match) => match[1].split(' ')),
    });
  }
  return packages;
}

const REPOSITORY_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'LICENSE-APACHE', 'license-mit', 'license-apache-2.0', 'COPYING'];

async function crate(name, version) {
  const files = untar(await download(`https://static.crates.io/crates/${name}/${name}-${version}.crate`), (path) => isLicence(1)(path) || path === `${name}-${version}/Cargo.toml`);
  const manifest = files.get(`${name}-${version}/Cargo.toml`)?.toString('utf8') ?? '';
  files.delete(`${name}-${version}/Cargo.toml`);
  const licence = /^license\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? 'See licence text';
  let texts = licenceTexts(files);
  // Some crates keep their licence only at the top of their repository.
  const repository = /^repository\s*=\s*"https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?"/m.exec(manifest)?.[1];
  if (texts.length === 0 && repository) {
    const found = await Promise.all(REPOSITORY_FILES.map((file) => download(`${RAW}/${repository}/HEAD/${file}`, true)));
    texts = found.filter(Boolean).map((data) => data.toString('utf8'));
  }
  return { name, version, licence, source: `https://crates.io/crates/${name}/${version}`, texts };
}

// Every crate the lock file records as reachable from `rootName`. Crates of the engine itself
// (git and local sources) are covered by the engine licence and are only walked through.
async function rustFromLock({ lockUrl, manifestUrl, rootName }) {
  const packages = parseCargoLock(await text(lockUrl));
  const find = ([name, version]) => packages.find((entry) => entry.name === name && (!version || entry.version === version));
  const start = find([rootName]);
  const development = [];
  if (manifestUrl) {
    const manifest = await text(manifestUrl);
    const sections = tomlSections(manifest);
    const keys = (section) => [...(sections.find(([header]) => header === section)?.[1] ?? '').matchAll(/^([\w-]+)\s*=/gm)].map((match) => match[1]);
    const normal = keys('dependencies');
    development.push(...keys('dev-dependencies').filter((name) => !normal.includes(name)));
  }
  const seen = new Set([start]);
  const queue = start.dependencies.filter(([name]) => !development.includes(name)).map(find);
  while (queue.length > 0) {
    const entry = queue.pop();
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    queue.push(...entry.dependencies.map(find));
  }
  const registry = [...seen].filter((entry) => entry.source.startsWith('registry+'));
  return pool(registry, (entry) => crate(entry.name, entry.version));
}

// Used when the engine publishes no lock file: resolves the newest matching versions from the crates.io index.
async function rustFromManifest({ manifestUrl }) {
  const manifest = await text(manifestUrl);
  const index = new Map();
  const versions = async (name) => {
    if (!index.has(name)) {
      const lower = name.toLowerCase();
      const folder = lower.length <= 2 ? `${lower.length}` : lower.length === 3 ? `3/${lower[0]}` : `${lower.slice(0, 2)}/${lower.slice(2, 4)}`;
      const lines = (await text(`https://index.crates.io/${folder}/${lower}`)).trim().split('\n');
      index.set(name, lines.map((line) => JSON.parse(line)).filter((entry) => !entry.yanked));
    }
    return index.get(name);
  };
  const range = (requirement) =>
    requirement
      .split(',')
      .map((part) => part.trim())
      .map((part) => (/^\d/.test(part) ? `^${part}` : part))
      .join(' ');
  const forWasm = (target) => !target || (target.includes('wasm') && !/not\([^)]*wasm/.test(target));
  // Which optional dependencies the requested features switch on.
  const enabled = (entry, requested) => {
    const table = { ...entry.features, ...entry.features2 };
    const names = new Set();
    const queue = [...requested];
    const done = new Set();
    while (queue.length > 0) {
      const feature = queue.pop();
      if (done.has(feature)) {
        continue;
      }
      done.add(feature);
      for (const item of table[feature] ?? []) {
        if (item.startsWith('dep:')) {
          names.add(item.slice(4));
        } else if (item.includes('/')) {
          if (!item.includes('?/')) {
            names.add(item.split('/')[0]);
          }
        } else {
          queue.push(item);
        }
      }
      if (!(feature in table)) {
        names.add(feature);
      }
    }
    return names;
  };
  const chosen = new Map();
  const visit = async (name, requirement, features) => {
    const all = await versions(name);
    const version = semver.maxSatisfying(all.map((entry) => entry.vers), range(requirement));
    if (!version || chosen.has(`${name}@${version}`)) {
      return;
    }
    chosen.set(`${name}@${version}`, { name, version });
    const entry = all.find((candidate) => candidate.vers === version);
    const optional = enabled(entry, features);
    for (const dependency of entry.deps) {
      if (dependency.kind !== 'normal' || !forWasm(dependency.target) || (dependency.optional && !optional.has(dependency.name))) {
        continue;
      }
      await visit(dependency.package ?? dependency.name, dependency.req, [...dependency.features, ...(dependency.default_features ? ['default'] : [])]);
    }
  };
  const sections = tomlSections(manifest).filter(([header]) => header === 'dependencies' || (header.startsWith('target.') && header.endsWith('.dependencies') && forWasm(header)));
  for (const [, body] of sections) {
    for (const [, name, spec] of body.matchAll(/^([\w-]+)\s*=\s*(.+)$/gm)) {
      if (/optional\s*=\s*true/.test(spec)) {
        continue;
      }
      const requirement = /^"([^"]+)"/.exec(spec)?.[1] ?? /version\s*=\s*"([^"]+)"/.exec(spec)?.[1];
      const features = [...(/features\s*=\s*\[([^\]]*)\]/.exec(spec)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      await visit(name, requirement, [...features, 'default']);
    }
  }
  return pool([...chosen.values()], (entry) => crate(entry.name, entry.version));
}

// --- Go -------------------------------------------------------------------------------------

const goPath = (module) => module.replace(/[A-Z]/g, (letter) => `!${letter.toLowerCase()}`);
const goZip = async (module, version) => unzip(await download(`https://proxy.golang.org/${goPath(module)}/@v/${version}.zip`), (path) => path.endsWith('.go') || isLicence(path.split('/').length - 1)(path));

// Follows the import statements from the given packages and returns every module they reach.
async function goModules({ module, version, packages }) {
  const main = await goZip(module, version);
  const required = [[module, version]];
  const manifest = await text(`https://proxy.golang.org/${goPath(module)}/@v/${version}.mod`);
  for (const [, name, wanted] of manifest.matchAll(/^\s*(?:require\s+)?([\w./-]+\.[\w./-]+)\s+(v[^\s]+)/gm)) {
    required.push([name, wanted]);
  }
  required.sort((a, b) => b[0].length - a[0].length);
  const zips = new Map([[module, main]]);
  const used = new Map();
  const seen = new Set();
  const queue = [...packages];
  while (queue.length > 0) {
    const path = queue.pop();
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    const owner = required.find(([name]) => path === name || path.startsWith(`${name}/`));
    if (!owner) {
      continue;
    }
    if (!zips.has(owner[0])) {
      zips.set(owner[0], await goZip(owner[0], owner[1]));
    }
    used.set(owner[0], owner[1]);
    const folder = `${owner[0]}@${owner[1]}${path.slice(owner[0].length)}/`;
    for (const [file, data] of zips.get(owner[0])) {
      if (!file.startsWith(folder) || file.slice(folder.length).includes('/') || file.endsWith('_test.go')) {
        continue;
      }
      const source = data.toString('utf8');
      const block = [...source.matchAll(/^import\s*\(([^)]*)\)/gm)].map((match) => match[1]).join('\n');
      const single = [...source.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)].map((match) => match[1]);
      for (const imported of [...[...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]), ...single]) {
        if (imported.split('/')[0].includes('.')) {
          queue.push(imported);
        }
      }
    }
  }
  return [...used.entries()]
    .filter(([name]) => name !== module)
    .map(([name, wanted]) => {
      const texts = licenceTexts(new Map([...zips.get(name)].filter(([path]) => !path.endsWith('.go'))));
      return { name, version: wanted.replace(/^v/, ''), licence: classify(texts), source: `https://pkg.go.dev/${name}@${wanted}`, texts };
    });
}

// --- Dart -----------------------------------------------------------------------------------

// The engine publishes no lock file: resolves the newest matching versions published before the engine was built.
async function dartPackages({ manifestUrl, before }) {
  const manifest = await text(manifestUrl);
  const body = /^dependencies:\n((?:[ \t]+.*\n|\n)*)/m.exec(manifest)?.[1] ?? '';
  const chosen = new Map();
  const visit = async (name, constraint) => {
    if (chosen.has(name)) {
      return;
    }
    const info = JSON.parse(await text(`https://pub.dev/api/packages/${name}`));
    const candidates = info.versions.filter((entry) => entry.published <= before);
    const version = semver.maxSatisfying(candidates.map((entry) => entry.version), constraint === 'any' ? '*' : constraint);
    const entry = candidates.find((candidate) => candidate.version === version);
    if (!entry) {
      throw new Error(`No version of ${name} matches ${constraint}`);
    }
    chosen.set(name, entry);
    for (const [dependency, wanted] of Object.entries(entry.pubspec.dependencies ?? {})) {
      if (typeof wanted === 'string') {
        await visit(dependency, wanted || 'any');
      }
    }
  };
  for (const [, name, constraint] of body.matchAll(/^[ \t]+([\w]+):[ \t]*(\S.*)$/gm)) {
    await visit(name, constraint.replace(/^["']|["']$/g, ''));
  }
  return pool([...chosen.entries()], async ([name, entry]) => {
    const texts = licenceTexts(untar(await download(entry.archive_url), isLicence(0)));
    return { name, version: entry.version, licence: classify(texts), source: `https://pub.dev/packages/${name}/versions/${entry.version}`, texts };
  });
}

// --- Components that come with a compiler or runtime ------------------------------------------

const fixed = async (name, licence, source, urls) => ({ name, version: '', licence, source, texts: await Promise.all(urls.map(text)) });
const rustStd = () =>
  fixed('Rust standard library', 'MIT OR Apache-2.0', 'https://github.com/rust-lang/rust', [`${RAW}/rust-lang/rust/HEAD/COPYRIGHT`, `${RAW}/rust-lang/rust/HEAD/LICENSE-MIT`, `${RAW}/rust-lang/rust/HEAD/LICENSE-APACHE`]);
const goStd = () => fixed('Go standard library and runtime', 'BSD-3-Clause', 'https://github.com/golang/go', [`${RAW}/golang/go/HEAD/LICENSE`]);
const tinyGo = () => fixed('TinyGo runtime', 'BSD-3-Clause', 'https://github.com/tinygo-org/tinygo', [`${RAW}/tinygo-org/tinygo/HEAD/LICENSE`]);
const emscripten = async () => [
  await fixed('Emscripten runtime', 'MIT OR NCSA', 'https://github.com/emscripten-core/emscripten', [`${RAW}/emscripten-core/emscripten/HEAD/LICENSE`]),
  await fixed('musl libc', 'MIT', 'https://musl.libc.org', [`${RAW}/emscripten-core/emscripten/HEAD/system/lib/libc/musl/COPYRIGHT`]),
];

async function npmLicence(name, version) {
  const files = untar(await download(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`), isLicence(1));
  return licenceTexts(files);
}

// --- The engines ----------------------------------------------------------------------------

const ENGINES = [
  {
    package: '@wasm-fmt/ruff_fmt',
    engine: 'Ruff',
    basis: (version) => `the Cargo.lock of wasm-fmt/ruff_fmt v${version}`,
    components: async (version) => [
      await rustStd(),
      ...(await rustFromLock({ lockUrl: `${RAW}/wasm-fmt/ruff_fmt/v${version}/Cargo.lock`, manifestUrl: `${RAW}/wasm-fmt/ruff_fmt/v${version}/Cargo.toml`, rootName: 'ruff_fmt' })),
    ],
  },
  {
    package: '@wasm-fmt/lua_fmt',
    engine: 'StyLua',
    basis: (version) => `the Cargo.lock of wasm-fmt/lua_fmt v${version}`,
    components: async (version) => [
      await rustStd(),
      ...(await rustFromLock({ lockUrl: `${RAW}/wasm-fmt/lua_fmt/v${version}/Cargo.lock`, manifestUrl: `${RAW}/wasm-fmt/lua_fmt/v${version}/Cargo.toml`, rootName: 'lua_fmt' })),
    ],
  },
  {
    package: '@taplo/lib',
    engine: 'Taplo',
    basis: (version) => `the crates/taplo-wasm/Cargo.lock of tamasfe/taplo at release-taplo__lib-${version}`,
    components: async (version) => [await rustStd(), ...(await rustFromLock({ lockUrl: `${RAW}/tamasfe/taplo/release-taplo__lib-${version}/crates/taplo-wasm/Cargo.lock`, rootName: 'taplo-wasm' }))],
  },
  {
    package: '@one-ini/wasm',
    engine: 'one-ini',
    basis: (version) => `the Cargo.toml of one-ini/core v${version} (it has no lock file, so versions are the newest that match)`,
    components: async (version) => [await rustStd(), ...(await rustFromManifest({ manifestUrl: `${RAW}/one-ini/core/v${version}/Cargo.toml` }))],
  },
  {
    package: '@wasm-fmt/gofmt',
    engine: 'gofmt',
    basis: (version) => `the sources of wasm-fmt/gofmt v${version}, which use only the Go standard library`,
    components: async () => [await goStd(), await tinyGo()],
  },
  {
    package: '@wasm-fmt/shfmt',
    engine: 'shfmt',
    basis: (version) => `the go.mod and go.sum of wasm-fmt/shfmt v${version}`,
    components: async (version) => {
      const manifest = await text(`${RAW}/wasm-fmt/shfmt/v${version}/go.mod`);
      const sh = /mvdan\.cc\/sh\/v3 (v\S+)/.exec(manifest)[1];
      const texts = licenceTexts(await goZip('mvdan.cc/sh/v3', sh));
      return [await goStd(), await tinyGo(), { name: 'mvdan.cc/sh/v3', version: sh.replace(/^v/, ''), licence: classify(texts), source: 'https://github.com/mvdan/sh', texts }];
    },
  },
  {
    package: '@reteps/dockerfmt',
    engine: 'dockerfmt',
    basis: (version) => `the packages imported by github.com/reteps/dockerfmt/js v${version}`,
    components: async (version) => [await goStd(), ...(await goModules({ module: 'github.com/reteps/dockerfmt', version: `v${version}`, packages: ['github.com/reteps/dockerfmt/js'] }))],
  },
  {
    package: '@wasm-fmt/dart_fmt',
    engine: 'dart_style',
    basis: (version) => `the pubspec.yaml of wasm-fmt/dart_fmt v${version} (it has no lock file, so versions are the newest that matched when it was published)`,
    components: async (version) => {
      const published = JSON.parse(await text('https://registry.npmjs.org/@wasm-fmt/dart_fmt')).time[version];
      return [
        await fixed('Dart SDK libraries and runtime', 'BSD-3-Clause', 'https://github.com/dart-lang/sdk', [`${RAW}/dart-lang/sdk/HEAD/LICENSE`]),
        ...(await dartPackages({ manifestUrl: `${RAW}/wasm-fmt/dart_fmt/v${version}/pubspec.yaml`, before: published })),
      ];
    },
  },
  {
    package: '@wasm-fmt/clang-format',
    engine: 'clang-format',
    basis: () => 'the LLVM Project licence files and the Emscripten toolchain that builds it',
    components: async () => [
      await fixed('LLVM (Support and other libraries)', 'Apache-2.0 WITH LLVM-exception', 'https://github.com/llvm/llvm-project', [`${RAW}/llvm/llvm-project/HEAD/llvm/LICENSE.TXT`]),
      await fixed('BLAKE3 (inside LLVM Support)', 'CC0-1.0 OR Apache-2.0', 'https://github.com/BLAKE3-team/BLAKE3', [`${RAW}/llvm/llvm-project/HEAD/llvm/lib/Support/BLAKE3/LICENSE`]),
      await fixed('Henry Spencer regex (inside LLVM Support)', 'BSD-3-Clause', 'https://github.com/llvm/llvm-project', [`${RAW}/llvm/llvm-project/HEAD/llvm/lib/Support/COPYRIGHT.regex`]),
      await fixed('libc++ and libc++abi', 'Apache-2.0 WITH LLVM-exception', 'https://github.com/llvm/llvm-project', [`${RAW}/llvm/llvm-project/HEAD/libcxx/LICENSE.TXT`]),
      ...(await emscripten()),
    ],
  },
  {
    package: 'web-tree-sitter',
    engine: 'tree-sitter',
    basis: () => 'the Emscripten toolchain that builds it',
    components: emscripten,
  },
  {
    package: 'prettier-plugin-java',
    engine: 'tree-sitter-java-orchard',
    basis: () => 'the build script of prettier-plugin-java, which copies the grammar from the tree-sitter-java-orchard package',
    components: async (version) => {
      const manifest = JSON.parse(await text(`https://registry.npmjs.org/prettier-plugin-java/${version}`));
      const grammar = manifest.devDependencies['tree-sitter-java-orchard'];
      return [{ name: 'tree-sitter-java-orchard', version: grammar, licence: 'MIT', source: 'https://codeberg.org/grammar-orchard/tree-sitter-java-orchard', texts: await npmLicence('tree-sitter-java-orchard', grammar) }];
    },
  },
];

const texts = {};
const engines = [];
for (const definition of ENGINES) {
  const version = installed(definition.package);
  const components = (await definition.components(version)).sort((a, b) => a.name.localeCompare(b.name));
  for (const component of components) {
    component.texts = component.texts.map((body) => {
      const clean = body.replace(/\r\n/g, '\n').trim();
      const key = sha(clean.replace(/\s+/g, ' '));
      texts[key] = clean;
      return key;
    });
  }
  engines.push({ package: definition.package, version, engine: definition.engine, basis: definition.basis(version), components });
  const missing = components.filter((component) => component.texts.length === 0).map((component) => component.name);
  console.log(`${definition.package} ${version}: ${components.length} components${missing.length > 0 ? `, no licence file in: ${missing.join(', ')}` : ''}`);
}
writeFileSync(join(root, 'scripts', 'licenses', 'engines.json'), `${JSON.stringify({ engines, texts }, null, 1)}\n`);
console.log(`engines.json: ${engines.length} engines, ${Object.keys(texts).length} licence texts`);
