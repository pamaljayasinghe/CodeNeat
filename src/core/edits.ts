import { diffLines } from 'diff';

export interface TextChange {
  /** UTF-16 offsets into the original text. */
  start: number;
  end: number;
  text: string;
}

const MAX_DIFF_LINES = 20000;

function countLines(text: string): number {
  let lines = 1;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      lines++;
    }
  }
  return lines;
}

/** One replacement covering everything between the common prefix and the common suffix. */
export function singleChange(original: string, formatted: string): TextChange[] {
  if (original === formatted) {
    return [];
  }
  const limit = Math.min(original.length, formatted.length);
  let prefix = 0;
  while (prefix < limit && original.charCodeAt(prefix) === formatted.charCodeAt(prefix)) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    original.charCodeAt(original.length - 1 - suffix) === formatted.charCodeAt(formatted.length - 1 - suffix)
  ) {
    suffix++;
  }
  // Never split a surrogate pair or a CRLF sequence.
  const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;
  while (prefix > 0 && (isLowSurrogate(original.charCodeAt(prefix)) || (original[prefix] === '\n' && original[prefix - 1] === '\r'))) {
    prefix--;
  }
  while (
    suffix > 0 &&
    (isLowSurrogate(original.charCodeAt(original.length - suffix)) ||
      (original[original.length - suffix] === '\n' && original[original.length - suffix - 1] === '\r'))
  ) {
    suffix--;
  }
  return [{ start: prefix, end: original.length - suffix, text: formatted.slice(prefix, formatted.length - suffix) }];
}

/**
 * Computes small, line-based replacements that turn `original` into `formatted`. Small edits let
 * the editor keep the cursor, selections and folding state where they were.
 */
export function computeChanges(original: string, formatted: string): TextChange[] {
  if (original === formatted) {
    return [];
  }
  if (countLines(original) > MAX_DIFF_LINES || countLines(formatted) > MAX_DIFF_LINES) {
    return singleChange(original, formatted);
  }
  const parts = diffLines(original, formatted);
  const changes: TextChange[] = [];
  let offset = 0;
  let pending: TextChange | undefined;
  for (const part of parts) {
    if (part.added) {
      pending ??= { start: offset, end: offset, text: '' };
      pending.text += part.value;
    } else if (part.removed) {
      pending ??= { start: offset, end: offset, text: '' };
      pending.end = offset + part.value.length;
      offset += part.value.length;
    } else {
      if (pending) {
        changes.push(pending);
        pending = undefined;
      }
      offset += part.value.length;
    }
  }
  if (pending) {
    changes.push(pending);
  }
  return changes;
}

/** Applies changes to a text; used by tests and by file-based workspace formatting. */
export function applyChanges(original: string, changes: TextChange[]): string {
  let result = '';
  let cursor = 0;
  for (const change of [...changes].sort((a, b) => a.start - b.start)) {
    result += original.slice(cursor, change.start) + change.text;
    cursor = change.end;
  }
  return result + original.slice(cursor);
}
