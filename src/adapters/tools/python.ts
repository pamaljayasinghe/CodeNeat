import type { ExternalSpec, Invocation } from '../external';
import { externalDescriptor, fixed, quoted } from '../toolkit';

const PYTHON_LOCAL = ['.venv/bin', 'venv/bin', '.venv/Scripts', 'venv/Scripts'];

/** Ruff formatter — https://docs.astral.sh/ruff/formatter/ */
export const ruff: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'ruff',
    displayName: 'Ruff',
    engine: 'Ruff formatter',
    license: 'MIT',
    homepage: 'https://docs.astral.sh/ruff/formatter/',
    languages: ['python'],
    extensions: ['.py', '.pyi'],
    requirement: 'The "ruff" executable.',
    executables: ['ruff'],
    install: {
      summary: 'Install Ruff with pip, pipx, uv or Homebrew.',
      commands: [
        { label: 'pip', command: 'pip install ruff' },
        { label: 'uv', command: 'uv tool install ruff' },
        { label: 'Homebrew', command: 'brew install ruff' },
      ],
      url: 'https://docs.astral.sh/ruff/installation/',
    },
    options: {
      lineLength: { native: 'line-length', support: 'full', default: 88, max: 320, note: 'Ruff aims for this width; long strings and comments are not split.' },
      indentStyle: { native: 'format.indent-style', support: 'full', default: 'spaces' },
      indentSize: { native: 'indent-width', support: 'full', default: 4 },
      quoteStyle: { native: 'format.quote-style', support: 'full', default: 'double' },
      pythonMagicTrailingComma: { native: 'format.skip-magic-trailing-comma (inverted)', support: 'full', default: true },
      formatDocComments: {
        native: 'format.docstring-code-format',
        support: 'partial',
        default: false,
        note: 'Formats Python code examples inside docstrings.',
      },
      sortImports: {
        native: 'ruff check --select I --fix-only',
        support: 'partial',
        default: false,
        note: 'Runs Ruff\'s import-sorting rule as a separate step before formatting. Imports are reordered, never added or removed.',
      },
    },
    lineLength: 'preferred',
    lineLengthNote: 'Ruff wraps code to this width where it can; strings and comments may exceed it.',
    rangeLanguages: ['python'],
    configFiles: ['ruff.toml', '.ruff.toml', 'pyproject.toml'],
    limitations: ['Brace and spacing rules follow the Black code style and cannot be changed.'],
  }),
  versionArgs: ['--version'],
  versionCheck: /ruff/i,
  localBin: PYTHON_LOCAL.map((directory) => `${directory}/ruff`),
  configMatches: (fileName, content) => fileName !== 'pyproject.toml' || /^\s*\[tool\.ruff/m.test(content),
  build({ request, style, applyStyle, lineRange }) {
    const name = request.filePath ?? request.fileName;
    const isolation = request.useProjectConfig ? [] : ['--isolated'];
    const config: string[] = [];
    if (applyStyle) {
      const lineLength = style.num('lineLength');
      if (lineLength !== undefined) {
        config.push('--line-length', String(lineLength));
      }
      const push = (entry: string): void => {
        config.push('--config', entry);
      };
      if (style.num('indentSize') !== undefined) {
        push(`indent-width = ${style.num('indentSize')}`);
      }
      if (style.useTabs !== undefined) {
        push(`format.indent-style = ${quoted(style.useTabs ? 'tab' : 'space')}`);
      }
      if (style.str('quoteStyle')) {
        push(`format.quote-style = ${quoted(style.str('quoteStyle') as string)}`);
      }
      if (style.bool('pythonMagicTrailingComma') !== undefined) {
        push(`format.skip-magic-trailing-comma = ${!style.bool('pythonMagicTrailingComma')}`);
      }
      if (style.bool('formatDocComments') !== undefined) {
        push(`format.docstring-code-format = ${style.bool('formatDocComments')}`);
      }
    }
    const invocations: Invocation[] = [];
    if (applyStyle && style.bool('sortImports') && !lineRange) {
      invocations.push({
        mode: 'stdin',
        args: ['check', '--select', 'I', '--fix-only', '--exit-zero', '--quiet', ...isolation, '--stdin-filename', name, '-'],
      });
    }
    const range = lineRange ? [`--range=${lineRange.start}-${lineRange.end}`] : [];
    invocations.push({ mode: 'stdin', args: ['format', ...isolation, ...config, ...range, '--stdin-filename', name, '-'] });
    return invocations;
  },
};

/** Black — https://black.readthedocs.io/en/stable/usage_and_configuration/the_basics.html */
export const black: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'black',
    displayName: 'Black',
    engine: 'Black',
    license: 'MIT',
    homepage: 'https://black.readthedocs.io',
    languages: ['python'],
    extensions: ['.py', '.pyi'],
    requirement: 'The "black" executable.',
    executables: ['black'],
    install: {
      summary: 'Install Black with pip or pipx.',
      commands: [
        { label: 'pip', command: 'pip install black' },
        { label: 'pipx', command: 'pipx install black' },
      ],
      url: 'https://black.readthedocs.io/en/stable/getting_started.html',
    },
    options: {
      lineLength: { native: '--line-length', support: 'full', default: 88, note: 'Black aims for this width; long strings and comments are not split.' },
      quoteStyle: {
        native: '--skip-string-normalization',
        support: 'partial',
        default: 'double',
        values: ['double', 'preserve'],
        note: 'Black either normalises to double quotes or leaves quotes as written; it cannot prefer single quotes.',
      },
      pythonMagicTrailingComma: { native: '--skip-magic-trailing-comma (inverted)', support: 'full', default: true },
    },
    fixed: {
      indentStyle: fixed('spaces', 'Black always indents with 4 spaces.'),
      indentSize: fixed(4, 'Black always indents with 4 spaces.'),
    },
    lineLength: 'preferred',
    configFiles: ['pyproject.toml'],
    limitations: ['Black is deliberately uncompromising: only line length, quote normalisation and the magic trailing comma can be changed.'],
  }),
  versionArgs: ['--version'],
  versionCheck: /black/i,
  localBin: PYTHON_LOCAL.map((directory) => `${directory}/black`),
  configMatches: (_fileName, content) => /^\s*\[tool\.black\]/m.test(content),
  build({ request, style, applyStyle }) {
    const args = ['--quiet'];
    if (applyStyle) {
      if (style.num('lineLength') !== undefined) {
        args.push('--line-length', String(style.num('lineLength')));
      }
      if (style.str('quoteStyle') === 'preserve') {
        args.push('--skip-string-normalization');
      }
      if (style.bool('pythonMagicTrailingComma') === false) {
        args.push('--skip-magic-trailing-comma');
      }
    }
    args.push('--stdin-filename', request.filePath ?? request.fileName, '-');
    return [{ mode: 'stdin', args }];
  },
};
