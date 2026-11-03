import type { KeywordType } from "../../config/schema/keyword-detector"
import { CODE_BLOCK_PATTERN, INLINE_CODE_PATTERN, KEYWORD_DETECTORS } from "./constants"

/**
 * [OMC] v2 keyword detection.
 *
 * Ports the V1 `hooks/keyword-detector/detector.ts`. V1 scanned the text
 * parts of a chat message; in V2 the prompt arrives as one flat string, so the
 * part-level helpers collapse away.
 */

export interface DetectedKeyword {
  type: KeywordType
  message: string
}

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

const SLASH_COMMAND_LEAD_PATTERN = /^\s*\/[a-zA-Z][\w-]*(?:\s|$)/

/**
 * A slash command is a user command, not an intent signal. V1 skipped keyword
 * detection for these so `/ulw-something` never armed the mode.
 */
export function looksLikeSlashCommand(text: string): boolean {
  return SLASH_COMMAND_LEAD_PATTERN.test(text)
}

function resolveMessage(
  message: string | ((agentName?: string, modelID?: string) => string),
  agentName?: string,
  modelID?: string,
): string {
  return typeof message === "function" ? message(agentName, modelID) : message
}

export function detectKeywords(
  text: string,
  agentName?: string,
  modelID?: string,
  disabledKeywords?: readonly KeywordType[],
  enabledExpansions?: readonly KeywordType[],
): string[] {
  return detectKeywordsWithType(text, agentName, modelID, disabledKeywords, enabledExpansions).map(
    ({ message }) => message,
  )
}

export function detectKeywordsWithType(
  text: string,
  agentName?: string,
  modelID?: string,
  disabledKeywords?: readonly KeywordType[],
  enabledExpansions?: readonly KeywordType[],
): DetectedKeyword[] {
  const textWithoutCode = removeCodeBlocks(text)
  const disabled = new Set<KeywordType>(disabledKeywords ?? [])
  // The combo requires BOTH base keywords to be enabled.
  if (disabled.has("ultrawork") || disabled.has("hyperplan")) {
    disabled.add("hyperplan-ultrawork")
  }
  // Allowlist: when set, only those types fire.
  const allowlist = enabledExpansions ? new Set<KeywordType>(enabledExpansions) : null

  return KEYWORD_DETECTORS.map(({ type, pattern, message }) => ({
    matches: pattern.test(textWithoutCode),
    type,
    message: resolveMessage(message, agentName, modelID),
  }))
    .filter((result) => {
      if (!result.matches) return false
      if (allowlist && !allowlist.has(result.type)) return false
      if (disabled.has(result.type)) return false
      return true
    })
    .map(({ type, message }) => ({ type, message }))
}
