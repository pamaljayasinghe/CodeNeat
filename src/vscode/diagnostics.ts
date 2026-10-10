import * as os from 'node:os';
import * as vscode from 'vscode';
import { PRECEDENCE, sourceLabel } from '../shared/resolve';
import { getOption } from '../shared/catalog';
import type { CodeNeatApp } from './app';
import { EXTENSION_ID } from './configuration';

function row(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`;
}

/** Builds a Markdown report that describes CodeNeat's state. It contains no file contents. */
export async function buildDiagnosticsReport(app: CodeNeatApp): Promise<string> {
  const env = app.environment();
  const statuses = await app.registry.detectAll(env);
  const settings = app.config.read(app.lastEditor?.document.uri);
  const editor = app.config.readEditor();
  const lines: string[] = [];

  lines.push('# CodeNeat Diagnostics', '');
  lines.push('This report is generated locally and contains no source code. Review it before sharing.', '');
  lines.push('## Environment', '');
  lines.push(row(['Item', 'Value']), row(['---', '---']));
  lines.push(row(['CodeNeat', app.version]));
  lines.push(row(['VS Code', vscode.version]));
  lines.push(row(['Platform', `${process.platform} ${process.arch} (${os.release()})`]));
  lines.push(row(['Extension host Node.js', process.version]));
  lines.push(row(['Workspace trusted', vscode.workspace.isTrusted ? 'yes' : 'no (Restricted Mode: bundled formatters only)']));
  lines.push(row(['Workspace folders', String(vscode.workspace.workspaceFolders?.length ?? 0)]));
  lines.push(row(['Remote', vscode.env.remoteName ?? 'none']));
  lines.push('');

  lines.push('## Active document', '');
  const document = app.lastEditor?.document;
  if (!document) {
    lines.push('No text editor is open.', '');
  } else {
    const input = app.toInput(document);
    const language = app.languageOf(document);
    const defaultFormatter = vscode.workspace
      .getConfiguration('editor', { languageId: document.languageId, uri: document.uri })
      .get<string | null>('defaultFormatter');
    lines.push(row(['Item', 'Value']), row(['---', '---']));
    lines.push(row(['VS Code language id', document.languageId]));
    lines.push(row(['CodeNeat language', language ? `${language.label} (${language.id})` : 'not supported']));
    lines.push(row(['Scheme', document.uri.scheme]));
    lines.push(row(['Lines', String(document.lineCount)]));
    lines.push(
      row([
        'VS Code default formatter',
        defaultFormatter ? (defaultFormatter.toLowerCase() === EXTENSION_ID.toLowerCase() ? 'CodeNeat' : defaultFormatter) : 'not set (VS Code asks or uses the only formatter available)',
      ]),
    );
    if (input) {
      try {
        const plan = await app.service.plan(input, app.config.formattingSettings(document.uri));
        lines.push(row(['Formatter', `${plan.descriptor.displayName}${plan.explicitChoice ? ' (chosen by you)' : ' (automatic)'}`]));
        lines.push(row(['Formatter available', plan.status.available ? `yes${plan.status.version ? `, version ${plan.status.version}` : ''}` : `no — ${plan.status.problem ?? ''}`]));
        lines.push(row(['Profile', plan.resolved.profile.name]));
        lines.push(row(['Formatter config file', plan.resolved.projectConfigFile ?? 'none found']));
        lines.push('', '### Effective options for this document', '');
        lines.push(row(['Option', 'Value', 'Comes from', 'Native option']), row(['---', '---', '---', '---']));
        for (const option of Object.values(plan.resolved.options)) {
          const definition = getOption(option.id);
          if (!definition) {
            continue;
          }
          if (option.supported) {
            const from = option.sourceDetail ? `${sourceLabel(option.source)} (${option.sourceDetail})` : sourceLabel(option.source);
            lines.push(row([definition.label, String(option.value), from, option.native ?? '']));
          } else if (option.source === 'fixed') {
            lines.push(row([definition.label, 'fixed', option.unavailableReason ?? '', '']));
          }
        }
      } catch (error) {
        lines.push(row(['Formatter', `could not be resolved: ${error instanceof Error ? error.message : String(error)}`]));
      }
    }
    lines.push('');
  }

  lines.push('## Formatters', '');
  lines.push(row(['Formatter', 'Kind', 'Status', 'Version', 'Location', 'Languages']), row(['---', '---', '---', '---', '---', '---']));
  for (const descriptor of app.registry.descriptors) {
    const status = statuses[descriptor.id];
    lines.push(
      row([
        descriptor.displayName,
        descriptor.kind,
        status?.available ? 'available' : `missing — ${status?.problem ?? 'not checked'}`,
        status?.version ?? '',
        status?.path ?? '',
        descriptor.languages.join(', '),
      ]),
    );
  }
  lines.push('');

  if (app.customFormatterProblems.length > 0) {
    lines.push('## Problems in codeneat.customFormatters', '', ...app.customFormatterProblems.map((problem) => `- ${problem}`), '');
  }

  lines.push('## Settings', '');
  lines.push('```json');
  lines.push(
    JSON.stringify(
      {
        user: settings.user,
        workspace: settings.workspace,
        customProfiles: Object.keys(settings.profiles),
        respectProjectConfig: settings.respectProjectConfig,
        timeoutMs: settings.timeoutMs,
        maxFileSizeKB: settings.maxFileSizeKB,
        toolPaths: settings.toolPaths,
        editor,
      },
      null,
      2,
    ),
  );
  lines.push('```', '');

  lines.push('## Precedence', '', 'Later entries win over earlier ones:', '');
  PRECEDENCE.forEach((entry, index) => lines.push(`${index + 1}. ${entry.label}`));
  lines.push('');
  return lines.join('\n');
}

export async function openDiagnostics(app: CodeNeatApp): Promise<void> {
  const content = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'CodeNeat: collecting diagnostics…' },
    () => buildDiagnosticsReport(app),
  );
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content });
  await vscode.window.showTextDocument(document, { preview: true });
}
