export type Eol = '\n' | '\r\n';

/** Marker used in descriptors for formatters whose line endings CodeNeat converts itself. */
export const EOL_BY_CODENEAT = 'line endings are converted by CodeNeat after formatting';

/** Returns the dominant line ending of a text (LF when there are no line breaks). */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      if (index > 0 && text.charCodeAt(index - 1) === 13) {
        crlf++;
      } else {
        lf++;
      }
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

/** Rewrites every line break (CRLF, lone CR or LF) to the requested one. Content is untouched. */
export function normalizeEol(text: string, eol: Eol): string {
  const unix = text.replace(/\r\n?/g, '\n');
  return eol === '\n' ? unix : unix.replace(/\n/g, '\r\n');
}

/** Resolves the `lineEndings` preference against the original document. */
export function targetEol(preference: string | undefined, original: string): Eol {
  if (preference === 'lf') {
    return '\n';
  }
  if (preference === 'crlf') {
    return '\r\n';
  }
  return detectEol(original);
}
