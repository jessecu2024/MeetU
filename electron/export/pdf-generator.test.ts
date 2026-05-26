// Tests for the pure half of the PDF generator: HTML escaping and the
// minutes→HTML builder. The actual printToPDF step needs Electron's
// Chromium and is exercised manually (see docs/MANUAL_VERIFICATION.md);
// everything that affects correctness — escaping (no markup injection
// from AI/user content), section structure, optional-section handling —
// lives in buildMinutesHtml and is covered here.
import { describe, it, expect } from 'vitest';
import { escapeHtml, buildMinutesHtml } from './pdf-generator';
import type { MinutesPayload, DisclaimerPayload } from './docx-generator';

const DISCLAIMER: DisclaimerPayload = { en: 'AI-assisted. Verify key info.', zh: 'AI 辅助生成，请核实。' };

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<script>"x" & 'y'`)).toBe('&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;');
  });
  it('stringifies null/undefined/numbers safely', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
  it('leaves CJK and plain text untouched', () => {
    expect(escapeHtml('会议纪要 hello')).toBe('会议纪要 hello');
  });
});

describe('buildMinutesHtml', () => {
  const full: MinutesPayload = {
    title: '产品评审会议',
    executiveSummary: 'We reviewed Q1.',
    topics: [
      { title: 'Roadmap', discussion: 'discussed timeline', keyPoints: ['ship in March'], decisions: ['approved'] },
    ],
    actionItems: [
      { assignee: '张明', task: 'draft spec', deadline: '2026-06-01', priority: 'high' },
    ],
    openQuestions: ['budget?'],
    nextSteps: 'circulate notes',
    nextMeetingSuggestion: 'next Tuesday',
  };

  it('produces a complete HTML document with lang=zh-CN and a charset', () => {
    const html = buildMinutesHtml(full, DISCLAIMER);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/<html lang="zh-CN">/);
    expect(html).toMatch(/charset="utf-8"/i);
  });

  it('includes every section and the bilingual disclaimer', () => {
    const html = buildMinutesHtml(full, DISCLAIMER);
    expect(html).toContain('产品评审会议');
    expect(html).toContain('We reviewed Q1.');
    expect(html).toContain('Discussion Topics / 讨论议题');
    expect(html).toContain('Roadmap');
    expect(html).toContain('ship in March');
    expect(html).toContain('approved');
    expect(html).toContain('Action Items / 待办事项');
    expect(html).toContain('张明');
    expect(html).toContain('2026-06-01');
    expect(html).toContain('Open Questions / 未解决问题');
    expect(html).toContain('budget?');
    expect(html).toContain('Next Steps / 下一步');
    expect(html).toContain('circulate notes');
    expect(html).toContain('next Tuesday');
    expect(html).toContain('AI-assisted. Verify key info.');
    expect(html).toContain('AI 辅助生成，请核实。');
  });

  it('renders action items as a table with the bilingual header', () => {
    const html = buildMinutesHtml(full, DISCLAIMER);
    expect(html).toMatch(/<table>[\s\S]*<\/table>/);
    expect(html).toContain('Assignee / 负责人');
    expect(html).toContain('Priority / 优先级');
    expect(html).toContain('<td>draft spec</td>');
  });

  it('escapes AI/user content so it cannot inject markup', () => {
    const malicious: MinutesPayload = {
      title: '<script>alert(1)</script>',
      executiveSummary: 'a < b && c > d',
      topics: [{ title: '</td></table><img src=x onerror=alert(2)>', discussion: '"quoted"' }],
    };
    const html = buildMinutesHtml(malicious, DISCLAIMER);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d');
  });

  it('omits optional sections cleanly when absent (minimal payload)', () => {
    const minimal: MinutesPayload = { title: 'Quick Sync' };
    const html = buildMinutesHtml(minimal, DISCLAIMER);
    expect(html).toContain('Quick Sync');
    expect(html).not.toContain('Discussion Topics');
    expect(html).not.toContain('Action Items');
    expect(html).not.toContain('Open Questions');
    expect(html).not.toContain('Next Steps');
    // Disclaimer always present.
    expect(html).toContain('AI-assisted. Verify key info.');
  });

  it('falls back to a default title when none is given', () => {
    const html = buildMinutesHtml({ title: '' }, DISCLAIMER);
    expect(html).toContain('Meeting Minutes');
  });
});
