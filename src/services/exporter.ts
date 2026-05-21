// ============================================================
// Export Service — Markdown and Word (.docx) export
// Saves to ~/MeetingAI/minutes/
// ============================================================

import type { MeetingMinutes } from './post-meeting';
import {
  EXPORT_DISCLAIMER_EN,
  EXPORT_DISCLAIMER_ZH,
} from '../config/legal-texts';

/** Generate Markdown content from meeting minutes */
export function minutesToMarkdown(minutes: MeetingMinutes): string {
  const lines: string[] = [];

  lines.push(`# ${minutes.title}`);
  lines.push('');
  lines.push(`> ${minutes.executiveSummary}`);
  lines.push('');

  // Topics
  if (minutes.topics?.length) {
    lines.push('## Discussion Topics / 讨论议题');
    lines.push('');
    for (const topic of minutes.topics) {
      lines.push(`### ${topic.title}`);
      lines.push('');
      lines.push(topic.discussion);
      lines.push('');
      if (topic.keyPoints?.length) {
        lines.push('**Key Points / 要点:**');
        for (const p of topic.keyPoints) lines.push(`- ${p}`);
        lines.push('');
      }
      if (topic.decisions?.length) {
        lines.push('**Decisions / 决策:**');
        for (const d of topic.decisions) lines.push(`- ${d}`);
        lines.push('');
      }
    }
  }

  // Action Items
  if (minutes.actionItems?.length) {
    lines.push('## Action Items / 待办事项');
    lines.push('');
    lines.push('| Assignee | Task | Deadline | Priority |');
    lines.push('|----------|------|----------|----------|');
    for (const a of minutes.actionItems) {
      lines.push(`| ${a.assignee} | ${a.task} | ${a.deadline || '-'} | ${a.priority || '-'} |`);
    }
    lines.push('');
  }

  // Open Questions
  if (minutes.openQuestions?.length) {
    lines.push('## Open Questions / 未解决问题');
    lines.push('');
    for (const q of minutes.openQuestions) lines.push(`- ${q}`);
    lines.push('');
  }

  // Next Steps
  if (minutes.nextSteps) {
    lines.push('## Next Steps / 下一步');
    lines.push('');
    lines.push(minutes.nextSteps);
    lines.push('');
  }

  if (minutes.nextMeetingSuggestion) {
    lines.push(`**Next Meeting / 下次会议:** ${minutes.nextMeetingSuggestion}`);
    lines.push('');
  }

  // Disclaimer
  lines.push('---');
  lines.push('');
  lines.push(`*${EXPORT_DISCLAIMER_EN}*`);
  lines.push('');
  lines.push(`*${EXPORT_DISCLAIMER_ZH}*`);

  return lines.join('\n');
}

/** Export meeting minutes as Markdown file */
export async function exportMarkdown(minutes: MeetingMinutes): Promise<string> {
  const content = minutesToMarkdown(minutes);
  const filename = `minutes_${new Date().toISOString().slice(0, 10)}_${sanitizeFilename(minutes.title)}.md`;

  const result = await window.electronAPI?.file.export('markdown', JSON.stringify({
    filename,
    content,
  }));

  return (result as string) || filename;
}

/**
 * Export meeting minutes as Word (.docx) file.
 *
 * NOT YET IMPLEMENTED — the `docx` dependency is installed but the generator
 * is still TODO. This function throws so callers can surface the state honestly
 * rather than silently writing a .md file with a .docx extension.
 */
export async function exportWord(_minutes: MeetingMinutes): Promise<string> {
  throw new Error(
    'Word (.docx) export is not yet implemented. Please use Markdown export for now. / ' +
    'Word 导出暂未实现，请先使用 Markdown 导出。'
  );
}

/**
 * Replace any character that is not ASCII alphanumeric, Han, underscore, or
 * hyphen with an underscore, and cap to 50 characters. Exported for testing.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 50);
}
