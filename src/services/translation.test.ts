import { describe, it, expect } from 'vitest';
import { detectLanguage } from './translation';

describe('detectLanguage', () => {
  it('returns "zh" for pure Chinese text', () => {
    expect(detectLanguage('你好世界')).toBe('zh');
  });

  it('returns "en" for pure English text', () => {
    expect(detectLanguage('Hello, world')).toBe('en');
  });

  it('returns "en" for the empty string (avoid divide-by-zero)', () => {
    expect(detectLanguage('')).toBe('en');
  });

  it('returns "en" for whitespace-only input', () => {
    expect(detectLanguage('   \t\n   ')).toBe('en');
  });

  it('classifies mixed text with majority Chinese as "zh"', () => {
    expect(detectLanguage('今天的 OKR 是 launch v2 但我们要先 review 数据')).toBe('zh');
  });

  it('classifies mostly-English text with a Chinese name as "en"', () => {
    // Just one Chinese name in a long English sentence — well below 30%.
    expect(detectLanguage('Let us hear what 张明 thinks about the new product strategy please')).toBe('en');
  });

  it('returns "en" when Chinese ratio is at or below 30% (strict ">")', () => {
    // 2 Chinese chars out of 10 non-whitespace chars = 20%, below the threshold.
    expect(detectLanguage('你好world1234')).toBe('en');
    // 3 Chinese chars out of 10 = exactly 30%, still 'en' under strict ">".
    expect(detectLanguage('你好家orld1234')).toBe('en');
  });

  it('returns "zh" when Chinese ratio exceeds 30%', () => {
    // 4 Chinese chars out of 10 non-whitespace chars = 40%.
    expect(detectLanguage('你好你好orld12')).toBe('zh');
  });

  it('handles punctuation and numbers correctly', () => {
    expect(detectLanguage('Q1 收入增长 15%, 环比 +5%')).toBe('zh');
  });

  it('ignores whitespace in ratio calculation', () => {
    expect(detectLanguage('   你    好    ')).toBe('zh');
  });
});
