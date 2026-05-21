import { describe, it, expect } from 'vitest';
import { keywordMatch } from './mention-detector';

describe('keywordMatch', () => {
  it('matches an exact Chinese name', () => {
    expect(keywordMatch('张明，你怎么看？', '张明', 'Michael', [])).toBe(true);
  });

  it('matches an English name case-insensitively', () => {
    expect(keywordMatch('What does michael think?', '张明', 'Michael', [])).toBe(true);
  });

  it('matches an alias', () => {
    expect(keywordMatch('Mike, your turn', '', '', ['Mike', 'M'])).toBe(true);
  });

  it('returns false when no candidate is present', () => {
    expect(keywordMatch('Sarah, can you take this one?', '张明', 'Michael', ['Mike'])).toBe(false);
  });

  it('returns false when all identifiers are empty (unconfigured profile must not match)', () => {
    expect(keywordMatch('anything at all', '', '', [])).toBe(false);
  });

  it('ignores whitespace-only identifiers so they do not match every line', () => {
    // Previously a " " alias would match every non-empty string. That is wrong:
    // an unconfigured / placeholder alias must not cause every transcript to
    // be flagged as a mention.
    expect(keywordMatch('hello world', ' ', '   ', ['  '])).toBe(false);
  });

  it('matches a substring inside a longer word (intentional — short aliases)', () => {
    // Note: this is intentional. Aliases are short and meant to be permissive.
    // If false-positives become a problem we can switch to a word-boundary regex.
    expect(keywordMatch('Michaela presenting next', '', 'Michael', [])).toBe(true);
  });

  it('handles English text with mixed-case alias', () => {
    expect(keywordMatch('what does PM think?', '', '', ['PM'])).toBe(true);
    expect(keywordMatch('what does pm think?', '', '', ['PM'])).toBe(true);
  });

  it('returns true if any single candidate matches even when others are blank', () => {
    expect(keywordMatch('张明 here', '张明', '', [])).toBe(true);
  });
});
