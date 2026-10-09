import type { ExternalSpec } from '../external';
import { externalDescriptor, fixed } from '../toolkit';

/** SQLFluff — https://docs.sqlfluff.com/en/stable/reference/cli.html */
export const sqlfluff: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'sqlfluff',
    displayName: 'SQLFluff',
    engine: 'SQLFluff',
    license: 'MIT',
    homepage: 'https://sqlfluff.com',
    languages: ['sql'],
    extensions: ['.sql'],
    requirement: 'The "sqlfluff" executable (needs Python).',
    executables: ['sqlfluff'],
    install: {
      summary: 'Install SQLFluff with pip or pipx.',
      commands: [
        { label: 'pip', command: 'pip install sqlfluff' },
        { label: 'pipx', command: 'pipx install sqlfluff' },
      ],
      url: 'https://docs.sqlfluff.com/en/stable/gettingstarted.html',
    },
    options: {
      sqlDialect: { native: '--dialect', support: 'full', default: 'ansi' },
      lineLength: { native: 'max_line_length', support: 'full', default: 80, note: 'SQLFluff re-flows statements to this width where it can.' },
      indentStyle: { native: 'indent_unit', support: 'full', default: 'spaces' },
      indentSize: { native: 'tab_space_size', support: 'full', default: 4 },
    },
    lineLength: 'preferred',
    configFiles: ['.sqlfluff', 'pyproject.toml', 'setup.cfg', 'tox.ini'],
    limitations: ['Templated SQL (Jinja, dbt) needs a .sqlfluff file that configures the templater.'],
  }),
  versionArgs: ['--version'],
  versionCheck: /sqlfluff|version/i,
  localBin: ['.venv/bin/sqlfluff', 'venv/bin/sqlfluff', '.venv/Scripts/sqlfluff', 'venv/Scripts/sqlfluff'],
  configMatches: (fileName, content) =>
    fileName === '.sqlfluff' || (fileName === 'pyproject.toml' ? /^\s*\[tool\.sqlfluff/m.test(content) : /^\s*\[sqlfluff/m.test(content)),
  async build({ request, style, applyStyle, writeTemp }) {
    const args = ['format', '--nocolor', '--disable-progress-bar'];
    if (applyStyle) {
      args.push('--dialect', style.effectiveStr('sqlDialect') ?? 'ansi');
      if (!request.useProjectConfig) {
        args.push('--ignore-local-config');
      }
      const lines = ['[sqlfluff]'];
      if (style.num('lineLength') !== undefined) {
        lines.push(`max_line_length = ${style.num('lineLength')}`);
      }
      if (style.indentChosen) {
        lines.push('', '[sqlfluff:indentation]', `indent_unit = ${style.effectiveUseTabs ? 'tab' : 'space'}`);
        if (style.effectiveNum('indentSize') !== undefined) {
          lines.push(`tab_space_size = ${style.effectiveNum('indentSize')}`);
        }
      }
      if (lines.length > 1) {
        args.push('--config', await writeTemp('sqlfluff.cfg', `${lines.join('\n')}\n`));
      }
    }
    args.push('-');
    // Exit code 1 means "formatted, but some findings could not be fixed automatically".
    return [{ mode: 'stdin', args, okCodes: [0, 1] }];
  },
};

/** Taplo — https://taplo.tamasfe.dev/configuration/formatter-options.html */
export const taplo: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'taplo',
    displayName: 'Taplo',
    engine: 'Taplo',
    license: 'MIT',
    homepage: 'https://taplo.tamasfe.dev',
    languages: ['toml'],
    extensions: ['.toml'],
    requirement: 'The "taplo" executable.',
    executables: ['taplo'],
    install: {
      summary: 'Install Taplo with Cargo, Homebrew or npm.',
      commands: [
        { label: 'Homebrew', command: 'brew install taplo' },
        { label: 'Cargo', command: 'cargo install taplo-cli --locked' },
        { label: 'npm', command: 'npm install -g @taplo/cli' },
      ],
      url: 'https://taplo.tamasfe.dev/cli/installation/binary.html',
    },
    options: {
      lineLength: { native: 'column_width', support: 'full', default: 80, note: 'Arrays longer than this width are expanded onto several lines.' },
      indentStyle: { native: 'indent_string', support: 'full', default: 'spaces' },
      indentSize: { native: 'indent_string', support: 'full', default: 2 },
      maxBlankLines: { native: 'allowed_blank_lines', support: 'full', default: 2 },
      tomlAlignEntries: { native: 'align_entries', support: 'full', default: false },
      tomlReorderKeys: { native: 'reorder_keys', support: 'full', default: false },
    },
    lineLength: 'preferred',
    configFiles: ['taplo.toml', '.taplo.toml'],
  }),
  versionArgs: ['--version'],
  versionCheck: /taplo/i,
  localBin: ['node_modules/.bin/taplo'],
  build({ request, style, applyStyle }) {
    const args = ['format', '--colors', 'never'];
    if (applyStyle) {
      args.push('--no-auto-config');
      const option = (key: string, value: string | number | boolean | undefined): void => {
        if (value !== undefined) {
          args.push('--option', `${key}=${value}`);
        }
      };
      option('column_width', style.num('lineLength'));
      if (style.indentChosen) {
        option('indent_string', style.effectiveUseTabs ? '\t' : ' '.repeat(style.effectiveNum('indentSize') ?? 2));
      }
      option('allowed_blank_lines', style.num('maxBlankLines'));
      option('align_entries', style.bool('tomlAlignEntries'));
      option('reorder_keys', style.bool('tomlReorderKeys'));
    } else if (request.projectConfigFile) {
      args.push('--config', request.projectConfigFile);
    }
    args.push('-');
    return [{ mode: 'stdin', args }];
  },
};

/** terraform fmt — https://developer.hashicorp.com/terraform/cli/commands/fmt */
export const terraformFmt: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'terraform-fmt',
    displayName: 'terraform fmt',
    engine: 'terraform fmt (or OpenTofu)',
    license: 'BUSL-1.1 (Terraform) / MPL-2.0 (OpenTofu)',
    homepage: 'https://developer.hashicorp.com/terraform/cli/commands/fmt',
    languages: ['terraform'],
    extensions: ['.tf', '.tfvars'],
    requirement: 'The "terraform" or "tofu" executable.',
    executables: ['terraform', 'tofu'],
    install: {
      summary: 'Install Terraform or OpenTofu; both include the fmt command.',
      commands: [
        { label: 'Homebrew (Terraform)', command: 'brew install hashicorp/tap/terraform' },
        { label: 'Homebrew (OpenTofu)', command: 'brew install opentofu' },
        { label: 'winget', command: 'winget install Hashicorp.Terraform' },
        { label: 'Chocolatey', command: 'choco install terraform' },
      ],
      url: 'https://developer.hashicorp.com/terraform/install',
    },
    fixed: {
      indentStyle: fixed('spaces', 'terraform fmt always indents with 2 spaces.'),
      indentSize: fixed(2, 'terraform fmt always indents with 2 spaces.'),
      lineLength: fixed(0, 'terraform fmt never wraps lines.'),
    },
    lineLength: 'none',
    lineLengthNote: 'terraform fmt never wraps long lines.',
    limitations: [
      'terraform fmt implements the single canonical Terraform style and has no style options.',
      'Generic HCL files that are not Terraform configuration (.hcl) may be rejected by terraform fmt.',
    ],
  }),
  versionArgs: ['version'],
  versionCheck: /terraform|opentofu/i,
  build() {
    return [{ mode: 'stdin', args: ['fmt', '-no-color', '-'] }];
  },
};

/** buf format — https://buf.build/docs/reference/cli/buf/format/ */
export const buf: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'buf',
    displayName: 'buf format',
    engine: 'Buf',
    license: 'Apache-2.0',
    homepage: 'https://buf.build/docs/format/style/',
    languages: ['proto'],
    extensions: ['.proto'],
    requirement: 'The "buf" executable.',
    executables: ['buf'],
    install: {
      summary: 'Install the Buf command line tool.',
      commands: [
        { label: 'Homebrew', command: 'brew install bufbuild/buf/buf' },
        { label: 'npm', command: 'npm install -g @bufbuild/buf' },
      ],
      url: 'https://buf.build/docs/cli/installation/',
    },
    fixed: {
      indentStyle: fixed('spaces', 'buf format always indents with 2 spaces.'),
      indentSize: fixed(2, 'buf format always indents with 2 spaces.'),
      lineLength: fixed(0, 'buf format never wraps lines.'),
    },
    lineLength: 'none',
    lineLengthNote: 'buf format never wraps long lines.',
    limitations: [
      'buf format has no style options. Choose clang-format for Protocol Buffers if you need a configurable style.',
      'The file is formatted through a private temporary copy; your original is only changed through the editor.',
    ],
  }),
  versionArgs: ['--version'],
  localBin: ['node_modules/.bin/buf'],
  async build({ inputFile }) {
    return [{ mode: 'file', args: ['format', '--write', await inputFile()], cwdIsTemp: true }];
  },
};

/** latexindent — https://latexindentpl.readthedocs.io */
export const latexindent: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'latexindent',
    displayName: 'latexindent',
    engine: 'latexindent.pl',
    license: 'GPL-3.0',
    homepage: 'https://latexindentpl.readthedocs.io',
    languages: ['latex'],
    extensions: ['.tex', '.sty', '.cls', '.bib'],
    requirement: 'The "latexindent" executable (part of TeX Live and MiKTeX).',
    executables: ['latexindent', 'latexindent.pl'],
    install: {
      summary: 'latexindent is included in TeX Live and MiKTeX, and is also available from Homebrew.',
      commands: [
        { label: 'TeX Live', command: 'tlmgr install latexindent' },
        { label: 'Homebrew', command: 'brew install latexindent' },
      ],
      url: 'https://latexindentpl.readthedocs.io/en/latest/sec-how-to-use.html',
    },
    options: {
      indentStyle: { native: 'defaultIndent', support: 'full', default: 'tabs' },
      indentSize: { native: 'defaultIndent', support: 'full', default: 4, note: 'Only used when indenting with spaces.' },
    },
    fixed: {
      lineLength: fixed(0, 'CodeNeat does not enable latexindent\'s text wrapping, because re-wrapping paragraphs can change the meaning of a LaTeX document.'),
    },
    lineLength: 'none',
    lineLengthNote: 'Paragraph text is not re-wrapped.',
    configFiles: ['.latexindent.yaml', 'latexindent.yaml', '.localSettings.yaml', 'localSettings.yaml'],
    limitations: ['Only indentation is adjusted; line breaks are left exactly as written.'],
  }),
  versionArgs: ['--version'],
  versionOptional: true,
  async build({ request, style, applyStyle, inputFile }) {
    const args: string[] = [];
    if (applyStyle) {
      if (style.indentChosen) {
        const indent = style.effectiveUseTabs ? '\\t' : ' '.repeat(style.effectiveNum('indentSize') ?? 4);
        args.push(`-y=defaultIndent:"${indent}"`);
      }
    } else if (request.projectConfigFile) {
      args.push(`-l=${request.projectConfigFile}`);
    }
    // -g sends the log file to the private temporary directory instead of the project.
    args.push('-g=indent.log', await inputFile());
    return [{ mode: 'file-stdout', args, cwdIsTemp: true }];
  },
};

/** dockerfmt — https://github.com/reteps/dockerfmt */
export const dockerfmt: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'dockerfmt',
    displayName: 'dockerfmt',
    engine: 'dockerfmt',
    license: 'MIT',
    homepage: 'https://github.com/reteps/dockerfmt',
    languages: ['dockerfile'],
    extensions: ['.dockerfile'],
    requirement: 'The "dockerfmt" executable.',
    executables: ['dockerfmt'],
    install: {
      summary: 'Install dockerfmt with Homebrew or Go, or download a release binary.',
      commands: [
        { label: 'Homebrew', command: 'brew install dockerfmt' },
        { label: 'Go', command: 'go install github.com/reteps/dockerfmt@latest' },
      ],
      url: 'https://github.com/reteps/dockerfmt#installation',
    },
    options: {
      indentSize: { native: '--indent', support: 'full', default: 4, note: 'Indentation of continued lines.' },
      dockerfileSpaceRedirects: { native: '--space-redirects', support: 'full', default: false },
    },
    fixed: {
      indentStyle: fixed('spaces', 'dockerfmt always indents with spaces.'),
      lineLength: fixed(0, 'dockerfmt never wraps lines.'),
    },
    lineLength: 'none',
    lineLengthNote: 'dockerfmt never wraps long lines.',
    limitations: ['The file is formatted through a private temporary copy; your original is only changed through the editor.'],
  }),
  versionArgs: ['version'],
  versionOptional: true,
  async build({ style, applyStyle, inputFile }) {
    const args: string[] = [];
    if (applyStyle) {
      if (style.num('indentSize') !== undefined) {
        args.push('--indent', String(style.num('indentSize')));
      }
      if (style.bool('dockerfileSpaceRedirects')) {
        args.push('--space-redirects');
      }
    }
    args.push('--newline', await inputFile());
    return [{ mode: 'file-stdout', args, cwdIsTemp: true }];
  },
};
