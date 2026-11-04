/**
 * [OMC] v2 keyword detection primitives.
 *
 * Ports the text-scanning half of the V1 `hooks/keyword-detector/{constants,
 * detector}.ts` pair and the V1 `hooks/think-mode/detector.ts`: code-block
 * stripping, slash-command gating, the disarm command, and the per-mode
 * trigger patterns. V1 scanned the text parts of a chat message; in v2 the
 * prompt arrives as one flat string, so the part-level helpers collapse away.
 */

export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g
const SLASH_COMMAND_LEAD_PATTERN = /^\s*\/[a-zA-Z][\w-]*(?:\s|$)/

/** `/stop-continuation` disarms every armed keyword mode for the session (V1 parity). */
export const DISARM_PATTERN = /^\s*\/stop-continuation\b/

export const ULTRAWORK_PATTERN = /\b(?:ultrawork|ulw)\b/i

export function stripCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, " ").replace(INLINE_CODE_PATTERN, " ")
}

/** A slash command is a user command, not an intent signal (V1 parity). */
export function looksLikeSlashCommand(text: string): boolean {
  return SLASH_COMMAND_LEAD_PATTERN.test(text)
}

// ---------------------------------------------------------------------------
// Think mode (V1 `hooks/think-mode/detector.ts` parity)
// ---------------------------------------------------------------------------

/**
 * Multilingual "think" keywords, ported verbatim from V1. The English arms
 * are word-bounded; the multilingual arms match as substrings, exactly like
 * the V1 combined pattern did.
 */
const MULTILINGUAL_THINK_KEYWORDS = [
  "생각", "검토", "제대로",
  "思考", "考虑", "考慮",
  "考え", "熟考",
  "सोच", "विचार",
  "تفكير", "تأمل",
  "চিন্তা", "ভাবনা",
  "думать", "думай", "размышлять", "размышляй",
  "pensar", "pense", "refletir", "reflita",
  "piensa", "reflexionar", "reflexiona",
  "penser", "réfléchir", "réfléchis",
  "denken", "denk", "nachdenken",
  "suy nghĩ", "cân nhắc",
  "düşün", "düşünmek",
  "pensare", "pensa", "riflettere", "rifletti",
  "คิด", "พิจารณา",
  "myśl", "myśleć", "zastanów",
  "nadenken",
  "berpikir", "pikir", "pertimbangkan",
  "думати", "думай", "роздумувати",
  "σκέψου", "σκέφτομαι",
  "myslet", "mysli", "přemýšlet",
  "gândește", "gândi", "reflectă",
  "tänka", "tänk", "fundera",
  "gondolkodj", "gondolkodni",
  "ajattele", "ajatella", "pohdi",
  "tænk", "tænke", "overvej",
  "tenk", "tenke", "gruble",
  "חשוב", "לחשוב", "להרהר",
  "fikir", "berfikir",
]

const COMBINED_THINK_PATTERN = new RegExp(
  `\\b(?:ultrathink|think)\\b|${MULTILINGUAL_THINK_KEYWORDS.join("|")}`,
  "i",
)

/** True when the message asks for maximum-reasoning ("think"/"ultrathink" + V1 multilingual arms). */
export function detectThinkKeyword(text: string): boolean {
  return COMBINED_THINK_PATTERN.test(stripCodeBlocks(text))
}

