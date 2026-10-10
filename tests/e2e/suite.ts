/**
 * End-to-end tests. They run inside a real VS Code instance (see run.mjs) with the extension
 * loaded, and exercise it only through public VS Code APIs and CodeNeat's commands.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { CodeNeatApi } from '../../src/extension';

const EXTENSION_ID = 'PamalJayasinghe.codeneat';
const workspaceDir = process.env.CODENEAT_E2E_WORKSPACE ?? '';
const tests: { name: string; body: () => Promise<void> }[] = [];
const test = (name: string, body: () => Promise<void>): void => void tests.push({ name, body });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

function file(relative: string): vscode.Uri {
  return vscode.Uri.file(path.join(workspaceDir, relative));
}

async function open(relative: string): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(file(relative));
  return vscode.window.showTextDocument(document, { preview: false });
}

async function providerEdits(uri: vscode.Uri): Promise<vscode.TextEdit[]> {
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>('vscode.executeFormatDocumentProvider', uri, { tabSize: 4, insertSpaces: true });
  return edits ?? [];
}

async function applyEdits(document: vscode.TextDocument, edits: vscode.TextEdit[]): Promise<string> {
  const edit = new vscode.WorkspaceEdit();
  edit.set(document.uri, edits);
  assert.ok(await vscode.workspace.applyEdit(edit), 'the editor accepted the edits');
  return document.getText();
}

async function setConfig(section: string, key: string, value: unknown, target = vscode.ConfigurationTarget.Global): Promise<void> {
  await vscode.workspace.getConfiguration(section).update(key, value, target);
}

async function resetCodeNeat(): Promise<void> {
  for (const key of ['style', 'languages', 'defaultProfile', 'profiles']) {
    await setConfig('codeneat', key, undefined);
    await setConfig('codeneat', key, undefined, vscode.ConfigurationTarget.Workspace);
  }
}

let api: CodeNeatApi;

test('the extension is installed and activates', async () => {
  const extension = vscode.extensions.getExtension<CodeNeatApi>(EXTENSION_ID);
  assert.ok(extension, 'extension is present');
  api = await extension.activate();
  await api.ready;
  assert.equal(api.version, extension.packageJSON.version);
  // VS Code ships its own formatters for some languages (TypeScript, JSON, HTML, CSS). Making
  // CodeNeat the default formatter ensures the provider commands below exercise CodeNeat.
  await setConfig('editor', 'defaultFormatter', EXTENSION_ID);
  const available = api.availableFormatters();
  for (const id of [
    'prettier', 'prettier-java', 'prettier-xml', 'prettier-toml', 'prettier-php', 'prettier-latex', 'sql-formatter',
    'ruff-wasm', 'gofmt-wasm', 'clang-format-wasm', 'stylua-wasm', 'shfmt-wasm', 'dart-format-wasm', 'dockerfmt-wasm',
  ]) {
    assert.ok(available.includes(id), `bundled formatter ${id} is available`);
  }
});

test('all CodeNeat commands are registered', async () => {
  const commands = new Set(await vscode.commands.getCommands(true));
  for (const command of [
    'formatDocument', 'formatSelection', 'formatWorkspace', 'previewFormatting', 'checkFormatting', 'openSettings',
    'selectFormatter', 'selectProfile', 'manageFormatters', 'openDiagnostics', 'importSettings', 'exportSettings',
    'setAsDefaultFormatter', 'refreshFormatters', 'installFormatter', 'applyPreview', 'formatWithReview', 'keepInlineReview', 'discardInlineReview', 'showMenu', 'openUserGuide',
  ]) {
    assert.ok(commands.has(`codeneat.${command}`), `codeneat.${command}`);
  }
});

test('the document formatting provider formats TypeScript', async () => {
  const editor = await open('typescript/input.ts');
  const edits = await providerEdits(editor.document.uri);
  assert.ok(edits.length > 0, 'provider returned edits');
  const text = await applyEdits(editor.document, edits);
  assert.match(text, /export interface User \{\n {2}id: number;/);
  // (The provider command falls through to VS Code's built-in TypeScript formatter when CodeNeat
  // has nothing to change, so idempotency is checked with CodeNeat's own command.)
  await vscode.commands.executeCommand('codeneat.formatDocument');
  assert.equal(editor.document.getText(), text, 'formatting twice changes nothing');
});

test('CodeNeat: Format Document changes the file and one Undo restores it', async () => {
  const editor = await open('javascript/input.js');
  const original = editor.document.getText();
  await vscode.commands.executeCommand('codeneat.formatDocument');
  const formatted = editor.document.getText();
  assert.notEqual(formatted, original);
  assert.match(formatted, /^import \{ readFile, writeFile \} from "node:fs\/promises";/);
  // Undo is a keyboard command: it acts on whatever has the focus, so make sure that is this editor.
  await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
  await vscode.commands.executeCommand('undo');
  await waitFor(() => editor.document.getText() !== formatted, 'undo to take effect', 3000);
  assert.equal(editor.document.getText(), original, 'a single undo restores the original');
  await vscode.commands.executeCommand('redo');
  await waitFor(() => editor.document.getText() === formatted, 'redo to re-apply the formatting', 3000);
});

test('every bundled language formats through VS Code, including languages VS Code has no grammar for', async () => {
  const cases = [
    'html/input.html', 'css/input.css', 'scss/input.scss', 'less/input.less', 'javascriptreact/input.jsx', 'typescriptreact/input.tsx',
    'json/input.json', 'jsonc/input.jsonc', 'yaml/input.yaml', 'markdown/input.md', 'mdx/input.mdx', 'vue/input.vue',
    'angular/input.component.html', 'graphql/input.graphql', 'xml/input.xml', 'java/input.java', 'sql/input.sql', 'toml/input.toml',
    // Engines bundled as WebAssembly builds or Prettier plugins: nothing has to be installed.
    'python/input.py', 'go/input.go', 'c/input.c', 'cpp/input.cpp', 'csharp/input.cs', 'php/input.php', 'lua/input.lua', 'dart/input.dart',
    'shellscript/input.sh', 'dockerfile/Dockerfile', 'proto/input.proto', 'latex/input.tex',
  ];
  for (const relative of cases) {
    const document = await vscode.workspace.openTextDocument(file(relative));
    const edits = await providerEdits(document.uri);
    assert.ok(edits.length > 0, `${relative} (VS Code language "${document.languageId}") was formatted`);
  }
});

test('range formatting only touches the selection', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'const   a=1\nconst   b=2\nconst   c=3\n' });
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
    'vscode.executeFormatRangeProvider', document.uri, new vscode.Range(1, 0, 1, 11), { tabSize: 2, insertSpaces: true },
  );
  assert.ok(edits && edits.length > 0);
  assert.equal(await applyEdits(document, edits), 'const   a=1\nconst b = 2;\nconst   c=3\n');
});

test('CodeNeat: Format Selection formats the selected code', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const   a=1\nconst   b=2\n' });
  const editor = await vscode.window.showTextDocument(document);
  editor.selection = new vscode.Selection(0, 0, 0, 11);
  await vscode.commands.executeCommand('codeneat.formatSelection');
  assert.equal(document.getText(), 'const a = 1;\nconst   b=2\n');
});

test('settings are persisted and change the formatting', async () => {
  await setConfig('codeneat', 'style', { lineLength: 40, quoteStyle: 'single', semicolons: 'never', indentStyle: 'tabs' });
  const stored = vscode.workspace.getConfiguration('codeneat').inspect('style')?.globalValue;
  assert.deepEqual(stored, { lineLength: 40, quoteStyle: 'single', semicolons: 'never', indentStyle: 'tabs' });
  const document = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content: 'function greet(name: string){const message = "hello " + name; return someFunction(message, anotherArgument, yetAnotherArgument)}\n',
  });
  const text = await applyEdits(document, await providerEdits(document.uri));
  assert.equal(text, "function greet(name: string) {\n\tconst message = 'hello ' + name\n\treturn someFunction(\n\t\tmessage,\n\t\tanotherArgument,\n\t\tyetAnotherArgument,\n\t)\n}\n");
  await resetCodeNeat();
});

test('per-language settings only affect their language', async () => {
  await setConfig('codeneat', 'languages', { typescript: { style: { indentSize: 8 } } });
  const ts = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'function f(){return 1}\n' });
  const js = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'function f(){return 1}\n' });
  assert.equal(await applyEdits(ts, await providerEdits(ts.uri)), 'function f() {\n        return 1;\n}\n');
  assert.equal(await applyEdits(js, await providerEdits(js.uri)), 'function f() {\n  return 1;\n}\n');
  await resetCodeNeat();
});

test('profiles: a built-in and a custom profile are applied, workspace before user', async () => {
  await setConfig('codeneat', 'defaultProfile', 'team');
  const first = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'const a = "x"\n' });
  assert.equal(await applyEdits(first, await providerEdits(first.uri)), "const a = 'x';\n");
  await setConfig('codeneat', 'profiles', { mine: { name: 'Mine', style: { semicolons: 'never', quoteStyle: 'double' } } });
  await setConfig('codeneat', 'defaultProfile', 'mine', vscode.ConfigurationTarget.Workspace);
  const second = await vscode.workspace.openTextDocument({ language: 'javascript', content: "const a = 'x';\n" });
  assert.equal(await applyEdits(second, await providerEdits(second.uri)), 'const a = "x"\n');
  await resetCodeNeat();
});

test('Format on Save formats the file on disk when CodeNeat is the default formatter', async () => {
  const target = file('save-test.ts');
  fs.writeFileSync(target.fsPath, 'const   answer={value:42}\n');
  await setConfig('editor', 'defaultFormatter', EXTENSION_ID, vscode.ConfigurationTarget.Workspace);
  await setConfig('editor', 'formatOnSave', true, vscode.ConfigurationTarget.Workspace);
  try {
    const editor = await open('save-test.ts');
    await editor.edit((builder) => builder.insert(new vscode.Position(1, 0), 'const   other=1\n'));
    assert.ok(await editor.document.save(), 'the document was saved');
    assert.equal(fs.readFileSync(target.fsPath, 'utf8'), 'const answer = { value: 42 };\nconst other = 1;\n');
    // Saving again must not change anything (no formatting loop).
    await editor.edit((builder) => builder.insert(new vscode.Position(2, 0), '\n'));
    await editor.document.save();
    assert.equal(fs.readFileSync(target.fsPath, 'utf8'), 'const answer = { value: 42 };\nconst other = 1;\n');
  } finally {
    await setConfig('editor', 'formatOnSave', undefined, vscode.ConfigurationTarget.Workspace);
    await setConfig('editor', 'defaultFormatter', undefined, vscode.ConfigurationTarget.Workspace);
  }
});

test('project configuration (.prettierrc, .editorconfig) is respected and can be switched off', async () => {
  const directory = path.join(workspaceDir, 'project-config');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, '.prettierrc'), '{ "singleQuote": true, "semi": false }');
  fs.writeFileSync(path.join(directory, '.editorconfig'), 'root = true\n[*]\nindent_style = tab\n');
  fs.writeFileSync(path.join(directory, 'a.ts'), 'function f(){return "x"}\n');
  const document = await vscode.workspace.openTextDocument(file('project-config/a.ts'));
  assert.equal(await applyEdits(document, await providerEdits(document.uri)), "function f() {\n\treturn 'x'\n}\n");
  assert.equal(fs.readFileSync(path.join(directory, '.prettierrc'), 'utf8'), '{ "singleQuote": true, "semi": false }', 'the project file is never modified');
  await setConfig('codeneat', 'respectProjectConfig', false);
  const again = await vscode.workspace.openTextDocument({ language: 'typescript', content: '' });
  void again;
  const edits = await providerEdits(document.uri);
  assert.equal(await applyEdits(document, edits), 'function f() {\n  return "x";\n}\n');
  await setConfig('codeneat', 'respectProjectConfig', undefined);
});

test('a syntax error leaves the document untouched', async () => {
  // Java has no built-in VS Code formatter, so an empty result here is CodeNeat's own answer.
  const document = await vscode.workspace.openTextDocument({ language: 'java', content: 'class {\n' });
  assert.deepEqual(await providerEdits(document.uri), []);
  assert.equal(document.getText(), 'class {\n');
  const editor = await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('codeneat.formatDocument');
  assert.equal(editor.document.getText(), 'class {\n');
});

test('unsupported files get no CodeNeat formatter', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'just   text\n' });
  assert.deepEqual(await providerEdits(document.uri), []);
});

test('Format on Type answers for bundled languages', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'function f(){return 1}' });
  const edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
    'vscode.executeFormatOnTypeProvider', document.uri, new vscode.Position(0, 22), '}', { tabSize: 2, insertSpaces: true },
  );
  assert.ok(edits && edits.length > 0, 'on-type edits were returned');
  assert.equal(await applyEdits(document, edits), 'function f() {\n  return 1;\n}\n');
  await setConfig('codeneat', 'formatOnType', false);
  const quiet = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'function g(){return 1}' });
  const none = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>(
    'vscode.executeFormatOnTypeProvider', quiet.uri, new vscode.Position(0, 22), '}', { tabSize: 2, insertSpaces: true },
  );
  assert.deepEqual(none ?? [], []);
  await setConfig('codeneat', 'formatOnType', undefined);
});

test('Preview Formatting opens a diff without changing the file', async () => {
  const editor = await open('css/input.css');
  const before = editor.document.getText();
  await vscode.commands.executeCommand('codeneat.previewFormatting');
  await waitFor(() => vscode.workspace.textDocuments.some((document) => document.uri.scheme === 'codeneat-preview'), 'the preview document');
  const preview = vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'codeneat-preview');
  assert.match(preview?.getText() ?? '', /\.card,\n\.panel \{\n {2}display: flex;/);
  assert.equal(editor.document.getText(), before);
  assert.equal(editor.document.isDirty, false);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
});

test('the live preview follows the file while it is edited, and Apply Formatting formats it', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: 'const   a=1\n' });
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  await vscode.commands.executeCommand('codeneat.previewFormatting');
  const preview = (): string => vscode.workspace.textDocuments.find((candidate) => candidate.uri.scheme === 'codeneat-preview')?.getText() ?? '';
  await waitFor(() => preview() === 'const a = 1;\n', 'the first preview');
  // Typing in the file must update the preview without running any command.
  const edit = new vscode.WorkspaceEdit();
  edit.insert(document.uri, new vscode.Position(1, 0), 'const   b=2\n');
  await vscode.workspace.applyEdit(edit);
  await waitFor(() => preview() === 'const a = 1;\nconst b = 2;\n', 'the preview to follow the edit');
  assert.equal(document.getText(), 'const   a=1\nconst   b=2\n', 'previewing never changes the file');
  // Code that cannot be parsed keeps the last good preview instead of clearing it.
  const broken = new vscode.WorkspaceEdit();
  broken.insert(document.uri, new vscode.Position(2, 0), 'const = ;\n');
  await vscode.workspace.applyEdit(broken);
  await sleep(1200);
  assert.equal(preview(), 'const a = 1;\nconst b = 2;\n');
  // (The diff editor has the focus, so the broken line is removed with an edit, not with Undo.)
  const repair = new vscode.WorkspaceEdit();
  repair.delete(document.uri, new vscode.Range(2, 0, 3, 0));
  await vscode.workspace.applyEdit(repair);
  // The Apply button of the preview formats the original file.
  await vscode.commands.executeCommand('codeneat.applyPreview');
  await waitFor(() => document.getText() === 'const a = 1;\nconst b = 2;\n', 'the formatting to be applied');
  void editor;
});

test('inline review shows the formatted code for approval: Escape restores, Enter keeps', async () => {
  const original = 'const   a=1\nfunction f(){return a}\n';
  const formatted = 'const a = 1;\nfunction f() {\n  return a;\n}\n';
  const document = await vscode.workspace.openTextDocument({ language: 'javascript', content: original });
  await vscode.window.showTextDocument(document, { preview: false });

  assert.equal(await vscode.commands.executeCommand('codeneat.formatWithReview'), true);
  assert.equal(document.getText(), formatted, 'the formatted code is shown in the editor');
  assert.ok(api.isInlineReviewActive(), 'a review is waiting for Keep or Undo');
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', document.uri, 10);
  const titles = lenses.map((lens) => lens.command?.title ?? '');
  assert.ok(titles.some((title) => title.includes('Keep (Enter)')) && titles.some((title) => title.includes('Undo (Esc)')), 'Keep and Undo actions are offered');

  await vscode.commands.executeCommand('codeneat.discardInlineReview');
  assert.equal(document.getText(), original, 'Undo puts the original text back');
  assert.equal(api.isInlineReviewActive(), false);

  await vscode.commands.executeCommand('codeneat.formatWithReview');
  await vscode.commands.executeCommand('codeneat.keepInlineReview');
  assert.equal(document.getText(), formatted, 'Keep leaves the formatted text');
  assert.equal(api.isInlineReviewActive(), false);

  // With the setting on, the normal Format Document command uses the review too.
  const second = await vscode.workspace.openTextDocument({ language: 'javascript', content: original });
  await vscode.window.showTextDocument(second, { preview: false });
  await setConfig('codeneat', 'inlineReview', true);
  try {
    await vscode.commands.executeCommand('codeneat.formatDocument');
    assert.ok(api.isInlineReviewActive());
    // Typing ends the review and keeps the formatting.
    const typing = new vscode.WorkspaceEdit();
    typing.insert(second.uri, new vscode.Position(0, 0), '// note\n');
    await vscode.workspace.applyEdit(typing);
    assert.equal(api.isInlineReviewActive(), false);
    assert.equal(second.getText(), `// note\n${formatted}`);
  } finally {
    await setConfig('codeneat', 'inlineReview', undefined);
  }
});

test('Review Changes on Save reports what would change and leaves the saved file alone', async () => {
  const target = file('review-test.ts');
  fs.writeFileSync(target.fsPath, 'const   answer=42\n');
  await setConfig('codeneat', 'previewOnSave', true);
  try {
    const editor = await open('review-test.ts');
    await editor.edit((builder) => builder.insert(new vscode.Position(1, 0), 'const   other=1\n'));
    await vscode.commands.executeCommand('workbench.action.files.save');
    await waitFor(() => api.lastSaveReview()?.file === 'review-test.ts', 'the review prompt');
    assert.equal(api.lastSaveReview()?.changedLines, 2);
    assert.equal(fs.readFileSync(target.fsPath, 'utf8'), 'const   answer=42\nconst   other=1\n', 'the file is saved exactly as typed');
  } finally {
    await setConfig('codeneat', 'previewOnSave', undefined);
  }
});

test('the master switch turns all CodeNeat formatting off, and back on', async () => {
  const document = await vscode.workspace.openTextDocument({ language: 'java', content: 'class A{}\n' });
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  await setConfig('codeneat', 'enabled', false);
  try {
    assert.deepEqual(await providerEdits(document.uri), [], 'the provider returns nothing while switched off');
    await vscode.commands.executeCommand('codeneat.formatDocument');
    assert.equal(editor.document.getText(), 'class A{}\n', 'the command changes nothing while switched off');
  } finally {
    await setConfig('codeneat', 'enabled', undefined);
  }
  assert.equal(await applyEdits(document, await providerEdits(document.uri)), 'class A {}\n');
});

test('the user guide opens', async () => {
  await vscode.commands.executeCommand('codeneat.openUserGuide');
  await waitFor(() => vscode.window.tabGroups.all.some((group) => group.tabs.some((tab) => tab.label.includes('usage.md'))), 'the user guide tab');
});

test('the settings dashboard opens and its UI loads', async () => {
  await open('typescript/input.ts');
  await vscode.commands.executeCommand('codeneat.openSettings');
  assert.ok(api.isDashboardOpen(), 'the dashboard panel is open');
  await waitFor(() => api.isDashboardRendered(), 'the dashboard UI to load its state');
  await vscode.commands.executeCommand('codeneat.manageFormatters');
  assert.ok(api.isDashboardOpen());
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await waitFor(() => !api.isDashboardOpen(), 'the dashboard to close');
});

test('the diagnostics report opens and describes the environment', async () => {
  await open('typescript/input.ts');
  await vscode.commands.executeCommand('codeneat.openDiagnostics');
  await waitFor(() => !!vscode.window.activeTextEditor?.document.getText().startsWith('# CodeNeat Diagnostics'), 'the diagnostics document');
  const report = vscode.window.activeTextEditor?.document.getText() ?? '';
  assert.match(report, /\| Prettier \| bundled \| available \|/);
  assert.match(report, /CodeNeat language \| TypeScript \(typescript\)/);
  assert.match(report, /Preferred Line Length \| 120 \|/);
  assert.ok(!report.includes('export interface User'), 'the report contains no source code');
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
});

test('a missing external formatter is reported, not faked', async () => {
  // Rust has no bundled engine: without rustfmt the file must be left exactly as it is.
  if (api.availableFormatters().includes('rustfmt')) {
    return;
  }
  const document = await vscode.workspace.openTextDocument(file('rust/input.rs'));
  const before = document.getText();
  assert.deepEqual(await providerEdits(document.uri), []);
  assert.equal(document.getText(), before);
});

test('Go is formatted by the bundled gofmt and Python by the bundled Ruff', async () => {
  const go = await vscode.workspace.openTextDocument({ language: 'go', content: 'package main\nfunc main(){}\n' });
  if (!api.availableFormatters().includes('gofmt')) {
    assert.equal(await applyEdits(go, await providerEdits(go.uri)), 'package main\n\nfunc main() {}\n');
  }
  if (!api.availableFormatters().includes('ruff')) {
    await setConfig('codeneat', 'languages', { python: { style: { quoteStyle: 'single', indentSize: 2 } } });
    const python = await vscode.workspace.openTextDocument({ language: 'python', content: 'def f(a):\n    return "x"+a\n' });
    assert.equal(await applyEdits(python, await providerEdits(python.uri)), "def f(a):\n  return 'x' + a\n");
    await setConfig('codeneat', 'languages', undefined);
  }
});

export async function run(): Promise<void> {
  assert.ok(workspaceDir, 'CODENEAT_E2E_WORKSPACE is set');
  // Keep the keyboard focus in the editor area (see run.mjs).
  await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar').then(undefined, () => undefined);
  const results: { name: string; ok: boolean; error?: string; ms: number }[] = [];
  for (const { name, body } of tests) {
    const started = Date.now();
    try {
      await body();
      results.push({ name, ok: true, ms: Date.now() - started });
      console.log(`  ✓ ${name}`);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      results.push({ name, ok: false, error: message, ms: Date.now() - started });
      console.error(`  ✗ ${name}\n${message}`);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(undefined, () => undefined);
  }
  if (process.env.CODENEAT_E2E_RESULTS) {
    fs.writeFileSync(process.env.CODENEAT_E2E_RESULTS, JSON.stringify(results, null, 2));
  }
  const failed = results.filter((result) => !result.ok);
  console.log(`\n  ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    throw new Error(`${failed.length} end-to-end test(s) failed: ${failed.map((result) => result.name).join('; ')}`);
  }
}
