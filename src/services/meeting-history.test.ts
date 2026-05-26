// Tests for the meeting-history query builders. These are the
// load-bearing pieces: the SQL text is static and user input flows
// ONLY through bound params (with LIKE wildcards escaped), so the
// builders are where injection-safety and correctness live. The
// executors are thin wrappers over the db:query IPC and aren't unit-
// tested (they'd just assert the IPC was called).
import { describe, it, expect } from 'vitest';
import {
  escapeLike,
  buildListMeetingsQuery,
  buildMeetingTranscriptQuery,
  buildSearchQuery,
  buildDeleteMeetingQuery,
} from './meeting-history';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape char itself', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c\\d')).toBe('c\\\\d');
    expect(escapeLike('100%_done\\')).toBe('100\\%\\_done\\\\');
  });
  it('leaves ordinary text (incl. CJK) untouched', () => {
    expect(escapeLike('budget review 预算')).toBe('budget review 预算');
  });
});

describe('buildSearchQuery', () => {
  it('binds the query as a wildcard-wrapped, escaped LIKE param — never concatenated', () => {
    const { sql, params } = buildSearchQuery('roadmap');
    expect(sql).toMatch(/t\.text LIKE \? ESCAPE/);
    expect(sql).not.toContain('roadmap'); // not concatenated into SQL
    expect(params[0]).toBe('%roadmap%');
  });

  it('escapes wildcard characters inside the query before wrapping', () => {
    const { params } = buildSearchQuery('50% off');
    expect(params[0]).toBe('%50\\% off%');
  });

  it('declares the ESCAPE clause so the backslash escaping actually applies', () => {
    const { sql } = buildSearchQuery('x');
    expect(sql).toContain("ESCAPE '\\'");
  });

  it('joins meetings and orders newest-first with a bound limit', () => {
    const { sql, params } = buildSearchQuery('x', 42);
    expect(sql).toMatch(/JOIN meetings/);
    expect(sql).toMatch(/ORDER BY m\.start_time DESC/);
    expect(sql).toMatch(/LIMIT \?/);
    expect(params[1]).toBe(42);
  });

  it('only returns final transcript lines', () => {
    expect(buildSearchQuery('x').sql).toMatch(/is_final = 1/);
  });
});

describe('buildListMeetingsQuery', () => {
  it('selects meetings newest-first with a transcript count and bound limit', () => {
    const { sql, params } = buildListMeetingsQuery(25);
    expect(sql).toMatch(/FROM meetings/);
    expect(sql).toMatch(/COUNT\(\*\)/);
    expect(sql).toMatch(/ORDER BY m\.start_time DESC/);
    expect(sql).toMatch(/LIMIT \?/);
    expect(params).toEqual([25]);
  });
  it('defaults the limit when omitted', () => {
    expect(buildListMeetingsQuery().params).toEqual([100]);
  });
});

describe('buildMeetingTranscriptQuery', () => {
  it('binds the meeting id and orders by timeline, final lines only', () => {
    const { sql, params } = buildMeetingTranscriptQuery(7);
    expect(sql).toMatch(/WHERE meeting_id = \? AND is_final = 1/);
    expect(sql).toMatch(/ORDER BY start_ms ASC/);
    expect(params).toEqual([7]);
  });
});

describe('buildDeleteMeetingQuery', () => {
  it('deletes by bound id (cascade handles children)', () => {
    const { sql, params } = buildDeleteMeetingQuery(9);
    expect(sql).toMatch(/DELETE FROM meetings WHERE id = \?/);
    expect(params).toEqual([9]);
  });
});
