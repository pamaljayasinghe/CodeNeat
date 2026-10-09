import { describe, expect, it } from 'vitest';
import { applyChanges, computeChanges, singleChange } from '../../src/core/edits';
import { detectEol, normalizeEol, targetEol } from '../../src/core/eol';
import { compareVersions, executableNames, expandHome, findOnPath, parseVersion, resolveConfiguredPath } from '../../src/core/executables';
import { editorConfigToStyle } from '../../src/core/projectConfig';
import { looksBinary, looksGenerated } from '../../src/core/workspaceScan';

describe('minimal edits', () => {
  const cases: [string, string, string][] = [
    ['identical', 'a\nb\n', 'a\nb\n'],
    ['one line changed', 'a\nb\nc\n', 'a\nB\nc\n'],
    ['lines inserted', 'a\nc\n', 'a\nb\nc\n'],
    ['lines removed', 'a\nb\nc\n', 'a\nc\n'],
    ['several separate changes', 'x=1\ny=2\nz=3\nw=4\n', 'x = 1\ny=2\nz = 3\nw=4\n'],
    ['missing final newline', 'a\nb', 'a\nb\n'],
    ['unicode and emoji', 'const s="héllo 👋🏽 世界"\n', "const s = 'héllo 👋🏽 世界';\n"],
    ['windows line endings', 'a\r\nb\r\n', 'a\r\nB\r\n'],
    ['line ending conversion', 'a\r\nb\r\n', 'a\nb\n'],
    ['empty to text', '', 'a\n'],
    ['everything replaced', 'one\ntwo\n', 'three\nfour\nfive\n'],
  ];

  it.each(cases)('%s: applying the edits reproduces the formatted text', (_name, original, formatted) => {
    expect(applyChanges(original, computeChanges(original, formatted))).toBe(formatted);
    expect(applyChanges(original, singleChange(original, formatted))).toBe(formatted);
  });

  it('produces no edits for unchanged text and small edits for small changes', () => {
    expect(computeChanges('same\n', 'same\n')).toEqual([]);
    const original = Array.from({ length: 200 }, (_, index) => `line ${index}`).join('\n');
    const formatted = original.replace('line 100', 'LINE 100');
    const changes = computeChanges(original, formatted);
    expect(changes).toHaveLength(1);
    expect(changes[0].end - changes[0].start).toBeLessThan(20);
  });

  it('never splits a surrogate pair or a CRLF pair', () => {
    const [change] = singleChange('a😀b', 'a😁b');
    expect(change.start).toBe(1);
    expect(change.end).toBe(3);
    const [crlf] = singleChange('a\r\nb', 'a\nb');
    expect('a\r\nb'.slice(crlf.start, crlf.end)).toBe('\r\n');
  });
});

describe('line endings', () => {
  it('detects the dominant line ending', () => {
    expect(detectEol('a\nb\n')).toBe('\n');
    expect(detectEol('a\r\nb\r\n')).toBe('\r\n');
    expect(detectEol('a\r\nb\nc\n')).toBe('\n');
    expect(detectEol('no breaks')).toBe('\n');
  });

  it('converts without touching content', () => {
    expect(normalizeEol('a\r\nb\rc\n', '\n')).toBe('a\nb\nc\n');
    expect(normalizeEol('a\nb\r\n', '\r\n')).toBe('a\r\nb\r\n');
  });

  it('keeps the existing line ending for "auto"', () => {
    expect(targetEol('auto', 'a\r\nb\r\n')).toBe('\r\n');
    expect(targetEol(undefined, 'a\nb')).toBe('\n');
    expect(targetEol('lf', 'a\r\nb')).toBe('\n');
    expect(targetEol('crlf', 'a\nb')).toBe('\r\n');
  });
});

describe('executable discovery helpers', () => {
  it('extracts versions from typical --version output', () => {
    expect(parseVersion('ruff 0.6.9')).toBe('0.6.9');
    expect(parseVersion('rustfmt 1.7.1-stable (4eb161250e 2024-08-06)')).toBe('1.7.1-stable');
    expect(parseVersion('clang-format version 18.1.8')).toBe('18.1.8');
    expect(parseVersion('Terraform v1.9.5\non darwin_amd64')).toBe('1.9.5');
    expect(parseVersion('main')).toBeUndefined();
  });

  it('compares versions numerically', () => {
    expect(compareVersions('3.10.0', '3.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.29.2', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('3.7', '3.7.0')).toBe(0);
  });

  it('adds Windows executable extensions only on Windows', () => {
    expect(executableNames('ruff', 'linux')).toEqual(['ruff']);
    expect(executableNames('ruff', 'win32', { PATHEXT: '.EXE;.CMD' })).toEqual(['ruff.exe', 'ruff.cmd']);
    expect(executableNames('ruff.exe', 'win32', { PATHEXT: '.EXE;.CMD' })).toEqual(['ruff.exe']);
  });

  it('never searches relative PATH entries or names containing a path', async () => {
    expect(await findOnPath('node', { PATH: '.:bin::relative/dir' })).toBeUndefined();
    expect(await findOnPath('../node')).toBeUndefined();
    expect(await findOnPath('bin/node')).toBeUndefined();
    expect(await findOnPath('codeneat-definitely-not-installed')).toBeUndefined();
  });

  it('finds real executables on PATH', async () => {
    const found = await findOnPath(process.platform === 'win32' ? 'node.exe' : 'node');
    expect(found).toBeTruthy();
  });

  it('only accepts absolute configured paths to existing files', async () => {
    expect((await resolveConfiguredPath('relative/tool')).problem).toContain('not an absolute path');
    expect((await resolveConfiguredPath('/definitely/not/here/tool')).problem).toContain('does not exist');
    expect((await resolveConfiguredPath(process.execPath)).path).toBe(process.execPath);
    expect(expandHome('~/x')).not.toContain('~');
  });
});

describe('.editorconfig mapping', () => {
  it('maps the standard properties', () => {
    expect(editorConfigToStyle({ indent_style: 'tab', indent_size: 'tab', tab_width: 8, max_line_length: 100, end_of_line: 'crlf' })).toEqual({
      indentStyle: 'tabs',
      indentSize: 8,
      lineLength: 100,
      lineEndings: 'crlf',
    });
    expect(editorConfigToStyle({ indent_style: 'space', indent_size: 2, max_line_length: 'off' })).toEqual({ indentStyle: 'spaces', indentSize: 2 });
    expect(editorConfigToStyle({ max_line_length: '88', charset: 'utf-8' })).toEqual({ lineLength: 88 });
    expect(editorConfigToStyle({})).toEqual({});
  });
});

describe('file content checks', () => {
  it('recognises binary data and generated files', () => {
    expect(looksBinary(new Uint8Array([80, 75, 3, 4, 0, 0, 1]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode('plain text ✓'))).toBe(false);
    expect(looksGenerated('// Code generated by protoc-gen-go. DO NOT EDIT.\npackage x')).toBe(true);
    expect(looksGenerated('/* @generated SignedSource */')).toBe(true);
    expect(looksGenerated('// A function that generates reports\n')).toBe(false);
  });
});
