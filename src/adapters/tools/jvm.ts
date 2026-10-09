import type { ExternalSpec } from '../external';
import { externalDescriptor, fixed } from '../toolkit';

/** google-java-format — https://github.com/google/google-java-format */
export const googleJavaFormat: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'google-java-format',
    displayName: 'google-java-format',
    engine: 'google-java-format',
    license: 'Apache-2.0',
    homepage: 'https://github.com/google/google-java-format',
    languages: ['java'],
    extensions: ['.java'],
    requirement: 'A "google-java-format" launcher on your PATH (needs a Java runtime).',
    executables: ['google-java-format'],
    install: {
      summary: 'Install google-java-format with Homebrew, or download the release and put a launcher on your PATH.',
      commands: [{ label: 'Homebrew', command: 'brew install google-java-format' }],
      url: 'https://github.com/google/google-java-format/releases',
    },
    options: {
      javaStyleGuide: { native: '--aosp', support: 'full', default: 'google' },
      sortImports: { native: '--skip-sorting-imports (inverted)', support: 'full', default: true },
      removeUnusedImports: {
        native: '--skip-removing-unused-imports (inverted)',
        support: 'full',
        default: false,
        note: 'google-java-format removes unused imports by default; CodeNeat keeps them unless you switch this on.',
      },
      formatDocComments: { native: '--skip-javadoc-formatting (inverted)', support: 'full', default: true },
    },
    fixed: {
      lineLength: fixed(100, 'google-java-format always uses a 100 character line length.'),
      indentStyle: fixed('spaces', 'google-java-format always indents with spaces.'),
      indentSize: fixed(2, 'Indentation is 2 spaces in Google style and 4 in AOSP style. Choose the style under "Java: Style Guide".'),
      braceStyle: fixed('attach', 'Google Java Style puts the opening brace on the same line.'),
    },
    lineLength: 'none',
    lineLengthNote: 'The line length is fixed at 100 characters.',
    rangeLanguages: ['java'],
    limitations: ['Implements the Google Java Style Guide; only the Google/AOSP switch and import handling can be configured.'],
  }),
  versionArgs: ['--version'],
  versionCheck: /google-java-format/i,
  build({ style, lineRange }) {
    const args: string[] = [];
    if (style.effectiveStr('javaStyleGuide') === 'aosp') {
      args.push('--aosp');
    }
    if (style.effectiveBool('sortImports') === false) {
      args.push('--skip-sorting-imports');
    }
    if (style.effectiveBool('removeUnusedImports') !== true) {
      args.push('--skip-removing-unused-imports');
    }
    if (style.effectiveBool('formatDocComments') === false) {
      args.push('--skip-javadoc-formatting');
    }
    if (lineRange) {
      args.push('--lines', `${lineRange.start}:${lineRange.end}`);
    }
    args.push('-');
    return [{ mode: 'stdin', args }];
  },
};

/** ktfmt — https://github.com/facebook/ktfmt */
export const ktfmt: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'ktfmt',
    displayName: 'ktfmt',
    engine: 'ktfmt',
    license: 'Apache-2.0',
    homepage: 'https://github.com/facebook/ktfmt',
    languages: ['kotlin'],
    extensions: ['.kt', '.kts'],
    requirement: 'A "ktfmt" launcher on your PATH (needs a Java runtime).',
    executables: ['ktfmt'],
    install: {
      summary: 'Install ktfmt with Homebrew, or download the jar and put a launcher on your PATH.',
      commands: [{ label: 'Homebrew', command: 'brew install ktfmt' }],
      url: 'https://github.com/facebook/ktfmt#using-the-formatter',
    },
    options: {
      kotlinStyleGuide: { native: '--meta-style / --google-style / --kotlinlang-style', support: 'full', default: 'meta', values: ['meta', 'google', 'kotlinlang'] },
      removeUnusedImports: {
        native: '--do-not-remove-unused-imports (inverted)',
        support: 'full',
        default: false,
        note: 'ktfmt removes unused imports by default; CodeNeat keeps them unless you switch this on.',
      },
    },
    fixed: {
      lineLength: fixed(100, 'The ktfmt command line uses the 100 character width of its style and offers no flag to change it.'),
      indentStyle: fixed('spaces', 'ktfmt always indents with spaces.'),
      indentSize: fixed(2, 'Indentation is decided by the style: 2 spaces for Meta and Google, 4 for Kotlin official.'),
    },
    lineLength: 'none',
    lineLengthNote: 'The line length is fixed by the chosen style (100 characters).',
    limitations: ['Only the style guide and unused-import handling can be configured.'],
  }),
  versionArgs: ['--version'],
  versionOptional: true,
  build({ style }) {
    const args: string[] = [];
    const guide = style.effectiveStr('kotlinStyleGuide');
    if (guide === 'google') {
      args.push('--google-style');
    } else if (guide === 'kotlinlang') {
      args.push('--kotlinlang-style');
    }
    if (style.effectiveBool('removeUnusedImports') !== true) {
      args.push('--do-not-remove-unused-imports');
    }
    args.push('-');
    return [{ mode: 'stdin', args }];
  },
};

/** ktlint — https://pinterest.github.io/ktlint/latest/ */
export const ktlint: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'ktlint',
    displayName: 'ktlint',
    engine: 'ktlint',
    license: 'MIT',
    homepage: 'https://pinterest.github.io/ktlint/latest/',
    languages: ['kotlin'],
    extensions: ['.kt', '.kts'],
    requirement: 'The "ktlint" executable (needs a Java runtime).',
    executables: ['ktlint'],
    install: {
      summary: 'Install ktlint with Homebrew or download it from the releases page.',
      commands: [{ label: 'Homebrew', command: 'brew install ktlint' }],
      url: 'https://pinterest.github.io/ktlint/latest/install/cli/',
    },
    options: {
      lineLength: { native: 'max_line_length (.editorconfig)', support: 'partial', default: 140, note: 'ktlint wraps some constructs at this width and reports the rest; it cannot shorten every long line.' },
      indentStyle: { native: 'indent_style (.editorconfig)', support: 'full', default: 'spaces' },
      indentSize: { native: 'indent_size (.editorconfig)', support: 'full', default: 4 },
      kotlinStyleGuide: { native: 'ktlint_code_style (.editorconfig)', support: 'full', default: 'kotlinlang', values: ['kotlinlang', 'android'] },
    },
    lineLength: 'preferred',
    limitations: ['ktlint is a linter with auto-correct: it fixes what it can and leaves the rest untouched.'],
  }),
  versionArgs: ['--version'],
  async build({ style, applyStyle, writeTemp }) {
    const args = ['--format', '--stdin', '--log-level=none'];
    if (applyStyle) {
      const lines = ['root = true', '', '[*.{kt,kts}]'];
      const guide = style.str('kotlinStyleGuide');
      if (guide) {
        lines.push(`ktlint_code_style = ${guide === 'android' ? 'android_studio' : 'intellij_idea'}`);
      }
      if (style.num('lineLength') !== undefined) {
        lines.push(`max_line_length = ${style.num('lineLength')}`);
      }
      if (style.num('indentSize') !== undefined) {
        lines.push(`indent_size = ${style.num('indentSize')}`);
      }
      if (style.useTabs !== undefined) {
        lines.push(`indent_style = ${style.useTabs ? 'tab' : 'space'}`);
      }
      if (lines.length > 3) {
        args.push(`--editorconfig=${await writeTemp('ktlint.editorconfig', `${lines.join('\n')}\n`)}`);
      }
    }
    // Exit code 1 means "formatted, but some lint findings could not be auto-corrected".
    return [{ mode: 'stdin', args, okCodes: [0, 1] }];
  },
};

/** scalafmt — https://scalameta.org/scalafmt/docs/installation.html#cli */
export const scalafmt: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'scalafmt',
    displayName: 'scalafmt',
    engine: 'scalafmt',
    license: 'Apache-2.0',
    homepage: 'https://scalameta.org/scalafmt/',
    languages: ['scala'],
    extensions: ['.scala', '.sc', '.sbt'],
    requirement: 'The "scalafmt" command line tool.',
    executables: ['scalafmt'],
    install: {
      summary: 'Install the scalafmt command line tool with Coursier or Homebrew.',
      commands: [
        { label: 'Coursier', command: 'cs install scalafmt' },
        { label: 'Homebrew', command: 'brew install scalafmt' },
      ],
      url: 'https://scalameta.org/scalafmt/docs/installation.html#cli',
    },
    options: {
      lineLength: { native: 'maxColumn', support: 'full', default: 80, note: 'scalafmt keeps code within this width where it can.' },
      indentSize: { native: 'indent.main', support: 'full', default: 2 },
    },
    fixed: {
      indentStyle: fixed('spaces', 'scalafmt always indents with spaces.'),
    },
    lineLength: 'preferred',
    configFiles: ['.scalafmt.conf'],
    limitations: [
      'Without a .scalafmt.conf, files are read with the Scala 3 dialect, which also accepts most Scala 2 code.',
      'With a .scalafmt.conf, scalafmt may need to download the version named in that file the first time it runs.',
    ],
  }),
  versionArgs: ['--version'],
  versionCheck: /scalafmt/i,
  build({ request, style, applyStyle, version }) {
    const args = ['--stdin', '--stdout', '--quiet', '--assume-filename', request.fileName];
    if (applyStyle) {
      const entries = [`version = "${version ?? '3.8.3'}"`, 'runner.dialect = scala3'];
      if (style.num('lineLength') !== undefined) {
        entries.push(`maxColumn = ${style.num('lineLength')}`);
      }
      if (style.num('indentSize') !== undefined) {
        entries.push(`indent.main = ${style.num('indentSize')}`);
      }
      args.push('--config-str', entries.join('\n'));
    } else if (request.projectConfigFile) {
      args.push('--config', request.projectConfigFile);
    }
    return [{ mode: 'stdin', args }];
  },
};
