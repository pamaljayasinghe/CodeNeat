// Bundles the extension host code and the webview UI with esbuild.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const e2e = process.argv.includes('--e2e');

// Formatter engines stay as real node_modules: several are ESM-only or load WASM files at runtime.
const runtimeModules = [
  'prettier', 'prettier-plugin-java', '@prettier/plugin-xml', 'prettier-plugin-toml', '@prettier/plugin-php', 'prettier-plugin-latex', 'sql-formatter', 'editorconfig',
  '@wasm-fmt/*', '@reteps/dockerfmt',
];

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: 'none',
};

const extension = {
  ...common,
  entryPoints: [join(root, 'src', 'extension.ts')],
  outfile: join(root, 'dist', 'extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode', ...runtimeModules],
};

const webview = {
  ...common,
  entryPoints: [join(root, 'webview', 'src', 'main.tsx')],
  outfile: join(root, 'dist', 'webview', 'main.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  loader: { '.css': 'css' },
};

const e2eSuite = {
  ...common,
  minify: false,
  entryPoints: [join(root, 'tests', 'e2e', 'suite.ts')],
  outfile: join(root, 'out', 'e2e', 'suite.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
};

function copyStatic() {
  mkdirSync(join(root, 'dist', 'webview'), { recursive: true });
  for (const file of ['sidebar.js', 'sidebar.css']) {
    copyFileSync(join(root, 'webview', 'sidebar', file), join(root, 'dist', 'webview', file));
  }
  // The logo is shown inside the webviews, which may only load files from dist/webview.
  copyFileSync(join(root, 'assets', 'button.png'), join(root, 'dist', 'webview', 'logo.png'));
}

if (e2e) {
  await esbuild.build(e2eSuite);
} else if (watch) {
  copyStatic();
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('watching for changes…');
} else {
  copyStatic();
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}
