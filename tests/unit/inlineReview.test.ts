import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { computeHunks } from '../../src/vscode/inlineReview';

describe('inline review highlights', () => {
  it('marks changed lines and remembers what they replaced', () => {
    expect(computeHunks('a\nb\nc\n', 'a\nB\nc\n')).toEqual([{ line: 1, added: 1, before: 'b\n' }]);
  });

  it('marks added lines, and removed lines at the place they were', () => {
    expect(computeHunks('a\nc\n', 'a\nb1\nb2\nc\n')).toEqual([{ line: 1, added: 2, before: '' }]);
    expect(computeHunks('a\nx\ny\nc\n', 'a\nc\n')).toEqual([{ line: 1, added: 0, before: 'x\ny\n' }]);
    expect(computeHunks('a\nx\n', 'a\n')).toEqual([{ line: 1, added: 0, before: 'x\n' }]);
  });

  it('handles one line becoming several, several hunks, and Windows line endings', () => {
    expect(computeHunks('function f(){return 1}\nconst a=1\n', 'function f() {\n  return 1;\n}\nconst a = 1;\n')).toEqual([
      { line: 0, added: 4, before: 'function f(){return 1}\nconst a=1\n' },
    ]);
    expect(computeHunks('x=1\nkeep\ny=2\n', 'x = 1\nkeep\ny = 2\n')).toEqual([
      { line: 0, added: 1, before: 'x=1\n' },
      { line: 2, added: 1, before: 'y=2\n' },
    ]);
    expect(computeHunks('a\r\nb\r\n', 'a\r\nB\r\n')).toEqual([{ line: 1, added: 1, before: 'b\n' }]);
    expect(computeHunks('same\n', 'same\n')).toEqual([]);
  });
});
