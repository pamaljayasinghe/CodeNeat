import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AdapterEnvironment } from '../../core/adapter';
import { runTool } from '../../core/process';
import type { ExternalSpec } from '../external';
import { externalDescriptor, fixed } from '../toolkit';

/** PHP-CS-Fixer — https://cs.symfony.com/doc/usage.html */
export const phpCsFixer: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'php-cs-fixer',
    displayName: 'PHP-CS-Fixer',
    engine: 'PHP-CS-Fixer',
    license: 'MIT',
    homepage: 'https://cs.symfony.com',
    languages: ['php'],
    extensions: ['.php'],
    requirement: 'The "php-cs-fixer" executable (needs PHP).',
    executables: ['php-cs-fixer'],
    install: {
      summary: 'Install PHP-CS-Fixer with Composer or Homebrew.',
      commands: [
        { label: 'Composer (project)', command: 'composer require --dev friendsofphp/php-cs-fixer' },
        { label: 'Homebrew', command: 'brew install php-cs-fixer' },
      ],
      url: 'https://cs.symfony.com/doc/installation.html',
    },
    options: {
      phpRuleSet: { native: '--rules', support: 'full', default: '@PSR12' },
      quoteStyle: {
        native: 'single_quote rule',
        support: 'partial',
        default: 'preserve',
        values: ['single', 'preserve'],
        note: 'Can convert simple double-quoted strings to single quotes, or leave quotes as written.',
      },
      sortImports: { native: 'ordered_imports rule', support: 'full', default: false },
      removeUnusedImports: { native: 'no_unused_imports rule', support: 'full', default: false },
    },
    fixed: {
      lineLength: fixed(0, 'PHP-CS-Fixer does not wrap lines to a width.'),
    },
    lineLength: 'none',
    lineLengthNote: 'PHP-CS-Fixer does not wrap long lines.',
    configFiles: ['.php-cs-fixer.php', '.php-cs-fixer.dist.php'],
    limitations: [
      'Indentation (4 spaces) can only be changed in a .php-cs-fixer.php file.',
      'The file is fixed through a private temporary copy; your original is only changed through the editor.',
    ],
  }),
  versionArgs: ['--version'],
  versionCheck: /fixer/i,
  localBin: ['vendor/bin/php-cs-fixer', 'tools/php-cs-fixer/vendor/bin/php-cs-fixer'],
  async build({ request, style, applyStyle, inputFile }) {
    const args = ['fix', '--using-cache=no', '--quiet', '--no-interaction'];
    if (!applyStyle && request.projectConfigFile) {
      args.push(`--config=${request.projectConfigFile}`);
    } else {
      const rules: Record<string, boolean> = { [style.effectiveStr('phpRuleSet') ?? '@PSR12']: true };
      if (style.str('quoteStyle') === 'single') {
        rules.single_quote = true;
      }
      if (style.bool('sortImports')) {
        rules.ordered_imports = true;
      }
      if (style.bool('removeUnusedImports')) {
        rules.no_unused_imports = true;
      }
      args.push(`--rules=${JSON.stringify(rules)}`);
    }
    args.push(await inputFile());
    return [{ mode: 'file', args, cwdIsTemp: applyStyle, env: { PHP_CS_FIXER_IGNORE_ENV: '1' } }];
  },
};

/** RuboCop — https://docs.rubocop.org/rubocop/usage/basic_usage.html */
export const rubocop: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'rubocop',
    displayName: 'RuboCop',
    engine: 'RuboCop (layout cops)',
    license: 'MIT',
    homepage: 'https://docs.rubocop.org',
    languages: ['ruby'],
    extensions: ['.rb', '.rake', '.gemspec'],
    requirement: 'The "rubocop" executable (needs Ruby).',
    executables: ['rubocop'],
    install: {
      summary: 'Install RuboCop as a Ruby gem.',
      commands: [{ label: 'gem', command: 'gem install rubocop' }],
      url: 'https://docs.rubocop.org/rubocop/installation.html',
    },
    options: {
      lineLength: {
        native: 'Layout/LineLength Max',
        support: 'partial',
        default: 120,
        note: 'RuboCop can only shorten some constructs (argument lists, hashes, arrays); other long lines are left as they are.',
      },
      indentStyle: { native: 'Layout/IndentationStyle', support: 'full', default: 'spaces' },
      indentSize: { native: 'Layout/IndentationWidth', support: 'full', default: 2 },
    },
    lineLength: 'preferred',
    configFiles: ['.rubocop.yml'],
    limitations: [
      'Only RuboCop\'s layout cops are auto-corrected (rubocop -x), so code is re-laid-out but never rewritten.',
      'Quote style is a RuboCop "Style" cop rather than layout, so it is not changed.',
    ],
  }),
  versionArgs: ['--version'],
  async build({ request, style, applyStyle, writeTemp }) {
    const args = ['--stdin', request.filePath ?? request.fileName, '--fix-layout', '--stderr', '--format', 'quiet', '--fail-level', 'fatal'];
    if (applyStyle) {
      const lines = ['AllCops:', '  NewCops: disable', '  SuggestExtensions: false'];
      if (style.num('lineLength') !== undefined) {
        lines.push('Layout/LineLength:', `  Max: ${style.num('lineLength')}`);
      }
      if (style.num('indentSize') !== undefined) {
        lines.push('Layout/IndentationWidth:', `  Width: ${style.num('indentSize')}`);
      }
      if (style.useTabs !== undefined) {
        lines.push('Layout/IndentationStyle:', `  EnforcedStyle: ${style.useTabs ? 'tabs' : 'spaces'}`);
      }
      args.push('--config', await writeTemp('rubocop.yml', `${lines.join('\n')}\n`));
    }
    // Exit code 1 means offenses remain that layout auto-correction does not handle.
    return [{ mode: 'stdin', args, okCodes: [0, 1] }];
  },
};

/** StyLua — https://github.com/JohnnyMorganz/StyLua#options */
export const stylua: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'stylua',
    displayName: 'StyLua',
    engine: 'StyLua',
    license: 'MPL-2.0',
    homepage: 'https://github.com/JohnnyMorganz/StyLua',
    languages: ['lua'],
    extensions: ['.lua', '.luau'],
    requirement: 'The "stylua" executable.',
    executables: ['stylua'],
    install: {
      summary: 'Install StyLua with Cargo, Homebrew or npm.',
      commands: [
        { label: 'Homebrew', command: 'brew install stylua' },
        { label: 'Cargo', command: 'cargo install stylua' },
        { label: 'npm (project)', command: 'npm install --save-dev @johnnymorganz/stylua-bin' },
      ],
      url: 'https://github.com/JohnnyMorganz/StyLua#installation',
    },
    options: {
      lineLength: { native: '--column-width', support: 'full', default: 120, note: 'StyLua aims for this width; it is a guide rather than a hard limit.' },
      indentStyle: { native: '--indent-type', support: 'full', default: 'tabs' },
      indentSize: { native: '--indent-width', support: 'full', default: 4 },
      quoteStyle: { native: '--quote-style', support: 'full', default: 'double', values: ['double', 'single'] },
      luaCallParentheses: { native: '--call-parentheses', support: 'full', default: 'Always' },
    },
    lineLength: 'preferred',
    rangeLanguages: ['lua'],
    configFiles: ['stylua.toml', '.stylua.toml'],
  }),
  versionArgs: ['--version'],
  versionCheck: /stylua/i,
  localBin: ['node_modules/.bin/stylua'],
  build({ request, style, applyStyle, byteRange }) {
    const args: string[] = [];
    if (applyStyle) {
      args.push('--no-editorconfig');
      if (style.num('lineLength') !== undefined) {
        args.push('--column-width', String(style.num('lineLength')));
      }
      if (style.useTabs !== undefined) {
        args.push('--indent-type', style.useTabs ? 'Tabs' : 'Spaces');
      }
      if (style.num('indentSize') !== undefined) {
        args.push('--indent-width', String(style.num('indentSize')));
      }
      const quotes = style.str('quoteStyle');
      if (quotes === 'single' || quotes === 'double') {
        args.push('--quote-style', quotes === 'single' ? 'AutoPreferSingle' : 'AutoPreferDouble');
      }
      if (style.str('luaCallParentheses')) {
        args.push('--call-parentheses', style.str('luaCallParentheses') as string);
      }
    } else {
      args.push('--search-parent-directories');
    }
    if (byteRange) {
      args.push('--range-start', String(byteRange.start), '--range-end', String(byteRange.end));
    }
    args.push('--stdin-filepath', request.filePath ?? request.fileName, '-');
    return [{ mode: 'stdin', args }];
  },
};

/** shfmt — https://github.com/mvdan/sh/blob/master/cmd/shfmt/shfmt.1.scd */
export const shfmt: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'shfmt',
    displayName: 'shfmt',
    engine: 'shfmt (mvdan/sh)',
    license: 'BSD-3-Clause',
    homepage: 'https://github.com/mvdan/sh',
    languages: ['shellscript'],
    extensions: ['.sh', '.bash', '.bats'],
    requirement: 'The "shfmt" executable.',
    executables: ['shfmt'],
    install: {
      summary: 'Install shfmt with Homebrew, Go, or your package manager.',
      commands: [
        { label: 'Homebrew', command: 'brew install shfmt' },
        { label: 'Go', command: 'go install mvdan.cc/sh/v3/cmd/shfmt@latest' },
        { label: 'Scoop', command: 'scoop install shfmt' },
        { label: 'apt', command: 'sudo apt install shfmt' },
      ],
      url: 'https://github.com/mvdan/sh#shfmt',
    },
    options: {
      indentStyle: { native: '-i (0 = tabs)', support: 'full', default: 'tabs' },
      indentSize: { native: '-i', support: 'full', default: 4, note: 'Only used when indenting with spaces.' },
      indentCaseLabels: { native: '-ci', support: 'full', default: false },
      operatorLinePosition: { native: '-bn', support: 'full', default: 'end', note: 'Applies to && and | at line breaks.' },
      shellDialect: { native: '-ln', support: 'full', default: 'auto' },
      shellSpaceRedirects: { native: '-sr', support: 'full', default: false },
      shellFunctionNextLine: { native: '-fn', support: 'full', default: false },
    },
    fixed: {
      lineLength: fixed(0, 'shfmt never wraps lines and has no line-length setting.'),
    },
    lineLength: 'none',
    lineLengthNote: 'shfmt never wraps long lines.',
    limitations: ['zsh-specific syntax is not supported by shfmt.'],
  }),
  versionArgs: ['--version'],
  build({ request, style, applyStyle }) {
    const args = ['-filename', request.filePath ?? request.fileName];
    if (applyStyle) {
      if (style.indentChosen) {
        args.push('-i', style.effectiveUseTabs ? '0' : String(style.effectiveNum('indentSize') ?? 4));
      }
      if (style.bool('indentCaseLabels')) {
        args.push('-ci');
      }
      if (style.str('operatorLinePosition') === 'start') {
        args.push('-bn');
      }
      const dialect = style.str('shellDialect');
      if (dialect && dialect !== 'auto') {
        args.push('-ln', dialect);
      }
      if (style.bool('shellSpaceRedirects')) {
        args.push('-sr');
      }
      if (style.bool('shellFunctionNextLine')) {
        args.push('-fn');
      }
    }
    return [{ mode: 'stdin', args }];
  },
};

const POWERSHELL_FLAGS = ['-NoLogo', '-NoProfile', '-NonInteractive'];

/**
 * Constant script: the source arrives on standard input and preferences through environment
 * variables, so no user-controlled text is ever placed inside the command.
 */
const POWERSHELL_FORMAT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$utf8 = New-Object System.Text.UTF8Encoding $false',
  '[Console]::InputEncoding = $utf8',
  '[Console]::OutputEncoding = $utf8',
  '$source = [Console]::In.ReadToEnd()',
  "$brace = $env:CODENEAT_BRACE; if (-not $brace) { $brace = 'attach' }",
  "$kind = $env:CODENEAT_INDENT_KIND; if (-not $kind) { $kind = 'space' }",
  '$size = 4; if ($env:CODENEAT_INDENT_SIZE) { $size = [int]$env:CODENEAT_INDENT_SIZE }',
  '$settings = @{',
  "  IncludeRules = @('PSPlaceOpenBrace','PSPlaceCloseBrace','PSUseConsistentWhitespace','PSUseConsistentIndentation','PSAlignAssignmentStatement','PSUseCorrectCasing')",
  '  Rules = @{',
  "    PSPlaceOpenBrace = @{ Enable = $true; OnSameLine = ($brace -ne 'allman'); NewLineAfter = $true; IgnoreOneLineBlock = $true }",
  "    PSPlaceCloseBrace = @{ Enable = $true; NewLineAfter = ($brace -ne 'attach'); IgnoreOneLineBlock = $true; NoEmptyLineBefore = $false }",
  "    PSUseConsistentIndentation = @{ Enable = $true; Kind = $kind; IndentationSize = $size; PipelineIndentation = 'IncreaseIndentationForFirstPipeline' }",
  '    PSUseConsistentWhitespace = @{ Enable = $true; CheckOpenBrace = $true; CheckOpenParen = $true; CheckOperator = $true; CheckPipe = $true; CheckSeparator = $true }',
  '    PSAlignAssignmentStatement = @{ Enable = $false }',
  '    PSUseCorrectCasing = @{ Enable = $false }',
  '  }',
  '}',
  '[Console]::Out.Write((Invoke-Formatter -ScriptDefinition $source -Settings $settings))',
].join('\n');

const POWERSHELL_PROBE_SCRIPT =
  "$m = Get-Module -ListAvailable -Name PSScriptAnalyzer | Sort-Object Version -Descending | Select-Object -First 1; if ($m) { [Console]::Out.Write($m.Version.ToString()) }";

/** PSScriptAnalyzer Invoke-Formatter — https://learn.microsoft.com/powershell/module/psscriptanalyzer/invoke-formatter */
export const psScriptAnalyzer: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'psscriptanalyzer',
    displayName: 'PSScriptAnalyzer',
    engine: 'PSScriptAnalyzer (Invoke-Formatter)',
    license: 'MIT',
    homepage: 'https://github.com/PowerShell/PSScriptAnalyzer',
    languages: ['powershell'],
    extensions: ['.ps1', '.psm1', '.psd1'],
    requirement: 'PowerShell ("pwsh" or Windows PowerShell) with the PSScriptAnalyzer module.',
    executables: ['pwsh', 'powershell'],
    install: {
      summary: 'Install PowerShell, then add the PSScriptAnalyzer module.',
      commands: [{ label: 'PowerShell', command: 'Install-Module -Name PSScriptAnalyzer -Scope CurrentUser' }],
      url: 'https://learn.microsoft.com/powershell/utility-modules/psscriptanalyzer/overview',
    },
    options: {
      indentStyle: { native: 'PSUseConsistentIndentation.Kind', support: 'full', default: 'spaces' },
      indentSize: { native: 'PSUseConsistentIndentation.IndentationSize', support: 'full', default: 4 },
      braceStyle: {
        native: 'PSPlaceOpenBrace / PSPlaceCloseBrace',
        support: 'full',
        default: 'attach',
        values: ['attach', 'allman', 'stroustrup'],
      },
    },
    fixed: {
      lineLength: fixed(0, 'The PowerShell formatter does not wrap long lines.'),
    },
    lineLength: 'none',
    lineLengthNote: 'The PowerShell formatter does not wrap long lines.',
    limitations: ['Starting PowerShell takes a moment, so formatting is slower than for other languages.'],
  }),
  versionArgs: [],
  async probe(exe: string, _env: AdapterEnvironment) {
    const result = await runTool(exe, [...POWERSHELL_FLAGS, '-Command', POWERSHELL_PROBE_SCRIPT], { timeoutMs: 20000 });
    const version = result.stdout.trim();
    if (result.code !== 0 || !version) {
      return {
        problem:
          'PowerShell was found, but its PSScriptAnalyzer module is not installed. Run "Install-Module -Name PSScriptAnalyzer -Scope CurrentUser" in PowerShell.',
      };
    }
    return { version };
  },
  build({ style, applyStyle }) {
    const env: Record<string, string> = {};
    if (applyStyle) {
      if (style.indentChosen) {
        env.CODENEAT_INDENT_KIND = style.effectiveUseTabs ? 'tab' : 'space';
        env.CODENEAT_INDENT_SIZE = String(style.effectiveNum('indentSize') ?? 4);
      }
      const brace = style.str('braceStyle');
      if (brace) {
        env.CODENEAT_BRACE = brace;
      }
    }
    return [{ mode: 'stdin', args: [...POWERSHELL_FLAGS, '-Command', POWERSHELL_FORMAT_SCRIPT], env }];
  },
};

const R_FORMAT_EXPRESSION = [
  'input <- readLines(file("stdin"), warn = FALSE, encoding = "UTF-8")',
  'indent <- suppressWarnings(as.integer(Sys.getenv("CODENEAT_INDENT_SIZE", "2")))',
  'if (is.na(indent)) indent <- 2L',
  'output <- styler::style_text(input, indent_by = indent)',
  'writeLines(enc2utf8(as.character(output)), useBytes = TRUE)',
].join('; ');

/** styler — https://styler.r-lib.org */
export const styler: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'styler',
    displayName: 'styler',
    engine: 'styler (tidyverse style)',
    license: 'MIT',
    homepage: 'https://styler.r-lib.org',
    languages: ['r'],
    extensions: ['.r', '.R'],
    requirement: 'R ("Rscript") with the styler package.',
    executables: ['Rscript'],
    install: {
      summary: 'Install R, then add the styler package.',
      commands: [{ label: 'R', command: 'install.packages("styler")' }],
      url: 'https://styler.r-lib.org',
    },
    options: {
      indentSize: { native: 'indent_by', support: 'full', default: 2 },
    },
    fixed: {
      indentStyle: fixed('spaces', 'styler always indents with spaces.'),
      lineLength: fixed(0, 'styler does not wrap lines to a width.'),
    },
    lineLength: 'none',
    lineLengthNote: 'styler does not wrap long lines.',
    limitations: ['Starting R takes a moment, so formatting is slower than for other languages.'],
  }),
  versionArgs: [],
  async probe(exe: string) {
    const result = await runTool(exe, ['--vanilla', '-e', 'cat(as.character(utils::packageVersion("styler")))'], { timeoutMs: 20000 });
    const version = result.stdout.trim();
    if (result.code !== 0 || !version) {
      return { problem: 'R was found, but the styler package is not installed. Run install.packages("styler") in R.' };
    }
    return { version };
  },
  build({ style, applyStyle }) {
    const env: Record<string, string> = {};
    if (applyStyle && style.num('indentSize') !== undefined) {
      env.CODENEAT_INDENT_SIZE = String(style.num('indentSize'));
    }
    return [{ mode: 'stdin', args: ['--vanilla', '-e', R_FORMAT_EXPRESSION], env }];
  },
};

/** Air — https://posit-dev.github.io/air/configuration.html */
export const air: ExternalSpec = {
  descriptor: externalDescriptor({
    id: 'air',
    displayName: 'Air',
    engine: 'Air (Posit)',
    license: 'MIT',
    homepage: 'https://posit-dev.github.io/air/',
    languages: ['r'],
    extensions: ['.r', '.R'],
    requirement: 'The "air" executable.',
    executables: ['air'],
    install: {
      summary: 'Install the Air command line tool from Posit.',
      commands: [
        { label: 'Homebrew', command: 'brew install air' },
        { label: 'macOS / Linux', command: 'curl -LsSf https://github.com/posit-dev/air/releases/latest/download/air-installer.sh | sh' },
        { label: 'Windows', command: 'powershell -ExecutionPolicy Bypass -c "irm https://github.com/posit-dev/air/releases/latest/download/air-installer.ps1 | iex"' },
      ],
      url: 'https://posit-dev.github.io/air/cli.html',
    },
    options: {
      lineLength: { native: 'line-width', support: 'full', default: 80, note: 'Air aims for this width; it is not a hard limit.' },
      indentStyle: { native: 'indent-style', support: 'full', default: 'spaces' },
      indentSize: { native: 'indent-width', support: 'full', default: 2 },
    },
    lineLength: 'preferred',
    configFiles: ['air.toml', '.air.toml'],
    limitations: ['The file is formatted through a private temporary copy; your original is only changed through the editor.'],
  }),
  versionArgs: ['--version'],
  versionCheck: /air/i,
  async build({ request, style, applyStyle, inputFile, writeTemp }) {
    if (!applyStyle && request.projectConfigFile) {
      await writeTemp(path.basename(request.projectConfigFile), await fs.promises.readFile(request.projectConfigFile, 'utf8'));
    } else {
      const lines = ['[format]'];
      if (style.num('lineLength') !== undefined) {
        lines.push(`line-width = ${style.num('lineLength')}`);
      }
      if (style.num('indentSize') !== undefined) {
        lines.push(`indent-width = ${style.num('indentSize')}`);
      }
      if (style.useTabs !== undefined) {
        lines.push(`indent-style = "${style.useTabs ? 'tab' : 'space'}"`);
      }
      await writeTemp('air.toml', `${lines.join('\n')}\n`);
    }
    return [{ mode: 'file', args: ['format', await inputFile()], cwdIsTemp: true }];
  },
};
