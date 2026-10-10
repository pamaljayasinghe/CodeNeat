import * as vscode from 'vscode';
import type { CodeNeatApp } from './app';

/** Longest time an on-type request may take before it is abandoned. */
const ON_TYPE_TIMEOUT_MS = 1500;

class CodeNeatFormattingProvider
  implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider, vscode.OnTypeFormattingEditProvider
{
  /** Documents with an on-type request in flight; prevents overlapping (and looping) edits. */
  private readonly busy = new Set<string>();

  constructor(private readonly app: CodeNeatApp) {}

  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    return this.run(document, undefined, token);
  }

  async provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    // An "empty" or whole-document range is simply a document format.
    const whole = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    return this.run(document, range.isEmpty || range.isEqual(whole) ? undefined : range, token);
  }

  async provideOnTypeFormattingEdits(
    document: vscode.TextDocument,
    _position: vscode.Position,
    _character: string,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    const key = document.uri.toString();
    const settings = this.app.config.read(document.uri);
    if (!settings.enabled || !settings.codeneatFormatOnType || this.busy.has(key)) {
      return [];
    }
    const input = this.app.toInput(document);
    if (!input) {
      return [];
    }
    this.busy.add(key);
    try {
      const formatting = { ...this.app.config.formattingSettings(document.uri) };
      formatting.timeoutMs = Math.min(formatting.timeoutMs, ON_TYPE_TIMEOUT_MS);
      // Only in-process formatters are fast enough to run on every closing brace or semicolon.
      const plan = await this.app.service.plan(input, formatting).catch(() => undefined);
      if (!plan || plan.descriptor.kind !== 'bundled' || token.isCancellationRequested) {
        return [];
      }
      // Problems while typing (half-written code is rarely valid) are expected and stay silent.
      const { result } = await this.app.format(input, formatting, token, plan.descriptor.id, false);
      if (!result || !result.changed || token.isCancellationRequested || document.getText() !== input.text) {
        return [];
      }
      return this.app.toEdits(document, input.text, result.text);
    } finally {
      this.busy.delete(key);
    }
  }

  private async run(document: vscode.TextDocument, range: vscode.Range | undefined, token: vscode.CancellationToken): Promise<vscode.TextEdit[]> {
    if (!this.app.config.read(document.uri).enabled) {
      return [];
    }
    const original = document.getText();
    const { result, error } = await this.app.formatDocument(document, range, token);
    if (error) {
      void this.app.reportError(error, document.uri.toString(), true);
      return [];
    }
    if (!result || !result.changed || token.isCancellationRequested) {
      return [];
    }
    return this.app.toEdits(document, original, result.text);
  }
}

function selectorFor(languages: { vscodeIds: string[]; extensions: string[]; filenames?: string[] }[]): vscode.DocumentFilter[] {
  const filters: vscode.DocumentFilter[] = [];
  const seenLanguages = new Set<string>();
  const seenPatterns = new Set<string>();
  for (const language of languages) {
    for (const id of language.vscodeIds) {
      if (!seenLanguages.has(id)) {
        seenLanguages.add(id);
        filters.push({ language: id });
      }
    }
    // File-name patterns cover languages VS Code has no built-in grammar for (TOML, Vue, Kotlin…).
    const patterns = [
      ...language.extensions.map((extension) => `**/*${extension}`),
      ...(language.filenames ?? []).flatMap((name) => [`**/${name}`, `**/${name}.*`]),
    ];
    for (const pattern of patterns) {
      if (!seenPatterns.has(pattern)) {
        seenPatterns.add(pattern);
        filters.push({ pattern });
      }
    }
  }
  return filters;
}

/**
 * Registers CodeNeat with VS Code's native formatting system (Format Document, Format Selection,
 * Format on Save / Paste / Type). Returns a disposable that removes the registration again.
 */
export function registerProviders(app: CodeNeatApp): vscode.Disposable {
  const provider = new CodeNeatFormattingProvider(app);
  const languages = app.registry.languages.filter((language) => language.formatters.length > 0);
  const rangeLanguageIds = new Set(app.registry.descriptors.flatMap((descriptor) => descriptor.rangeLanguages));
  const rangeLanguages = languages.filter((language) => rangeLanguageIds.has(language.id));
  const onTypeLanguageIds = new Set(
    app.registry.descriptors.filter((descriptor) => descriptor.kind === 'bundled').flatMap((descriptor) => descriptor.languages),
  );
  const onTypeLanguages = languages.filter((language) => onTypeLanguageIds.has(language.id));

  return vscode.Disposable.from(
    vscode.languages.registerDocumentFormattingEditProvider(selectorFor(languages), provider),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selectorFor(rangeLanguages), provider),
    vscode.languages.registerOnTypeFormattingEditProvider(selectorFor(onTypeLanguages), provider, '}', ';'),
  );
}
