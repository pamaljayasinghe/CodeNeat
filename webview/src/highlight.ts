import { diffLines } from 'diff';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dart from 'highlight.js/lib/languages/dart';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import fsharp from 'highlight.js/lib/languages/fsharp';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const GRAMMARS = {
  bash, c, cpp, csharp, css, dart, dockerfile, fsharp, go, graphql, ini, java, javascript, json, kotlin, latex, less, lua,
  markdown, php, powershell, protobuf, python, r, ruby, rust, scala, scss, sql, swift, typescript, xml, yaml,
};
for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Splits highlight.js output into one HTML fragment per line. Spans that cross a line break
 * (block comments, multi-line strings) are closed at the end of the line and reopened on the next.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = '';
  let index = 0;
  while (index < html.length) {
    const char = html[index];
    if (char === '<') {
      const end = html.indexOf('>', index);
      if (end === -1) {
        break;
      }
      const tag = html.slice(index, end + 1);
      if (tag.startsWith('</')) {
        open.pop();
      } else {
        open.push(tag);
      }
      current += tag;
      index = end + 1;
    } else if (char === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
      index++;
    } else {
      current += char;
      index++;
    }
  }
  lines.push(current + '</span>'.repeat(open.length));
  return lines;
}

/** Returns syntax-highlighted HTML, one entry per line. Falls back to plain escaped text. */
export function highlightLines(code: string, grammar: string): string[] {
  const text = code.replace(/\r\n?/g, '\n');
  if (text.length < 200_000 && hljs.getLanguage(grammar)) {
    try {
      return splitHighlightedLines(hljs.highlight(text, { language: grammar, ignoreIllegals: true }).value);
    } catch {
      // fall through to plain text
    }
  }
  return escapeHtml(text).split('\n');
}

export interface DiffMarks {
  /** Zero-based line numbers that differ on the original side. */
  left: Set<number>;
  /** Zero-based line numbers that differ on the formatted side. */
  right: Set<number>;
}

/** Works out which lines changed between the original and the formatted text. */
export function diffMarks(original: string, formatted: string): DiffMarks {
  const left = new Set<number>();
  const right = new Set<number>();
  const a = original.replace(/\r\n?/g, '\n');
  const b = formatted.replace(/\r\n?/g, '\n');
  if (a === b || a.length + b.length > 400_000) {
    return { left, right };
  }
  let leftLine = 0;
  let rightLine = 0;
  for (const part of diffLines(a, b)) {
    const count = part.count ?? part.value.split('\n').length - (part.value.endsWith('\n') ? 1 : 0);
    if (part.added) {
      for (let offset = 0; offset < count; offset++) {
        right.add(rightLine + offset);
      }
      rightLine += count;
    } else if (part.removed) {
      for (let offset = 0; offset < count; offset++) {
        left.add(leftLine + offset);
      }
      leftLine += count;
    } else {
      leftLine += count;
      rightLine += count;
    }
  }
  return { left, right };
}
