import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CustomAdapter } from '../../src/adapters/custom';
import { ExternalAdapter, type ExternalSpec, type Invocation } from '../../src/adapters/external';
import { externalDescriptor } from '../../src/adapters/toolkit';
import { type FormatRequest, FormatterError } from '../../src/core/adapter';
import { runTool, ToolRunError } from '../../src/core/process';
import { makeEnv } from '../helpers/harness';

const NODE = process.execPath;
const FAKE = path.resolve(__dirname, '..', 'helpers', 'fake-tool.cjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'codeneat-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function source() {
  let cancelled = false;
  const listeners: (() => void)[] = [];
  return {
    token: {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested(listener: () => void) {
        listeners.push(listener);
        return { dispose: () => undefined };
      },
    },
    cancel() {
      cancelled = true;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('safe process execution', () => {
  it('pipes text through a tool as UTF-8', async () => {
    const result = await runTool(NODE, [FAKE, 'echo'], { stdin: 'héllo 👋 世界\n', timeoutMs: 10000 });
    expect(result).toEqual({ code: 0, stdout: 'héllo 👋 世界\n', stderr: '' });
  });

  it('passes arguments literally and never through a shell', async () => {
    const marker = path.join(scratch, 'should-not-exist');
    const hostile = [`; touch ${marker}`, `$(touch ${marker})`, `\`touch ${marker}\``, `| touch ${marker}`, '&& exit 1', '"quoted"', "it's", 'a b  c', '*'];
    const result = await runTool(NODE, [FAKE, 'args', ...hostile], { stdin: '', timeoutMs: 10000 });
    expect(JSON.parse(result.stdout)).toEqual(hostile);
    expect(existsSync(marker)).toBe(false);
  });

  it('reports the exit code and stderr of a failing tool', async () => {
    const result = await runTool(NODE, [FAKE, 'fail'], { stdin: 'x', timeoutMs: 10000 });
    expect(result.code).toBe(3);
    expect(result.stderr).toContain('unexpected token');
  });

  it('kills a tool that exceeds the time limit', async () => {
    const started = Date.now();
    await expect(runTool(NODE, [FAKE, 'hang'], { timeoutMs: 400 })).rejects.toMatchObject({ kind: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('kills a tool when the request is cancelled', async () => {
    const cancellation = source();
    const pending = runTool(NODE, [FAKE, 'hang'], { timeoutMs: 20000, token: cancellation.token });
    setTimeout(() => cancellation.cancel(), 150);
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('does not start anything for an already cancelled request', async () => {
    const cancellation = source();
    cancellation.cancel();
    await expect(runTool(NODE, [FAKE, 'echo'], { timeoutMs: 1000, token: cancellation.token })).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('reports a missing executable distinctly', async () => {
    const error = await runTool(path.join(scratch, 'no-such-tool'), [], { timeoutMs: 1000 }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ToolRunError);
    expect((error as ToolRunError).kind).toBe('not-found');
  });

  it('rejects NUL bytes in commands and arguments', async () => {
    await expect(runTool(NODE, ['a\0b'], { timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'spawn-failed' });
    await expect(runTool('', [], { timeoutMs: 1000 })).rejects.toMatchObject({ kind: 'spawn-failed' });
  });

  it('stops a tool that floods its output', async () => {
    await expect(runTool(NODE, ['-e', 'setInterval(() => process.stdout.write("x".repeat(65536)), 1)'], { timeoutMs: 20000, maxOutputBytes: 200000 })).rejects.toMatchObject({
      kind: 'too-much-output',
    });
  });
});

function fakeSpec(id: string, invocation: (inputFile: () => Promise<string>) => Promise<Invocation> | Invocation, extra: Partial<ExternalSpec> = {}): ExternalSpec {
  return {
    descriptor: externalDescriptor({
      id,
      displayName: 'Fake Tool',
      engine: 'fake',
      license: 'MIT',
      homepage: 'https://example.com',
      languages: ['python'],
      requirement: 'fake',
      executables: ['codeneat-fake-tool-that-is-not-installed'],
      install: { summary: 'Install Fake Tool with the fake package manager.', commands: [{ label: 'fake', command: 'fake install' }], url: 'https://example.com/install' },
      rangeLanguages: [],
    }),
    versionArgs: [FAKE, '--version'],
    build: async ({ inputFile }) => [await invocation(inputFile)],
    ...extra,
  };
}

function request(partial: Partial<FormatRequest> = {}): FormatRequest {
  return { text: 'hello\n', languageId: 'python', fileName: 'a.py', style: {}, explicit: [], projectConfigTakesOver: false, useProjectConfig: true, timeoutMs: 10000, ...partial };
}

const token = source().token;

describe('external formatter adapter', () => {
  const env = (id: string) => makeEnv({ toolPaths: { [id]: NODE } });

  it('detects a configured tool and reads its version', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [FAKE, 'upper'] })));
    expect(await adapter.detect(env('fake'))).toMatchObject({ id: 'fake', available: true, version: '1.2.3', origin: 'setting', path: NODE });
  });

  it('formats through standard input and output', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [FAKE, 'upper'] })));
    expect(await adapter.format(request({ text: 'héllo\n' }), env('fake'), token)).toBe('HÉLLO\n');
  });

  it('formats through a private temporary copy and cleans it up', async () => {
    let seen = '';
    const adapter = new ExternalAdapter(
      fakeSpec('fake', async (inputFile) => {
        seen = await inputFile();
        return { mode: 'file', args: [FAKE, 'rewrite', seen] };
      }),
    );
    expect(await adapter.format(request({ fileName: '../../evil name.py' }), env('fake'), token)).toBe('HELLO\n');
    expect(path.basename(seen)).toBe('evil_name.py');
    expect(seen.startsWith(os.tmpdir()) || seen.includes('codeneat-')).toBe(true);
    expect(existsSync(path.dirname(path.dirname(seen)))).toBe(false);
  });

  it('reports a missing tool with installation guidance', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [] })));
    const status = await adapter.detect(makeEnv());
    expect(status.available).toBe(false);
    expect(status.problem).toContain('Fake Tool was not found');
    const error = await adapter.format(request(), makeEnv(), token).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(FormatterError);
    expect((error as FormatterError).kind).toBe('missing');
    expect((error as FormatterError).install?.commands[0].command).toBe('fake install');
  });

  it('explains a bad configured path instead of silently falling back', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [] })));
    const status = await adapter.detect(makeEnv({ toolPaths: { fake: 'relative/tool' } }));
    expect(status).toMatchObject({ available: false });
    expect(status.problem).toContain('not an absolute path');
  });

  it('never runs external tools in an untrusted workspace', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [FAKE, 'upper'] })));
    const untrusted = makeEnv({ trusted: false, toolPaths: { fake: NODE } });
    expect((await adapter.detect(untrusted)).problem).toContain('Restricted Mode');
    await expect(adapter.format(request(), untrusted, token)).rejects.toMatchObject({ kind: 'untrusted' });
  });

  it('turns a tool failure into a readable error and leaves the text alone', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [FAKE, 'fail'] })));
    const error = (await adapter.format(request(), env('fake'), token).catch((reason: unknown) => reason)) as FormatterError;
    expect(error.kind).toBe('failed');
    expect(error.message).toContain('Fake Tool could not format this file');
    expect(error.message).toContain('unexpected token');
  });

  it('refuses an empty result so a file can never be wiped', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [FAKE, 'empty'] })));
    await expect(adapter.format(request(), env('fake'), token)).rejects.toMatchObject({ kind: 'failed' });
  });

  it('stops on timeout and on cancellation', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [FAKE, 'hang'] })));
    await expect(adapter.format(request({ timeoutMs: 400 }), env('fake'), token)).rejects.toMatchObject({ kind: 'timeout' });
    const cancellation = source();
    const pending = adapter.format(request({ timeoutMs: 20000 }), env('fake'), cancellation.token);
    setTimeout(() => cancellation.cancel(), 150);
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('refuses range formatting when the tool cannot do it', async () => {
    const adapter = new ExternalAdapter(fakeSpec('fake', () => ({ mode: 'stdin', args: [FAKE, 'upper'] })));
    await expect(adapter.format(request({ range: { start: 0, end: 3 } }), env('fake'), token)).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('prefers a project-local installation in trusted workspaces only', async () => {
    const project = mkdtempSync(path.join(scratch, 'project-'));
    const binDir = path.join(project, 'node_modules', '.bin');
    const { mkdirSync, chmodSync } = await import('node:fs');
    mkdirSync(binDir, { recursive: true });
    const local = path.join(binDir, process.platform === 'win32' ? 'localtool.cmd' : 'localtool');
    writeFileSync(local, process.platform === 'win32' ? '@echo localtool 9.9.9\r\n' : '#!/bin/sh\necho "localtool 9.9.9"\n');
    chmodSync(local, 0o755);
    const spec = fakeSpec('local', () => ({ mode: 'stdin', args: [] }), { versionArgs: ['--version'], localBin: ['node_modules/.bin/localtool'] });
    const trusted = await new ExternalAdapter(spec).detect(makeEnv({ workspaceRoots: [project] }), project);
    expect(trusted).toMatchObject({ available: true, origin: 'project', version: '9.9.9' });
    const untrusted = await new ExternalAdapter(spec).detect(makeEnv({ workspaceRoots: [project], trusted: false }), project);
    expect(untrusted.available).toBe(false);
  });

  it('finds an opaque project configuration file and stops at the workspace root', async () => {
    const workspace = mkdtempSync(path.join(scratch, 'ws-'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.join(workspace, 'src', 'deep'), { recursive: true });
    writeFileSync(path.join(workspace, '.faketoolrc'), 'x');
    const file = path.join(workspace, 'src', 'deep', 'a.py');
    const spec = fakeSpec('fake', () => ({ mode: 'stdin', args: [] }));
    spec.descriptor.configFiles = ['.faketoolrc'];
    const adapter = new ExternalAdapter(spec);
    expect(await adapter.readProjectConfig(file, workspace, makeEnv())).toEqual({ style: {}, file: path.join(workspace, '.faketoolrc'), takesOver: true });
    expect(await adapter.readProjectConfig(file, path.join(workspace, 'src'), makeEnv())).toEqual({ style: {}, takesOver: false });
    expect(await adapter.readProjectConfig(file, workspace, makeEnv({ trusted: false }))).toEqual({ style: {}, takesOver: false });
  });
});

describe('custom formatters need explicit consent', () => {
  const config = { id: 'my-upper', name: 'My Upper', languages: ['python'], command: NODE, args: [FAKE, 'args', '--width=${lineLength}', '${indentStyle}', '${file}'] };

  it('does not even start the command before it is approved', async () => {
    const adapter = new CustomAdapter(config);
    const status = await adapter.detect(makeEnv());
    expect(status.available).toBe(false);
    expect(status.problem).toContain('approval');
    await expect(adapter.format(request(), makeEnv(), token)).rejects.toMatchObject({ kind: 'needs-approval', detail: adapter.fingerprint });
  });

  it('runs after approval and fills in placeholders', async () => {
    const adapter = new CustomAdapter(config);
    const approved = makeEnv({ approvedCommands: new Set([adapter.fingerprint]) });
    const output = await adapter.format(request({ style: { lineLength: 99, indentStyle: 'tabs' }, explicit: ['lineLength', 'indentStyle'], filePath: '/x/a.py' }), approved, token);
    expect(JSON.parse(output)).toEqual(['--width=99', 'tabs', '/x/a.py']);
    expect(adapter.descriptor.kind).toBe('custom');
    expect(Object.keys(adapter.descriptor.options).sort()).toEqual(['indentStyle', 'lineEndings', 'lineLength']);
  });

  it('needs a new approval when the command changes, and never runs untrusted', async () => {
    const original = new CustomAdapter(config);
    const changed = new CustomAdapter({ ...config, args: [...config.args, '--extra'] });
    expect(changed.fingerprint).not.toBe(original.fingerprint);
    const approved = makeEnv({ approvedCommands: new Set([original.fingerprint]) });
    await expect(changed.format(request(), approved, token)).rejects.toMatchObject({ kind: 'needs-approval' });
    await expect(original.format(request(), makeEnv({ trusted: false, approvedCommands: new Set([original.fingerprint]) }), token)).rejects.toMatchObject({ kind: 'untrusted' });
  });
});

describe('temporary files', () => {
  it('leaves nothing behind in the system temp directory', () => {
    const leftovers = readdirSync(os.tmpdir()).filter((name) => /^codeneat-[A-Za-z0-9]{6}$/.test(name));
    expect(leftovers).toEqual([]);
  });
});
