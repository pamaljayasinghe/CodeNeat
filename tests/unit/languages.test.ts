import { describe, expect, it } from 'vitest';
import { detectLanguage, getLanguage, languageFromFileName, LANGUAGES } from '../../src/shared/languages';

describe('language detection', () => {
  it.each([
    ['java', 'Main.java', 'java'],
    ['html', 'index.html', 'html'],
    ['rust', 'main.rs', 'rust'],
    ['go', 'main.go', 'go'],
    ['python', 'app.py', 'python'],
    ['typescript', 'script.ts', 'typescript'],
    ['typescriptreact', 'App.tsx', 'typescriptreact'],
    ['javascriptreact', 'App.jsx', 'javascriptreact'],
    ['shellscript', 'build.sh', 'shellscript'],
    ['jsonc', 'settings.json', 'jsonc'],
    ['dockercompose', 'docker-compose.yml', 'yaml'],
    ['cpp', 'main.cc', 'cpp'],
    ['proto3', 'api.proto', 'proto'],
  ])('maps VS Code language "%s" (%s) to %s', (vscodeId, fileName, expected) => {
    expect(detectLanguage(vscodeId, fileName)?.id).toBe(expected);
  });

  it.each([
    ['config.toml', 'toml'],
    ['App.vue', 'vue'],
    ['schema.graphql', 'graphql'],
    ['main.kt', 'kotlin'],
    ['Main.scala', 'scala'],
    ['main.tf', 'terraform'],
    ['paper.tex', 'latex'],
    ['Dockerfile', 'dockerfile'],
    ['Dockerfile.dev', 'dockerfile'],
    ['Gemfile', 'ruby'],
    ['analysis.R', 'r'],
    ['C:\\Users\\me\\project\\lib.dart', 'dart'],
    ['/home/me/query.SQL', 'sql'],
  ])('falls back to the file name for "%s" when VS Code only knows plaintext', (fileName, expected) => {
    expect(detectLanguage('plaintext', fileName)?.id).toBe(expected);
  });

  it('recognises Angular templates by file name even though VS Code calls them html', () => {
    expect(detectLanguage('html', '/app/user-list.component.html')?.id).toBe('angular');
    expect(detectLanguage('html', '/app/index.html')?.id).toBe('html');
  });

  it('prefers the VS Code language id over the file extension', () => {
    expect(detectLanguage('python', 'script.txt')?.id).toBe('python');
  });

  it('returns undefined for unsupported files', () => {
    expect(detectLanguage('plaintext', 'notes.txt')).toBeUndefined();
    expect(detectLanguage('plaintext', 'Untitled-1')).toBeUndefined();
    expect(languageFromFileName('.java')).toBeUndefined();
  });

  it('has unique ids and at least one formatter per language', () => {
    const ids = LANGUAGES.map((language) => language.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const language of LANGUAGES) {
      expect(language.formatters.length, language.id).toBeGreaterThan(0);
      expect(getLanguage(language.id)).toBe(language);
    }
  });

  it('never maps one VS Code language id to two languages', () => {
    const seen = new Map<string, string>();
    for (const language of LANGUAGES) {
      for (const id of language.vscodeIds) {
        expect(seen.get(id), `VS Code id ${id}`).toBeUndefined();
        seen.set(id, language.id);
      }
    }
  });
});
