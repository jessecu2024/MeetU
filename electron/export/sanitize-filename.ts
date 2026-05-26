// ============================================================
// Defense-in-depth filename sanitizer for `file:export` IPC.
//
// The renderer already runs its own sanitizer, but the main process
// must NOT trust the value it receives over IPC. A renderer bug,
// a feature flag that ships half-baked, or a future import-from-
// elsewhere flow could feed `../../etc/passwd.docx`.
//
// Callers MUST `path.basename` the renderer-supplied filename BEFORE
// passing it here. path.basename strips directory components so even
// a `../../foo` argument sees only `foo`. This function then:
//   - rejects empty / dot-only names with a unique fallback
//   - replaces every character that is not ASCII alphanumeric,
//     underscore, hyphen, Han, or dot with `_`
//   - caps the cleaned core at 100 bytes
//   - forces the file extension to match the export format
//
// Exported as its own module so tests exercise the real production
// code rather than a re-implementation. Previously the sanitizer
// lived inline in electron/main.ts and the test re-stated its rules,
// which made it possible for the two copies to drift apart silently.
// ============================================================

export type ExportFormat = 'docx' | 'markdown' | 'pdf';

/** Map an export format to its file extension (with leading dot). */
function extForFormat(format: string): string {
  switch (format) {
    case 'docx': return '.docx';
    case 'pdf': return '.pdf';
    default: return '.md'; // markdown (and any unknown format)
  }
}

export function sanitizeFilenameForExport(input: string, format: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9一-鿿_\-.]/g, '_')
    .slice(0, 100);

  const expectedExt = extForFormat(format);

  if (!cleaned || cleaned === '.' || cleaned === '..') {
    return `minutes_${Date.now()}${expectedExt}`;
  }

  return cleaned.toLowerCase().endsWith(expectedExt)
    ? cleaned
    : cleaned + expectedExt;
}
