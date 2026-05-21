import { describe, it, expect } from 'vitest';
import { parseAIJson } from './parse-ai-json';

describe('parseAIJson', () => {
  it('parses clean JSON object', () => {
    const r = parseAIJson<{ a: number }>('{"a": 1}');
    expect(r.a).toBe(1);
  });

  it('parses clean JSON array', () => {
    const r = parseAIJson<number[]>('[1, 2, 3]');
    expect(r).toEqual([1, 2, 3]);
  });

  it('strips ```json fenced code blocks', () => {
    const input = '```json\n{"a": 1}\n```';
    expect(parseAIJson<{ a: number }>(input).a).toBe(1);
  });

  it('strips generic ``` fenced code blocks', () => {
    const input = '```\n{"a": 1}\n```';
    expect(parseAIJson<{ a: number }>(input).a).toBe(1);
  });

  it('handles case-insensitive JSON fence', () => {
    const input = '```JSON\n{"a": 1}\n```';
    expect(parseAIJson<{ a: number }>(input).a).toBe(1);
  });

  it('extracts JSON object surrounded by prose', () => {
    const input = 'Here is the result:\n{"a": 1}\nLet me know if you need more.';
    expect(parseAIJson<{ a: number }>(input).a).toBe(1);
  });

  it('extracts JSON array surrounded by prose', () => {
    const input = 'Sure: [1, 2, 3] — does that work?';
    expect(parseAIJson<number[]>(input)).toEqual([1, 2, 3]);
  });

  it('handles trimmed whitespace and trailing newlines', () => {
    const input = '\n\n  {"a": 1}  \n\n';
    expect(parseAIJson<{ a: number }>(input).a).toBe(1);
  });

  it('prefers object extraction when both fence-stripped and embedded text are present', () => {
    const input = '```json\n{"keyPoints":["a","b"]}\n```';
    const r = parseAIJson<{ keyPoints: string[] }>(input);
    expect(r.keyPoints).toEqual(['a', 'b']);
  });

  it('throws SyntaxError for unparseable input', () => {
    expect(() => parseAIJson('not json at all')).toThrow(SyntaxError);
  });

  it('throws for completely empty input', () => {
    expect(() => parseAIJson('')).toThrow(SyntaxError);
  });

  it('parses nested JSON object', () => {
    const input = '{"outer":{"inner":[1,2,{"deep":"value"}]}}';
    const r = parseAIJson<{ outer: { inner: unknown[] } }>(input);
    expect(r.outer.inner[2]).toEqual({ deep: 'value' });
  });
});
