import { HYPERPLAN_MODE_PROMPT, TEAM_MODE_PROMPT } from "@oh-my-opencode/prompts-core"
import type { KeywordType } from "../../config/schema/keyword-detector"
import { getUltraworkMessage } from "./ultrawork-router"

/**
 * [OMC] v2 keyword detectors.
 *
 * Ports the V1 `hooks/keyword-detector/constants.ts` table verbatim. V1 had
 * exactly four keyword types; the `search` and `analyze` modes were removed
 * upstream in b2f6bcdba.
 */

export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

/**
 * Team mode keyword detector.
 *
 * Triggers on: team mode, team-mode, team_mode, teammode (case-insensitive).
 */
export const TEAM_PATTERN = /\bteam[\s_-]?mode\b/i
export const TEAM_MESSAGE = TEAM_MODE_PROMPT

/**
 * Hyperplan keyword detector.
 *
 * The `hpp` shorthand carries a negative lookbehind so the very common C++
 * header extension `.hpp` (for example `src/buffer.hpp`) does not trigger
 * hyperplan mode. See upstream issue #4215.
 */
export const HYPERPLAN_PATTERN = /\bhyperplan\b|(?<![\w.])hpp\b/i
export const HYPERPLAN_MESSAGE = HYPERPLAN_MODE_PROMPT

/**
 * Hyperplan-ultrawork combo: strict adjacency, both word orders.
 */
export const HYPERPLAN_ULTRAWORK_PATTERN =
  /\b(?:hpp|hyperplan)\s+(?:ulw|ultrawork)\b|\b(?:ulw|ultrawork)\s+(?:hpp|hyperplan)\b/i

const HYPERPLAN_ULTRAWORK_BANNER = `<hyperplan-ultrawork-mode>
**MANDATORY**: Say "HYPERPLAN ULTRAWORK MODE ENABLED!" exactly once as your first response. Do NOT say the standalone "ULTRAWORK MODE ENABLED!" or "HYPERPLAN MODE ENABLED!" banners.

Apply the ultrawork protocol below as your execution framework. You MUST ALSO load the hyperplan skill immediately via \`skill(name="hyperplan")\` and follow its full adversarial workflow — do NOT improvise, do NOT skip rounds, do NOT write the plan yourself.
</hyperplan-ultrawork-mode>`

export function getHyperplanUltraworkMessage(agentName?: string, modelID?: string): string {
  return `${HYPERPLAN_ULTRAWORK_BANNER}\n\n${getUltraworkMessage(agentName, modelID)}`
}

export type KeywordDetector = {
  type: KeywordType
  pattern: RegExp
  message: string | ((agentName?: string, modelID?: string) => string)
}

export const KEYWORD_DETECTORS: KeywordDetector[] = [
  {
    type: "ultrawork",
    pattern: /\b(ultrawork|ulw)\b/i,
    message: getUltraworkMessage,
  },
  {
    type: "team",
    pattern: TEAM_PATTERN,
    message: TEAM_MESSAGE,
  },
  {
    type: "hyperplan",
    pattern: HYPERPLAN_PATTERN,
    message: HYPERPLAN_MESSAGE,
  },
  {
    type: "hyperplan-ultrawork",
    pattern: HYPERPLAN_ULTRAWORK_PATTERN,
    message: getHyperplanUltraworkMessage,
  },
]
