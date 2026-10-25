/**
 * Marinara's prompt token estimate (port of shared/utils/token-estimator.ts), so budget
 * checks here agree with what Marinara trims: 0.25 per code point, more for CJK.
 */
export function estimateTokens(text: string): number {
  let hundredths = 0;
  for (const ch of text) hundredths += codePointHundredths(ch.codePointAt(0)!);
  return Math.ceil(hundredths / 100);
}

function codePointHundredths(cp: number): number {
  if ((cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff)) {
    return 50;
  }
  if (
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x323af) ||
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x31f0 && cp <= 0x31ff) ||
    (cp >= 0xff66 && cp <= 0xff9f) ||
    (cp >= 0x1b000 && cp <= 0x1b16f)
  ) {
    return 67;
  }
  return 25;
}

/** Marinara's default chat-wide lorebook token budget. */
export const DEFAULT_CHAT_LOREBOOK_BUDGET = 8192;
