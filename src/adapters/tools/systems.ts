import type { BuildContext, ExternalSpec } from '../external';
import { externalDescriptor, fixed } from '../toolkit';

/** rustfmt — https://rust-lang.github.io/rustfmt/ (stable options only) */
export const rustfmt: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'rustfmt',
    displayName: 'rustfmt',
    engine: 'rustfmt',
    license: 'Apache-2.0 OR MIT',
    homepage: 'https://rust-lang.github.io/rustfmt/',
    languages: ['rust'],
    extensions: ['.rs'],
    requirement: 'The "rustfmt" executable from the Rust toolchain.',
    executables: ['rustfmt'],
    install: {
      summary: 'Install rustfmt using the Rust toolchain.',
      commands: [{ label: 'rustup', command: 'rustup component add rustfmt' }],
      url: 'https://github.com/rust-lang/rustfmt#quick-start',
    },
    options: {
      lineLength: { native: 'max_width', support: 'full', default: 100, note: 'rustfmt keeps lines within this width where it can; it leaves a line alone if it cannot be split.' },
      indentStyle: { native: 'hard_tabs', support: 'full', default: 'spaces' },
      indentSize: { native: 'tab_spaces', support: 'full', default: 4 },
      sortImports: { native: 'reorder_imports', support: 'full', default: true, note: 'Sorts "use" statements within each group.' },
      rustEdition: { native: '--edition', support: 'full', default: '2021' },
    },
    fixed: {
      braceStyle: fixed('attach', 'Changing the brace style needs rustfmt\'s unstable (nightly-only) options, which CodeNeat does not use.'),
    },
    lineLength: 'preferred',
    configFiles: ['rustfmt.toml', '.rustfmt.toml'],
    limitations: ['Only stable rustfmt options are offered. Nightly-only options can still be set in your own rustfmt.toml.'],
  }),
  versionArgs: ['--version'],
  versionCheck: /rustfmt/i,
  build({ style, applyStyle }) {
    const args = ['--emit', 'stdout'];
    if (applyStyle) {
      args.push('--edition', style.effectiveStr('rustEdition') ?? '2021');
      const config: string[] = [];
      if (style.num('lineLength') !== undefined) {
        config.push(`max_width=${style.num('lineLength')}`);
      }
      if (style.num('indentSize') !== undefined) {
        config.push(`tab_spaces=${style.num('indentSize')}`);
      }
      if (style.useTabs !== undefined) {
        config.push(`hard_tabs=${style.useTabs}`);
      }
      if (style.bool('sortImports') !== undefined) {
        config.push(`reorder_imports=${style.bool('sortImports')}`);
      }
      if (config.length > 0) {
        args.push('--config', config.join(','));
      }
    }
    return [{ mode: 'stdin', args }];
  },
};

/** gofmt — https://pkg.go.dev/cmd/gofmt */
export const gofmt: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'gofmt',
    displayName: 'gofmt',
    engine: 'gofmt',
    license: 'BSD-3-Clause',
    homepage: 'https://pkg.go.dev/cmd/gofmt',
    languages: ['go'],
    extensions: ['.go'],
    requirement: 'The "gofmt" executable that ships with Go.',
    executables: ['gofmt'],
    install: {
      summary: 'gofmt is installed together with Go.',
      commands: [
        { label: 'Homebrew', command: 'brew install go' },
        { label: 'winget', command: 'winget install GoLang.Go' },
      ],
      url: 'https://go.dev/doc/install',
    },
    fixed: {
      indentStyle: fixed('tabs', 'gofmt always indents with tabs. This is the single standard Go style.'),
      lineLength: fixed(0, 'gofmt never wraps lines and has no line-length setting.'),
      braceStyle: fixed('attach', 'Go requires the opening brace on the same line.'),
      quoteStyle: fixed('preserve', 'gofmt does not change quotes.'),
    },
    lineLength: 'none',
    lineLengthNote: 'gofmt never wraps long lines.',
    limitations: ['gofmt implements one standard style and has no style options at all.'],
  }),
  versionArgs: [],
  versionOptional: true,
  // gofmt has no --version flag; running it with no input simply echoes empty stdin.
  build() {
    return [{ mode: 'stdin', args: [] }];
  },
  explainFailure: (result) => result.stderr.replace(/<standard input>:/g, 'line ').split('\n').slice(0, 5).join('\n').trim() || undefined,
};

const BRACES: Record<string, string> = {
  attach: 'Attach',
  allman: 'Allman',
  stroustrup: 'Stroustrup',
  linux: 'Linux',
  mozilla: 'Mozilla',
  webkit: 'WebKit',
  gnu: 'GNU',
  whitesmiths: 'Whitesmiths',
};

/** Builds the inline --style value for clang-format from explicitly chosen preferences. */
export function clangFormatStyle(style: BuildContext['style']): string {
  const entries: string[] = [`BasedOnStyle: ${style.effectiveStr('cppBaseStyle') ?? 'LLVM'}`];
  const add = (key: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined) {
      entries.push(`${key}: ${value}`);
    }
  };
  add('ColumnLimit', style.num('lineLength'));
  if (style.indentChosen) {
    const size = style.num('indentSize');
    add('IndentWidth', size);
    add('TabWidth', size);
    if (style.useTabs !== undefined) {
      add('UseTab', style.useTabs ? 'Always' : 'Never');
    }
  }
  add('ContinuationIndentWidth', style.num('continuationIndent'));
  add('IndentCaseLabels', style.bool('indentCaseLabels'));
  const parens = style.str('parenthesesIndent');
  if (parens) {
    add('AlignAfterOpenBracket', parens === 'align' ? 'Align' : parens === 'block' ? 'BlockIndent' : 'DontAlign');
  }
  const beforeParens = style.str('spaceBeforeParens');
  if (beforeParens) {
    add('SpaceBeforeParens', beforeParens === 'always' ? 'Always' : beforeParens === 'never' ? 'Never' : 'ControlStatements');
  }
  add('SpacesInParentheses', style.bool('spacesInParens'));
  add('SpaceBeforeAssignmentOperators', style.bool('spaceAroundAssignment'));
  add('MaxEmptyLinesToKeep', style.num('maxBlankLines'));
  const separate = style.str('separateDefinitions');
  if (separate) {
    add('SeparateDefinitionBlocks', separate === 'always' ? 'Always' : separate === 'never' ? 'Never' : 'Leave');
  }
  const braces = style.str('braceStyle');
  if (braces && BRACES[braces]) {
    add('BreakBeforeBraces', BRACES[braces]);
  }
  const shortFunctions = style.str('shortFunctionsOnOneLine');
  if (shortFunctions) {
    add('AllowShortFunctionsOnASingleLine', { none: 'None', empty: 'Empty', inline: 'Inline', all: 'All' }[shortFunctions]);
  }
  if (style.bool('shortIfOnOneLine') !== undefined) {
    add('AllowShortIfStatementsOnASingleLine', style.bool('shortIfOnOneLine') ? 'WithoutElse' : 'Never');
  }
  const operators = style.str('operatorLinePosition');
  if (operators) {
    add('BreakBeforeBinaryOperators', operators === 'start' ? 'NonAssignment' : 'None');
  }
  if (style.bool('sortImports') !== undefined) {
    add('SortIncludes', style.bool('sortImports') ? 'CaseSensitive' : 'Never');
  }
  add('ReflowComments', style.bool('reflowComments'));
  return `{${entries.join(', ')}}`;
}

/** clang-format — https://clang.llvm.org/docs/ClangFormatStyleOptions.html */
export const clangFormat: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'clang-format',
    displayName: 'clang-format',
    engine: 'clang-format (LLVM)',
    license: 'Apache-2.0 WITH LLVM-exception',
    homepage: 'https://clang.llvm.org/docs/ClangFormat.html',
    languages: ['c', 'cpp', 'proto'],
    extensions: ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx', '.proto'],
    requirement: 'The "clang-format" executable (version 14 or newer recommended).',
    executables: ['clang-format'],
    install: {
      summary: 'Install clang-format from LLVM, your package manager, or pip.',
      commands: [
        { label: 'Homebrew', command: 'brew install clang-format' },
        { label: 'pip', command: 'pip install clang-format' },
        { label: 'apt', command: 'sudo apt install clang-format' },
        { label: 'winget', command: 'winget install LLVM.LLVM' },
      ],
      url: 'https://clang.llvm.org/docs/ClangFormat.html',
    },
    options: {
      cppBaseStyle: { native: 'BasedOnStyle', support: 'full', default: 'LLVM' },
      lineLength: { native: 'ColumnLimit', support: 'full', default: 80, note: 'clang-format keeps code within this width; a single token that is longer (such as a long string) is not split.' },
      indentStyle: { native: 'UseTab', support: 'full', default: 'spaces' },
      indentSize: { native: 'IndentWidth / TabWidth', support: 'full', default: 2 },
      continuationIndent: { native: 'ContinuationIndentWidth', support: 'full', default: 4 },
      indentCaseLabels: { native: 'IndentCaseLabels', support: 'full', default: false },
      parenthesesIndent: { native: 'AlignAfterOpenBracket', support: 'full', default: 'align' },
      spaceBeforeParens: { native: 'SpaceBeforeParens', support: 'full', default: 'control' },
      spacesInParens: { native: 'SpacesInParentheses', support: 'full', default: false },
      spaceAroundAssignment: { native: 'SpaceBeforeAssignmentOperators', support: 'full', default: true },
      maxBlankLines: { native: 'MaxEmptyLinesToKeep', support: 'full', default: 1 },
      separateDefinitions: { native: 'SeparateDefinitionBlocks', support: 'full', default: 'leave', note: 'Needs clang-format 14 or newer.' },
      braceStyle: { native: 'BreakBeforeBraces', support: 'full', default: 'attach' },
      shortFunctionsOnOneLine: { native: 'AllowShortFunctionsOnASingleLine', support: 'full', default: 'all' },
      shortIfOnOneLine: { native: 'AllowShortIfStatementsOnASingleLine', support: 'full', default: false },
      operatorLinePosition: { native: 'BreakBeforeBinaryOperators', support: 'full', default: 'end' },
      sortImports: { native: 'SortIncludes', support: 'full', default: true, note: 'Sorts #include lines within each block. In rare cases include order matters in C and C++.' },
      reflowComments: { native: 'ReflowComments', support: 'full', default: true },
    },
    lineLength: 'preferred',
    rangeLanguages: ['c', 'cpp', 'proto'],
    configFiles: ['.clang-format', '_clang-format'],
    limitations: [
      'The defaults shown are those of the LLVM base style; other base styles start from different values.',
      'Preferences you have not set are taken from the selected base style.',
    ],
  }),
  versionArgs: ['--version'],
  versionCheck: /clang-format/i,
  localBin: ['node_modules/.bin/clang-format'],
  build({ request, style, applyStyle, lineRange }) {
    const args = [`--assume-filename=${request.filePath ?? request.fileName}`];
    args.push(applyStyle ? `--style=${clangFormatStyle(style)}` : '--style=file');
    if (!applyStyle) {
      args.push('--fallback-style=LLVM');
    }
    if (lineRange) {
      args.push(`--lines=${lineRange.start}:${lineRange.end}`);
    }
    return [{ mode: 'stdin', args }];
  },
};
