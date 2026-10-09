import type { LanguageDefinition } from './types';

/**
 * Every language CodeNeat advertises. `formatters` lists formatter ids in order of preference;
 * the first one that is actually available is used unless the user picks another.
 */
export const LANGUAGES: LanguageDefinition[] = [
  // Web
  { id: 'html', label: 'HTML', group: 'Web', vscodeIds: ['html'], extensions: ['.html', '.htm'], highlight: 'xml', formatters: ['prettier'] },
  { id: 'css', label: 'CSS', group: 'Web', vscodeIds: ['css', 'postcss'], extensions: ['.css', '.pcss'], highlight: 'css', formatters: ['prettier'] },
  { id: 'scss', label: 'SCSS', group: 'Web', vscodeIds: ['scss'], extensions: ['.scss'], highlight: 'scss', formatters: ['prettier'] },
  { id: 'less', label: 'Less', group: 'Web', vscodeIds: ['less'], extensions: ['.less'], highlight: 'less', formatters: ['prettier'] },
  { id: 'javascript', label: 'JavaScript', group: 'Web', vscodeIds: ['javascript'], extensions: ['.js', '.mjs', '.cjs'], highlight: 'javascript', formatters: ['prettier'] },
  { id: 'typescript', label: 'TypeScript', group: 'Web', vscodeIds: ['typescript'], extensions: ['.ts', '.mts', '.cts'], highlight: 'typescript', formatters: ['prettier'] },
  { id: 'javascriptreact', label: 'JSX', group: 'Web', vscodeIds: ['javascriptreact'], extensions: ['.jsx'], highlight: 'javascript', formatters: ['prettier'] },
  { id: 'typescriptreact', label: 'TSX', group: 'Web', vscodeIds: ['typescriptreact'], extensions: ['.tsx'], highlight: 'typescript', formatters: ['prettier'] },
  { id: 'json', label: 'JSON', group: 'Web', vscodeIds: ['json'], extensions: ['.json'], highlight: 'json', formatters: ['prettier'] },
  { id: 'jsonc', label: 'JSON with Comments', group: 'Web', vscodeIds: ['jsonc'], extensions: ['.jsonc'], highlight: 'json', formatters: ['prettier'] },
  { id: 'yaml', label: 'YAML', group: 'Web', vscodeIds: ['yaml', 'dockercompose', 'github-actions-workflow'], extensions: ['.yaml', '.yml'], highlight: 'yaml', formatters: ['prettier'] },
  { id: 'markdown', label: 'Markdown', group: 'Web', vscodeIds: ['markdown'], extensions: ['.md', '.markdown'], highlight: 'markdown', formatters: ['prettier'] },
  { id: 'mdx', label: 'MDX', group: 'Web', vscodeIds: ['mdx'], extensions: ['.mdx'], highlight: 'markdown', formatters: ['prettier'] },
  { id: 'vue', label: 'Vue', group: 'Web', vscodeIds: ['vue'], extensions: ['.vue'], highlight: 'xml', formatters: ['prettier'] },
  { id: 'angular', label: 'Angular Template', group: 'Web', vscodeIds: ['angular-html', 'ng-template'], extensions: ['.component.html'], highlight: 'xml', formatters: ['prettier'] },
  { id: 'graphql', label: 'GraphQL', group: 'Web', vscodeIds: ['graphql'], extensions: ['.graphql', '.gql'], highlight: 'graphql', formatters: ['prettier'] },
  { id: 'xml', label: 'XML', group: 'Web', vscodeIds: ['xml', 'xsl'], extensions: ['.xml', '.xsd', '.xsl', '.xslt', '.svg', '.plist', '.wsdl'], highlight: 'xml', formatters: ['prettier-xml'] },

  // Backend and general purpose
  { id: 'java', label: 'Java', group: 'Backend', vscodeIds: ['java'], extensions: ['.java'], highlight: 'java', formatters: ['prettier-java', 'google-java-format', 'clang-format-wasm'] },
  { id: 'python', label: 'Python', group: 'Backend', vscodeIds: ['python'], extensions: ['.py', '.pyi'], highlight: 'python', formatters: ['ruff', 'black', 'ruff-wasm'] },
  { id: 'c', label: 'C', group: 'Backend', vscodeIds: ['c'], extensions: ['.c', '.h'], highlight: 'c', formatters: ['clang-format', 'clang-format-wasm'] },
  { id: 'cpp', label: 'C++', group: 'Backend', vscodeIds: ['cpp', 'cuda-cpp'], extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'], highlight: 'cpp', formatters: ['clang-format', 'clang-format-wasm'] },
  { id: 'csharp', label: 'C#', group: 'Backend', vscodeIds: ['csharp'], extensions: ['.cs'], highlight: 'csharp', formatters: ['csharpier', 'clang-format-wasm'] },
  { id: 'fsharp', label: 'F#', group: 'Backend', vscodeIds: ['fsharp'], extensions: ['.fs', '.fsi', '.fsx'], highlight: 'fsharp', formatters: ['fantomas'] },
  { id: 'php', label: 'PHP', group: 'Backend', vscodeIds: ['php'], extensions: ['.php'], highlight: 'php', formatters: ['php-cs-fixer', 'prettier-php'] },
  { id: 'ruby', label: 'Ruby', group: 'Backend', vscodeIds: ['ruby'], extensions: ['.rb', '.rake', '.gemspec'], filenames: ['Rakefile', 'Gemfile'], highlight: 'ruby', formatters: ['rubocop'] },
  { id: 'go', label: 'Go', group: 'Backend', vscodeIds: ['go'], extensions: ['.go'], highlight: 'go', formatters: ['gofmt', 'gofmt-wasm'] },
  { id: 'rust', label: 'Rust', group: 'Backend', vscodeIds: ['rust'], extensions: ['.rs'], highlight: 'rust', formatters: ['rustfmt'] },
  { id: 'kotlin', label: 'Kotlin', group: 'Backend', vscodeIds: ['kotlin', 'kotlinscript'], extensions: ['.kt', '.kts'], highlight: 'kotlin', formatters: ['ktfmt', 'ktlint'] },
  { id: 'scala', label: 'Scala', group: 'Backend', vscodeIds: ['scala'], extensions: ['.scala', '.sc', '.sbt'], highlight: 'scala', formatters: ['scalafmt'] },
  { id: 'swift', label: 'Swift', group: 'Backend', vscodeIds: ['swift'], extensions: ['.swift'], highlight: 'swift', formatters: ['swift-format'] },
  { id: 'dart', label: 'Dart', group: 'Backend', vscodeIds: ['dart'], extensions: ['.dart'], highlight: 'dart', formatters: ['dart-format', 'dart-format-wasm'] },

  // Scripting and data formats
  { id: 'shellscript', label: 'Bash / Shell', group: 'Scripting and data', vscodeIds: ['shellscript'], extensions: ['.sh', '.bash', '.bats'], highlight: 'bash', formatters: ['shfmt', 'shfmt-wasm'] },
  { id: 'powershell', label: 'PowerShell', group: 'Scripting and data', vscodeIds: ['powershell'], extensions: ['.ps1', '.psm1', '.psd1'], highlight: 'powershell', formatters: ['psscriptanalyzer'] },
  { id: 'lua', label: 'Lua', group: 'Scripting and data', vscodeIds: ['lua'], extensions: ['.lua'], highlight: 'lua', formatters: ['stylua', 'stylua-wasm'] },
  { id: 'r', label: 'R', group: 'Scripting and data', vscodeIds: ['r'], extensions: ['.r', '.R'], highlight: 'r', formatters: ['air', 'styler'] },
  { id: 'sql', label: 'SQL', group: 'Scripting and data', vscodeIds: ['sql', 'postgres', 'mysql'], extensions: ['.sql'], highlight: 'sql', formatters: ['sql-formatter', 'sqlfluff'] },
  { id: 'toml', label: 'TOML', group: 'Scripting and data', vscodeIds: ['toml'], extensions: ['.toml'], highlight: 'ini', formatters: ['prettier-toml', 'taplo'] },
  { id: 'dockerfile', label: 'Dockerfile', group: 'Scripting and data', vscodeIds: ['dockerfile'], extensions: ['.dockerfile'], filenames: ['Dockerfile', 'Containerfile'], highlight: 'dockerfile', formatters: ['dockerfmt', 'dockerfmt-wasm'] },
  { id: 'terraform', label: 'Terraform / HCL', group: 'Scripting and data', vscodeIds: ['terraform', 'terraform-vars', 'hcl'], extensions: ['.tf', '.tfvars', '.hcl'], highlight: 'ini', formatters: ['terraform-fmt'] },
  { id: 'proto', label: 'Protocol Buffers', group: 'Scripting and data', vscodeIds: ['proto3', 'proto', 'protobuf'], extensions: ['.proto'], highlight: 'protobuf', formatters: ['buf', 'clang-format', 'clang-format-wasm'] },
  { id: 'latex', label: 'LaTeX', group: 'Scripting and data', vscodeIds: ['latex', 'tex'], extensions: ['.tex', '.sty', '.cls'], highlight: 'latex', formatters: ['latexindent', 'prettier-latex'] },
];

const BY_ID = new Map(LANGUAGES.map((language) => [language.id, language]));
const BY_VSCODE_ID = new Map<string, LanguageDefinition>();
for (const language of LANGUAGES) {
  for (const id of language.vscodeIds) {
    BY_VSCODE_ID.set(id, language);
  }
}

export function getLanguage(id: string): LanguageDefinition | undefined {
  return BY_ID.get(id);
}

function baseName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

/** Finds the language whose (longest) extension or exact file name matches. */
export function languageFromFileName(
  fileName: string,
  languages: LanguageDefinition[] = LANGUAGES,
): LanguageDefinition | undefined {
  const name = baseName(fileName);
  const lower = name.toLowerCase();
  let best: { language: LanguageDefinition; length: number } | undefined;
  for (const language of languages) {
    if (language.filenames?.some((candidate) => candidate === name || lower.startsWith(candidate.toLowerCase() + '.'))) {
      return language;
    }
    for (const extension of language.extensions) {
      const matches = extension === '.R' ? name.endsWith('.R') : lower.endsWith(extension.toLowerCase());
      if (matches && name.length > extension.length && (!best || extension.length > best.length)) {
        best = { language, length: extension.length };
      }
    }
  }
  return best?.language;
}

/**
 * Maps a VS Code document to a CodeNeat language. The VS Code language identifier wins; the file
 * name is used to refine it (Angular templates) or as a fallback when VS Code has no grammar for
 * the file (for example TOML without a TOML extension installed).
 */
export function detectLanguage(
  vscodeLanguageId: string,
  fileName: string,
  languages: LanguageDefinition[] = LANGUAGES,
): LanguageDefinition | undefined {
  const byName = languageFromFileName(fileName, languages);
  if (vscodeLanguageId === 'html' && byName?.id === 'angular') {
    return byName;
  }
  const direct = languages === LANGUAGES ? BY_VSCODE_ID.get(vscodeLanguageId) : languages.find((l) => l.vscodeIds.includes(vscodeLanguageId));
  if (direct) {
    return direct;
  }
  return byName;
}
