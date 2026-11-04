import type { KeywordType } from "../../config/schema/keyword-detector"

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

/** Team mode: `team mode`, `team-mode`, `team_mode`, `teammode` (case-insensitive). */
export const TEAM_PATTERN = /\bteam[\s_-]?mode\b/i

/**
 * Hyperplan: `hyperplan` or the `hpp` shorthand. The shorthand carries a
 * negative lookbehind so the C++ header extension `.hpp` (e.g.
 * `src/buffer.hpp`) does not falsely trigger — a dot would otherwise satisfy
 * `\b` because it is a non-word character (upstream #4215).
 */
export const HYPERPLAN_PATTERN = /\bhyperplan\b|(?<![\w.])hpp\b/i

/** Hyperplan-ultrawork combo: strict adjacency, both word orders (V1 parity). */
export const HYPERPLAN_ULTRAWORK_PATTERN =
  /\b(?:hpp|hyperplan)\s+(?:ulw|ultrawork)\b|\b(?:ulw|ultrawork)\s+(?:hpp|hyperplan)\b/i

export function stripCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, " ").replace(INLINE_CODE_PATTERN, " ")
}

/** A slash command is a user command, not an intent signal (V1 parity). */
export function looksLikeSlashCommand(text: string): boolean {
  return SLASH_COMMAND_LEAD_PATTERN.test(text)
}

// ---------------------------------------------------------------------------
// Directive-arm detection (V1 `hooks/keyword-detector/detector.ts` parity)
// ---------------------------------------------------------------------------

interface KeywordDetector {
  readonly type: KeywordType
  readonly pattern: RegExp
}

const KEYWORD_DETECTORS: readonly KeywordDetector[] = [
  { type: "ultrawork", pattern: ULTRAWORK_PATTERN },
  { type: "team", pattern: TEAM_PATTERN },
  { type: "hyperplan", pattern: HYPERPLAN_PATTERN },
  { type: "hyperplan-ultrawork", pattern: HYPERPLAN_ULTRAWORK_PATTERN },
]

export interface KeywordGates {
  /** Keyword types that never fire (`keyword_detector.disabled_keywords`). */
  readonly disabledKeywords?: readonly KeywordType[]
  /** When set, only these keyword types fire (`keyword_detector.enabled_expansions`). */
  readonly enabledExpansions?: readonly KeywordType[]
}

/**
 * Detect the armed keyword types for one message (V1 `detectKeywordsWithType`
 * parity, with the V1 `hook.ts` combo suppression folded in):
 *
 * - code blocks and inline code are stripped before matching;
 * - the combo requires BOTH base keywords enabled: disabling `ultrawork` OR
 *   `hyperplan` disables `hyperplan-ultrawork` too;
 * - an allowlist filters per type;
 * - when the combo fires, the standalone `ultrawork`/`hyperplan` matches from
 *   the same message are suppressed so the banners are not doubled.
 */
export function detectKeywordTypes(text: string, gates: KeywordGates = {}): KeywordType[] {
  const stripped = stripCodeBlocks(text)
  const disabled = new Set<KeywordType>(gates.disabledKeywords ?? [])
  if (disabled.has("ultrawork") || disabled.has("hyperplan")) {
    disabled.add("hyperplan-ultrawork")
  }
  const allowlist = gates.enabledExpansions ? new Set<KeywordType>(gates.enabledExpansions) : null

  const matched = KEYWORD_DETECTORS.filter(({ type, pattern }) => {
    if (!pattern.test(stripped)) return false
    if (allowlist && !allowlist.has(type)) return false
    if (disabled.has(type)) return false
    return true
  }).map(({ type }) => type)

  if (matched.includes("hyperplan-ultrawork")) {
    return matched.filter((type) => type !== "ultrawork" && type !== "hyperplan")
  }
  return matched
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

