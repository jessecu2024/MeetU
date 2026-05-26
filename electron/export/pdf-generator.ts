// ============================================================
// PDF Generator (Main Process)
//
// Renders structured meeting minutes to PDF using Electron's own
// Chromium engine (`webContents.printToPDF`) rather than a JS PDF
// library. Why:
//   - This app is bilingual (EN + 中文). Chromium renders CJK with the
//     OS's system fonts automatically, so Chinese minutes "just work" —
//     no multi-MB CJK font to bundle, no font licensing to vet.
//   - We get real HTML/CSS layout (tables, wrapping, page breaks) for
//     free, and zero new npm dependencies.
//
// Split into two pieces:
//   - buildMinutesHtml(): pure string → string, fully testable in Node
//     (no Electron import). Builds a self-contained HTML document with
//     inline CSS and EVERY interpolated value HTML-escaped.
//   - renderMinutesPdf(): lazy-imports Electron, renders the HTML in a
//     hidden BrowserWindow, and returns the PDF Buffer. Electron-only,
//     so it is not unit-tested; the logic that matters (escaping,
//     section structure) lives in buildMinutesHtml.
// ============================================================

import type { MinutesPayload, DisclaimerPayload } from './docx-generator';

/** Escape a string for safe interpolation into HTML text/attribute. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(value: unknown): string {
  return escapeHtml(value);
}

/**
 * Build a self-contained HTML document for the meeting minutes. Pure
 * and deterministic; every interpolated value is HTML-escaped so AI/
 * user content can never break the markup or inject script (the print
 * window also runs with JavaScript disabled as defense-in-depth).
 */
export function buildMinutesHtml(
  minutes: MinutesPayload,
  disclaimer: DisclaimerPayload,
): string {
  const parts: string[] = [];

  parts.push(`<h1>${escapeHtml(minutes.title || 'Meeting Minutes')}</h1>`);
  if (minutes.executiveSummary) {
    parts.push(`<p class="summary">${escapeHtml(minutes.executiveSummary)}</p>`);
  }

  if (minutes.topics?.length) {
    parts.push(`<h2>Discussion Topics / 讨论议题</h2>`);
    for (const t of minutes.topics) {
      parts.push(`<h3>${escapeHtml(t.title || '(untitled)')}</h3>`);
      if (t.discussion) parts.push(`<p>${escapeHtml(t.discussion)}</p>`);
      if (t.keyPoints?.length) {
        parts.push(`<p class="label">Key Points / 要点:</p><ul>`);
        for (const p of t.keyPoints) parts.push(`<li>${escapeHtml(p)}</li>`);
        parts.push(`</ul>`);
      }
      if (t.decisions?.length) {
        parts.push(`<p class="label">Decisions / 决策:</p><ul>`);
        for (const d of t.decisions) parts.push(`<li>${escapeHtml(d)}</li>`);
        parts.push(`</ul>`);
      }
    }
  }

  if (minutes.actionItems?.length) {
    parts.push(`<h2>Action Items / 待办事项</h2>`);
    parts.push(`<table><thead><tr>`
      + `<th>Assignee / 负责人</th><th>Task / 任务</th>`
      + `<th>Deadline / 截止日期</th><th>Priority / 优先级</th>`
      + `</tr></thead><tbody>`);
    for (const a of minutes.actionItems) {
      parts.push(`<tr>`
        + `<td>${escapeHtml(a.assignee || '-')}</td>`
        + `<td>${escapeHtml(a.task || '-')}</td>`
        + `<td>${escapeHtml(a.deadline || '-')}</td>`
        + `<td>${escapeHtml(String(a.priority || '-'))}</td>`
        + `</tr>`);
    }
    parts.push(`</tbody></table>`);
  }

  if (minutes.openQuestions?.length) {
    parts.push(`<h2>Open Questions / 未解决问题</h2><ul>`);
    for (const q of minutes.openQuestions) parts.push(`<li>${escapeHtml(q)}</li>`);
    parts.push(`</ul>`);
  }

  if (minutes.nextSteps) {
    parts.push(`<h2>Next Steps / 下一步</h2><p>${escapeHtml(minutes.nextSteps)}</p>`);
  }
  if (minutes.nextMeetingSuggestion) {
    parts.push(`<p class="next-meeting"><em>Next Meeting / 下次会议: ${escapeHtml(minutes.nextMeetingSuggestion)}</em></p>`);
  }

  parts.push(`<footer>`
    + `<p>${escapeHtml(disclaimer.en)}</p>`
    + `<p>${escapeHtml(disclaimer.zh)}</p>`
    + `</footer>`);

  // Inline CSS. `lang="zh-CN"` + a font stack that lists common CJK
  // families lets Chromium pick the right system CJK font; if none of
  // the named families exist it still falls back to the platform
  // default sans, which on macOS/Windows covers CJK.
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escAttr(minutes.title || 'Meeting Minutes')}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei",
      "Noto Sans CJK SC", "Hiragino Sans GB", sans-serif;
    color: #1a1a1a; line-height: 1.5; font-size: 12px; margin: 0; padding: 0;
  }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  h3 { font-size: 13px; margin: 12px 0 4px; }
  p { margin: 4px 0; }
  p.summary { font-style: italic; color: #444; }
  p.label { font-weight: 600; margin-top: 8px; }
  ul { margin: 4px 0 4px 18px; padding: 0; }
  li { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0; }
  th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; font-weight: 600; }
  footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ddd; text-align: center; color: #888; font-style: italic; font-size: 11px; }
  footer p { margin: 2px 0; }
</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
}

/**
 * Render meeting minutes to a PDF Buffer via Electron's Chromium
 * print engine. Lazy-imports Electron so this module's pure half
 * (buildMinutesHtml) stays importable in plain-Node tests.
 *
 * The HTML is written to a temp file and loaded into a hidden,
 * script-disabled BrowserWindow that loads only that local file (no
 * remote content), then printed to PDF and torn down. The temp file
 * is always cleaned up.
 */
export async function renderMinutesPdf(
  minutes: MinutesPayload,
  disclaimer: DisclaimerPayload,
): Promise<Buffer> {
  const { BrowserWindow } = await import('electron');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const html = buildMinutesHtml(minutes, disclaimer);
  const tmpPath = path.join(os.tmpdir(), `meetu-minutes-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmpPath, html, 'utf-8');

  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 1130,
    webPreferences: {
      // Print-only window: no JS, sandboxed, isolated. It loads only
      // our generated local HTML file.
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadFile(tmpPath);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
    });
    return pdf;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    try { fs.unlinkSync(tmpPath); } catch { /* best effort */ }
  }
}
