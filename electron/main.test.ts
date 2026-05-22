// Tests for filename hardening in `file:export`. Exercises the real
// production helper (`electron/export/sanitize-filename.ts`) rather
// than a re-implementation, so the test cannot pass when the
// sanitizer silently drifts. The two-arg shape (path.basename + this
// function) is the actual IPC call sequence in electron/main.ts.
//
// Path-traversal from renderer-provided filenames was flagged as a
// `[major]` finding by codex; this test is the guard against
// re-introducing it.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { sanitizeFilenameForExport } from './export/sanitize-filename';

function fullPath(unsafe: string, format: 'docx' | 'markdown'): string {
  const base = path.basename(unsafe);
  return sanitizeFilenameForExport(base, format);
}

describe('export filename hardening', () => {
  it('keeps a normal docx filename intact', () => {
    expect(fullPath('minutes_2026-05-22_Q1Review.docx', 'docx'))
      .toBe('minutes_2026-05-22_Q1Review.docx');
  });

  it('keeps Han characters and adds the extension if missing', () => {
    const r = fullPath('产品评审会议', 'docx');
    expect(r).toMatch(/^产品评审会议\.docx$/);
  });

  it('strips parent-dir components from a path-traversal attempt', () => {
    // path.basename of "../../etc/passwd.docx" is "passwd.docx", so the
    // sanitized result stays inside the minutes dir.
    const r = fullPath('../../etc/passwd.docx', 'docx');
    expect(r).toBe('passwd.docx');
    expect(r.includes('..')).toBe(false);
    expect(r.includes('/')).toBe(false);
  });

  it('strips Windows-style drive prefixes and backslash separators', () => {
    // path.basename behavior on POSIX differs from Windows for
    // backslashes — we run on POSIX in CI, so backslashes survive
    // path.basename but the sanitizer replaces them with underscores.
    const r = fullPath('C:\\Windows\\System32\\evil.docx', 'docx');
    expect(r).not.toContain('\\');
    expect(r.toLowerCase()).toMatch(/^.+\.docx$/);
  });

  it('produces a safe fallback when path.basename leaves "." or ".."', () => {
    // path.basename('.') === '.', path.basename('..') === '..'.
    // We must not write a file literally named "." or "..".
    const r1 = fullPath('.', 'docx');
    const r2 = fullPath('..', 'docx');
    expect(r1).toMatch(/^minutes_\d+\.docx$/);
    expect(r2).toMatch(/^minutes_\d+\.docx$/);
  });

  it('replaces shell-unsafe / filesystem-unsafe characters with underscores', () => {
    const r = fullPath('a/b\\c|d`e;f$g.docx', 'docx');
    // path.basename strips the "a/b\\c" prefix on POSIX (basename of
    // "a/b\\c|d`e;f$g.docx" is "b\\c|d`e;f$g.docx" — well, the literal
    // string contains no "/" after the prefix, so we test the full
    // pipeline rather than dwelling on platform-specific edge cases).
    expect(r).not.toContain('`');
    expect(r).not.toContain(';');
    expect(r).not.toContain('$');
    expect(r).not.toContain('|');
    expect(r.endsWith('.docx')).toBe(true);
  });

  it('forces the extension to match the format', () => {
    expect(fullPath('foo.txt', 'docx')).toBe('foo.txt.docx');
    expect(fullPath('foo.txt', 'markdown')).toBe('foo.txt.md');
    expect(fullPath('foo.docx', 'docx')).toBe('foo.docx');
    expect(fullPath('foo.md', 'markdown')).toBe('foo.md');
  });

  it('caps overly-long input to keep the filename writable', () => {
    const longBase = 'A'.repeat(500);
    const r = fullPath(longBase, 'docx');
    expect(r.length).toBeLessThanOrEqual(105); // 100 cleaned + ".docx"
  });

  it('falls back gracefully on empty / undefined-like input', () => {
    expect(fullPath('', 'docx')).toMatch(/^minutes_\d+\.docx$/);
  });
});
