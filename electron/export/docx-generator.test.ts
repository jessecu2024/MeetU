import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { renderMinutesDocx, type MinutesPayload, type DisclaimerPayload } from './docx-generator';

const DISCLAIMER: DisclaimerPayload = {
  en: 'AI-generated; please verify.',
  zh: 'AI 生成,请核实。',
};

const FULL_MINUTES: MinutesPayload = {
  title: 'Q1 Review',
  executiveSummary: 'We hit 15% revenue growth and shipped onboarding v2.',
  topics: [
    {
      title: 'Performance',
      discussion: 'Revenue and conversion both up. Retention plateaued.',
      keyPoints: ['Revenue +15%', 'Conversion +22%'],
      decisions: ['Hold prices for Q2'],
    },
  ],
  actionItems: [
    { assignee: '张明', task: 'Draft Q2 plan', deadline: 'Friday', priority: 'high' },
    { assignee: 'Sarah', task: 'Vendor follow-up', deadline: '', priority: 'medium' },
  ],
  openQuestions: ['Should we delay v3 to focus on i18n?'],
  nextSteps: 'Q2 kickoff next Monday.',
  nextMeetingSuggestion: 'Same time next week.',
};

/**
 * docx is an Office Open XML container — a ZIP with an XML payload at
 * `word/document.xml`. Tests extract that XML and assert on its
 * contents directly, so a regression that silently dropped content
 * cannot pass by virtue of the buffer just being large enough.
 */
async function extractDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('docx is missing word/document.xml');
  return entry.async('string');
}

/** ZIP local file header magic, used as a cheap sanity check. */
function isValidZip(buf: Buffer): boolean {
  return buf.length >= 4
    && buf[0] === 0x50
    && buf[1] === 0x4B
    && buf[2] === 0x03
    && buf[3] === 0x04;
}

describe('renderMinutesDocx', () => {
  it('produces a valid Office Open XML container', async () => {
    const buf = await renderMinutesDocx(FULL_MINUTES, DISCLAIMER);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    expect(isValidZip(buf)).toBe(true);
    // word/document.xml must exist and be non-empty XML.
    const xml = await extractDocumentXml(buf);
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml.length).toBeGreaterThan(200);
  });

  it('handles minimal minutes (title only) without crashing', async () => {
    const buf = await renderMinutesDocx({ title: 'Empty Meeting' }, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('Empty Meeting');
  });

  it('handles minutes with no topics and empty arrays gracefully', async () => {
    const buf = await renderMinutesDocx({
      title: 'Quick Sync',
      executiveSummary: 'Nothing decided.',
      topics: [],
      actionItems: [],
      openQuestions: [],
    }, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('Quick Sync');
    expect(xml).toContain('Nothing decided');
  });

  it('embeds the title in the document XML', async () => {
    const buf = await renderMinutesDocx(FULL_MINUTES, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('Q1 Review');
  });

  it('embeds the executive summary text', async () => {
    const buf = await renderMinutesDocx(FULL_MINUTES, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('15% revenue growth');
    expect(xml).toContain('onboarding v2');
  });

  it('embeds every topic, its discussion, key points, and decisions', async () => {
    const buf = await renderMinutesDocx(FULL_MINUTES, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('Performance');
    expect(xml).toContain('Retention plateaued');
    expect(xml).toContain('Revenue +15%');
    expect(xml).toContain('Conversion +22%');
    expect(xml).toContain('Hold prices for Q2');
  });

  it('embeds every action item (assignee + task), including Han characters', async () => {
    const buf = await renderMinutesDocx(FULL_MINUTES, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('张明');
    expect(xml).toContain('Draft Q2 plan');
    expect(xml).toContain('Sarah');
    expect(xml).toContain('Vendor follow-up');
  });

  it('embeds open questions and next-steps sections', async () => {
    const buf = await renderMinutesDocx(FULL_MINUTES, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('focus on i18n');
    expect(xml).toContain('Q2 kickoff next Monday');
    expect(xml).toContain('Same time next week');
  });

  it('embeds BOTH the EN and ZH disclaimer footers', async () => {
    const buf = await renderMinutesDocx(FULL_MINUTES, DISCLAIMER);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('AI-generated; please verify');
    expect(xml).toContain('AI 生成');
  });
});
