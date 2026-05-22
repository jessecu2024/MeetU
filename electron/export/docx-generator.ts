// ============================================================
// DOCX Generator (Main Process)
// Builds a Word document from structured meeting minutes.
// Uses the `docx` library; runs in the Electron main process so we can
// write the resulting Buffer directly to disk without going through the
// renderer's Blob/File plumbing.
// ============================================================

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';

interface MinutesTopic {
  title: string;
  discussion: string;
  keyPoints?: string[];
  decisions?: string[];
}

interface MinutesActionItem {
  assignee: string;
  task: string;
  deadline?: string;
  priority?: 'high' | 'medium' | 'low' | string;
}

export interface MinutesPayload {
  title: string;
  executiveSummary?: string;
  topics?: MinutesTopic[];
  actionItems?: MinutesActionItem[];
  openQuestions?: string[];
  nextSteps?: string;
  nextMeetingSuggestion?: string;
}

export interface DisclaimerPayload {
  en: string;
  zh: string;
}

const BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
  right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
};

function bullet(text: string): Paragraph {
  return new Paragraph({
    text,
    bullet: { level: 0 },
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun({ text, bold: true })] });
}

function paragraph(text: string, options: { italic?: boolean; align?: 'center' } = {}): Paragraph {
  return new Paragraph({
    alignment: options.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [new TextRun({ text, italics: options.italic })],
  });
}

function actionItemsTable(items: MinutesActionItem[]): Table {
  const header = new TableRow({
    children: ['Assignee / 负责人', 'Task / 任务', 'Deadline / 截止日期', 'Priority / 优先级'].map(
      (h) => new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        width: { size: 25, type: WidthType.PERCENTAGE },
      })
    ),
  });

  const rows = items.map((a) => new TableRow({
    children: [
      new TableCell({ children: [paragraph(a.assignee || '-')] }),
      new TableCell({ children: [paragraph(a.task || '-')] }),
      new TableCell({ children: [paragraph(a.deadline || '-')] }),
      new TableCell({ children: [paragraph(String(a.priority || '-'))] }),
    ],
  }));

  return new Table({
    rows: [header, ...rows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BORDER.top,
      bottom: BORDER.bottom,
      left: BORDER.left,
      right: BORDER.right,
      insideHorizontal: BORDER.top,
      insideVertical: BORDER.left,
    },
  });
}

/**
 * Render structured meeting minutes as a Word (.docx) Buffer ready for
 * disk write. Exported so the IPC handler can call it; also makes the
 * generator testable in Node without spinning up Electron.
 */
export function renderMinutesDocx(
  minutes: MinutesPayload,
  disclaimer: DisclaimerPayload,
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // Title block
  children.push(heading(minutes.title || 'Meeting Minutes', HeadingLevel.HEADING_1));
  if (minutes.executiveSummary) {
    children.push(paragraph(minutes.executiveSummary, { italic: true }));
    children.push(new Paragraph({ text: '' })); // spacer
  }

  // Topics
  if (minutes.topics?.length) {
    children.push(heading('Discussion Topics / 讨论议题', HeadingLevel.HEADING_2));
    for (const t of minutes.topics) {
      children.push(heading(t.title || '(untitled)', HeadingLevel.HEADING_3));
      if (t.discussion) children.push(paragraph(t.discussion));
      if (t.keyPoints?.length) {
        children.push(paragraph('Key Points / 要点:'));
        for (const p of t.keyPoints) children.push(bullet(p));
      }
      if (t.decisions?.length) {
        children.push(paragraph('Decisions / 决策:'));
        for (const d of t.decisions) children.push(bullet(d));
      }
      children.push(new Paragraph({ text: '' }));
    }
  }

  // Action items as a table
  if (minutes.actionItems?.length) {
    children.push(heading('Action Items / 待办事项', HeadingLevel.HEADING_2));
    children.push(actionItemsTable(minutes.actionItems));
    children.push(new Paragraph({ text: '' }));
  }

  // Open questions
  if (minutes.openQuestions?.length) {
    children.push(heading('Open Questions / 未解决问题', HeadingLevel.HEADING_2));
    for (const q of minutes.openQuestions) children.push(bullet(q));
    children.push(new Paragraph({ text: '' }));
  }

  // Next steps + next meeting
  if (minutes.nextSteps) {
    children.push(heading('Next Steps / 下一步', HeadingLevel.HEADING_2));
    children.push(paragraph(minutes.nextSteps));
  }
  if (minutes.nextMeetingSuggestion) {
    children.push(paragraph(`Next Meeting / 下次会议: ${minutes.nextMeetingSuggestion}`, { italic: true }));
  }

  // Disclaimer footer
  children.push(new Paragraph({ text: '' }));
  children.push(paragraph(disclaimer.en, { italic: true, align: 'center' }));
  children.push(paragraph(disclaimer.zh, { italic: true, align: 'center' }));

  const doc = new Document({
    creator: 'MeetU',
    title: minutes.title || 'Meeting Minutes',
    description: 'AI-assisted meeting minutes generated by MeetU',
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
