// ============================================================
// Shared Whisper hallucination filter.
//
// Whisper (the model) confidently transcribes silence / near-silence
// as a small set of recurring strings — the "thank you for watching"
// failure mode and Chinese-subtitle variants. This affects EVERY
// Whisper-family engine, so the heuristic lives here and is shared by
// both the cloud Whisper API engine (whisper-api-engine.ts) and the
// offline Local Whisper engine (local-whisper.ts), instead of one
// engine importing the other.
// ============================================================

/**
 * True if `text` matches a known Whisper silence-hallucination pattern
 * and should be dropped from the transcript.
 */
export function looksLikeHallucination(text: string): boolean {
  const trimmed = text.trim();
  // For letter-based patterns we strip trailing `.` / `!` so that
  // "Thank you", "Thank you.", "Thank you!" all collapse to the same
  // normalized form. We do NOT strip punctuation from the
  // punctuation-only cases ("..." / ". .") — those are checked against
  // `trimmed` directly below.
  const normalized = trimmed.toLowerCase().replace(/[!.]+$/, '');
  return (
    // English silent-segment hallucinations
    normalized === 'thank you' ||
    normalized === 'thanks for watching' ||
    normalized === 'thank you for watching' ||
    normalized === 'thank you so much for watching' ||
    normalized === 'thanks for watching everyone' ||
    normalized === 'thanks for watching the video' ||
    normalized === 'thank you very much' ||
    // Punctuation-only emissions Whisper produces on silence
    trimmed === '...' ||
    trimmed === '. .' ||
    trimmed === '。' ||
    // Common Chinese-subtitle hallucinations Whisper emits on silence.
    // The `\s*` is intentional: Whisper inserts spaces between Han and
    // Latin in its output ("字幕 by ..."), and the bare `字幕组` form
    // has no space.
    /^字幕\s*(组|by|提供)/i.test(trimmed) ||
    /^请订阅|^请关注/.test(trimmed)
  );
}
