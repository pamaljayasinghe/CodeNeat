import { describe, expect, it } from 'vitest';
import { luaConfig, ruffConfig, shfmtOptions } from '../../src/adapters/wasm';
import { FormatterError, StyleReader } from '../../src/core/adapter';
import { getLanguage } from '../../src/shared/languages';
import { createService, makeSettings, withStyle } from '../helpers/harness';

/** Real output of the engines bundled as WebAssembly builds and of the PHP and LaTeX plugins. */
const { service, registry, env } = createService();
const run = (languageId: string, fileName: string, text: string, style = {}, formatterId?: string) =>
  service.format({ text, languageId, fileName }, withStyle(style), undefined, formatterId);
const longest = (text: string): number => Math.max(...text.split('\n').map((line) => line.length));

describe('languages that work with nothing installed', () => {
  it('every one of these languages has a bundled formatter', () => {
    const descriptors = registry.descriptors;
    const outOfTheBox = ['python', 'go', 'c', 'cpp', 'csharp', 'php', 'lua', 'dart', 'shellscript', 'dockerfile', 'proto', 'latex', 'java', 'sql', 'toml', 'xml', 'typescript', 'html'];
    for (const id of outOfTheBox) {
      const language = getLanguage(id);
      const hasBundled = language?.formatters.some((formatterId) => descriptors.find((descriptor) => descriptor.id === formatterId)?.kind === 'bundled');
      expect(hasBundled, id).toBe(true);
    }
  });

  it('falls back to the bundled engine when the installed tool is missing', async () => {
    if ((await registry.detect('gofmt', env)).available) {
      return;
    }
    const result = await service.format({ text: 'package main\nfunc main(){}\n', languageId: 'go', fileName: 'main.go' }, makeSettings());
    expect(result.formatterId).toBe('gofmt-wasm');
    expect(result.text).toBe('package main\n\nfunc main() {}\n');
  });
});

describe('Go (gofmt)', () => {
  it('formats with tabs and has no options to pretend about', async () => {
    const result = await run('go', 'main.go', 'package main\nimport "fmt"\nfunc main(){\nfmt.Println("hi")}\n', { indentStyle: 'spaces', lineLength: 40 }, 'gofmt-wasm');
    expect(result.text).toBe('package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n');
    expect(result.plan.resolved.options.indentStyle).toMatchObject({ source: 'fixed', value: 'tabs' });
  });

  it('reports syntax errors and changes nothing', async () => {
    const error = (await run('go', 'main.go', 'package main\nfunc {', {}, 'gofmt-wasm').catch((reason: unknown) => reason)) as FormatterError;
    expect(error).toBeInstanceOf(FormatterError);
    expect(error.kind).toBe('failed');
    expect(error.message).toContain("expected 'IDENT'");
  });
});

describe('Python (Ruff)', () => {
  const CODE = "def greet(name,punctuation='!'):\n  return 'hello '+name+punctuation\n";

  it('applies quotes, indentation and line length', async () => {
    expect((await run('python', 'a.py', CODE, {}, 'ruff-wasm')).text).toBe('def greet(name, punctuation="!"):\n    return "hello " + name + punctuation\n');
    expect((await run('python', 'a.py', CODE, { quoteStyle: 'single', indentSize: 2 }, 'ruff-wasm')).text).toBe("def greet(name, punctuation='!'):\n  return 'hello ' + name + punctuation\n");
    expect((await run('python', 'a.py', CODE, { quoteStyle: 'preserve', indentStyle: 'tabs' }, 'ruff-wasm')).text).toBe("def greet(name, punctuation='!'):\n\treturn 'hello ' + name + punctuation\n");
    const call = 'result = some_function(argument_number_one, argument_number_two, argument_number_three, argument_number_four)\n';
    expect(longest((await run('python', 'a.py', call, { lineLength: 60 }, 'ruff-wasm')).text)).toBeLessThanOrEqual(60);
    expect((await run('python', 'a.py', call, { lineLength: 120 }, 'ruff-wasm')).text).toBe(call);
  });

  it('never reorders or removes imports', async () => {
    const text = 'import sys\nimport os\n\nprint(os.name)\n';
    expect((await run('python', 'a.py', text, {}, 'ruff-wasm')).text).toBe(text);
  });

  it('reports syntax errors', async () => {
    await expect(run('python', 'a.py', 'def f(:\n', {}, 'ruff-wasm')).rejects.toMatchObject({ kind: 'failed' });
  });
});

describe('C, C++, C# and Protocol Buffers (clang-format)', () => {
  const C = 'int main(){if(x){return 1;}return 0;}\n';

  it('applies indentation, brace style and line length', async () => {
    expect((await run('c', 'a.c', C, {}, 'clang-format-wasm')).text).toBe('int main() {\n  if (x) {\n    return 1;\n  }\n  return 0;\n}\n');
    expect((await run('c', 'a.c', C, { indentSize: 4, braceStyle: 'allman' }, 'clang-format-wasm')).text).toBe(
      'int main()\n{\n    if (x)\n    {\n        return 1;\n    }\n    return 0;\n}\n',
    );
    expect((await run('cpp', 'a.cpp', C, { indentStyle: 'tabs', indentSize: 4 }, 'clang-format-wasm')).text).toContain('\n\tif (x) {\n\t\treturn 1;');
    const call = 'int r = some_function(argument_number_one, argument_number_two, argument_number_three, argument_number_four);\n';
    expect(longest((await run('c', 'a.c', call, { lineLength: 60 }, 'clang-format-wasm')).text)).toBeLessThanOrEqual(60);
  });

  it('uses the base style of each language', async () => {
    const cs = await run('csharp', 'a.cs', 'class A{void F(){int x=1;}}\n', {}, 'clang-format-wasm');
    expect(cs.text).toBe('class A\n{\n    void F()\n    {\n        int x = 1;\n    }\n}\n');
    const proto = await run('proto', 'a.proto', 'syntax="proto3";message A{string id=1;}\n', {}, 'clang-format-wasm');
    expect(proto.text).toBe('syntax = "proto3";\nmessage A {\n  string id = 1;\n}\n');
  });

  it('formats only the selected lines', async () => {
    const text = 'int  a;\nint  b;\nint  c;\n';
    const result = await service.format({ text, languageId: 'c', fileName: 'a.c', range: { start: 8, end: 15 } }, makeSettings(), undefined, 'clang-format-wasm');
    expect(result.text).toBe('int  a;\nint b;\nint  c;\n');
  });
});

describe('Lua, shell, Dockerfile, PHP and LaTeX', () => {
  it('Lua (StyLua): indentation and quotes', async () => {
    const code = "local function f(a) if a then return 'x' end end\n";
    expect((await run('lua', 'a.lua', code, {}, 'stylua-wasm')).text).toBe('local function f(a)\n\tif a then\n\t\treturn "x"\n\tend\nend\n');
    expect((await run('lua', 'a.lua', code, { indentStyle: 'spaces', indentSize: 2, quoteStyle: 'single' }, 'stylua-wasm')).text).toBe("local function f(a)\n  if a then\n    return 'x'\n  end\nend\n");
    await expect(run('lua', 'a.lua', 'local x = = 1', {}, 'stylua-wasm')).rejects.toMatchObject({ kind: 'failed' });
  });

  it('shell (shfmt): indentation and case labels', async () => {
    const code = 'if true;then\necho hi\nfi\ncase $x in\na) echo a;;\nesac\n';
    expect((await run('shellscript', 'a.sh', code, {}, 'shfmt-wasm')).text).toBe('if true; then\n\techo hi\nfi\ncase $x in\na) echo a ;;\nesac\n');
    expect((await run('shellscript', 'a.sh', code, { indentStyle: 'spaces', indentSize: 2, indentCaseLabels: true }, 'shfmt-wasm')).text).toBe(
      'if true; then\n  echo hi\nfi\ncase $x in\n  a) echo a ;;\nesac\n',
    );
    await expect(run('shellscript', 'a.sh', 'if then fi (', {}, 'shfmt-wasm')).rejects.toMatchObject({ kind: 'failed' });
  });

  it('Dockerfile (dockerfmt): formats, and survives a broken file', async () => {
    const code = 'FROM   node:20\nRUN   npm ci &&     npm run build\n';
    expect((await run('dockerfile', 'Dockerfile', code, {}, 'dockerfmt-wasm')).text).toBe('FROM node:20\nRUN npm ci && npm run build\n');
    await expect(run('dockerfile', 'Dockerfile', 'FROM a\nRUN "unterminated', {}, 'dockerfmt-wasm')).rejects.toMatchObject({ kind: 'failed' });
    // The engine must still work after it has rejected a file.
    expect((await run('dockerfile', 'Dockerfile', code, { indentSize: 2 }, 'dockerfmt-wasm')).text).toBe('FROM node:20\nRUN npm ci && npm run build\n');
  }, 30000);

  it('PHP: quotes, indentation and syntax errors', async () => {
    const code = '<?php\nfunction f($a){return "x".$a;}\n';
    expect((await run('php', 'a.php', code, {}, 'prettier-php')).text).toBe('<?php\nfunction f($a)\n{\n    return "x" . $a;\n}\n');
    expect((await run('php', 'a.php', code, { quoteStyle: 'single', indentSize: 2 }, 'prettier-php')).text).toBe("<?php\nfunction f($a)\n{\n  return 'x' . $a;\n}\n");
    await expect(run('php', 'a.php', '<?php function f( {', {}, 'prettier-php')).rejects.toBeInstanceOf(FormatterError);
  });

  it('LaTeX: indents environments and leaves verbatim alone', async () => {
    const code = '\\begin{itemize}\n\\item One\n\\end{itemize}\n\\begin{verbatim}\n  keep   this\n\\end{verbatim}\n';
    const result = await run('latex', 'a.tex', code, { indentStyle: 'spaces', indentSize: 2 }, 'prettier-latex');
    expect(result.text).toBe('\\begin{itemize}\n  \\item One\n\\end{itemize}\n\\begin{verbatim}\n  keep   this\n\\end{verbatim}\n');
  });
});

describe('preference mapping for the bundled engines', () => {
  const reader = (style: Record<string, string | number | boolean>) => new StyleReader(style, Object.keys(style));

  it('passes only what was chosen', () => {
    expect(ruffConfig(reader({}))).toEqual({});
    expect(luaConfig(reader({}))).toEqual({});
    expect(shfmtOptions(reader({}))).toEqual({});
    expect(ruffConfig(new StyleReader({ lineLength: 88, indentSize: 4 }, []))).toEqual({});
  });

  it('maps every supported preference', () => {
    expect(ruffConfig(reader({ lineLength: 100, indentStyle: 'tabs', indentSize: 2, quoteStyle: 'preserve', pythonMagicTrailingComma: false, formatDocComments: true }))).toEqual({
      line_width: 100,
      indent_style: 'tab',
      indent_width: 2,
      quote_style: 'preserve',
      magic_trailing_comma: 'ignore',
      docstring_code: true,
    });
    expect(luaConfig(reader({ lineLength: 100, indentStyle: 'spaces', indentSize: 2, quoteStyle: 'single', luaCallParentheses: 'None' }))).toEqual({
      line_width: 100,
      indent_style: 'space',
      indent_width: 2,
      quote_style: 'AutoPreferSingle',
      call_parentheses: 'None',
    });
    expect(shfmtOptions(reader({ indentStyle: 'tabs', indentSize: 8, operatorLinePosition: 'start', shellSpaceRedirects: true }))).toEqual({ indent: 0, binaryNextLine: true, spaceRedirects: true });
    expect(shfmtOptions(reader({ indentStyle: 'spaces', indentSize: 2, indentCaseLabels: true, shellFunctionNextLine: true }))).toEqual({ indent: 2, switchCaseIndent: true, funcNextLine: true });
  });
});
