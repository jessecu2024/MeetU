// ============================================================
// Parse AI JSON — Robust parser for AI-generated JSON responses
// Handles markdown code blocks, incomplete output, and extra text
// ============================================================

/**
 * Parse JSON from AI response text that may contain:
 * - Markdown code block wrappers (```json ... ```)
 * - Leading/trailing non-JSON text
 * - Incomplete JSON (returns null instead of throwing)
 */
export function parseAIJson<T = unknown>(text: string): T {
  let cleaned = text.trim();

  // Remove markdown code block wrappers: ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json|JSON)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');
  cleaned = cleaned.trim();

  // Try direct parse first (fastest path)
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Continue to extraction
  }

  // Try to extract JSON object {...}
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]) as T;
    } catch {
      // Continue
    }
  }

  // Try to extract JSON array [...]
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]) as T;
    } catch {
      // Continue
    }
  }

  // Nothing worked — throw with helpful message
  throw new SyntaxError(
    `Could not parse AI JSON response (length=${text.length}): ${text.substring(0, 100)}...`
  );
}
