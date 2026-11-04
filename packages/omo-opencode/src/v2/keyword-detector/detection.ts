/**
 * [OMC] v2 keyword detection primitives.
 *
 * Ports the text-scanning half of the V1 `hooks/keyword-detector/{constants,
 * detector}.ts` pair: code-block stripping, slash-command gating, the disarm
 * command, and the ultrawork trigger pattern. V1 scanned the text parts of a
 * chat message; in v2 the prompt arrives as one flat string, so the
 * part-level helpers collapse away.
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
