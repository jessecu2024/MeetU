import { describe, it, expect } from 'vitest';
import { sanitizeFilename } from './exporter';

describe('sanitizeFilename', () => {
  it('keeps ASCII alphanumeric, underscore, and hyphen', () => {
    expect(sanitizeFilename('Sprint_42-planning')).toBe('Sprint_42-planning');
  });

  it('keeps Chinese characters', () => {
    expect(sanitizeFilename('产品评审会议')).toBe('产品评审会议');
  });

  it('replaces spaces with underscores', () => {
    expect(sanitizeFilename('Q1 planning sync')).toBe('Q1_planning_sync');
  });

  it('replaces filesystem-unsafe characters with underscores', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('caps output at 50 characters', () => {
    const longInput = 'a'.repeat(200);
    expect(sanitizeFilename(longInput)).toHaveLength(50);
  });

  it('handles mixed Chinese and English with punctuation', () => {
    expect(sanitizeFilename('Q1 评审 / 决策会议')).toBe('Q1_评审___决策会议');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeFilename('')).toBe('');
  });
});
