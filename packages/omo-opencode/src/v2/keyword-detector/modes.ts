import { HYPERPLAN_MODE_PROMPT, TEAM_MODE_PROMPT, ultraworkPromptVariants } from "@oh-my-opencode/prompts-core"
import type { KeywordType } from "../../config/schema/keyword-detector"

/**
 * [OMC] v2 keyword mode bodies.
 *
 * Ultrawork message routing ports the V1 `hooks/keyword-detector/ultrawork/
 * source-detector.ts`: the same five ultrawork prompt variants, selected by
 * agent name first and model family second. The model helpers (`isGptModel`/
 * `isGeminiModel`/`isGlmModel` from the deleted `src/agents/types.ts`) are
 * inlined as conservative substring checks.
 *
 * The team and hyperplan bodies ship at HEAD in prompts-core
 * (`prompts/mode/{team,hyperplan}.md`). The team body deliberately keeps its
 * own degraded-mode instruction — v2 has no `team_*` tools, and the body
 * itself tells the user to enable `team_mode.enabled`; no tools are invented.
 */

export type UltraworkSource = keyof typeof ultraworkPromptVariants

/** Model/agent routing (V1 `ultrawork/source-detector.ts` parity). */
export function detectUltraworkSource(agentName?: string, modelID?: string): UltraworkSource {
  const agent = agentName?.toLowerCase() ?? ""
  if (agent.includes("prometheus") || agent.includes("planner") || /\bplan\b/.test(agent.replace(/[_-]+/g, " "))) {
    return "planner"
  }
  const model = modelID?.toLowerCase() ?? ""
  if (/gpt|codex/.test(model)) return "gpt"
  if (model.includes("gemini")) return "gemini"
  if (model.includes("glm")) return "glm"
  return "default"
}

/** Non-OMO agents (host built-ins) never receive keyword injection (V1 parity). */
export function isNonOmoAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lower = agentName.toLowerCase()
  return lower.includes("builder") || lower === "plan" || lower === "general"
}

/** The ultrawork mode tag, used for double-injection detection (V1 parity). */
export const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

export function getUltraworkDirective(source: UltraworkSource): string {
  return ultraworkPromptVariants[source].content
}

// ---------------------------------------------------------------------------
// Team / hyperplan / combo bodies (V1 `hooks/keyword-detector/{team,hyperplan,
// constants}/*.ts` parity)
// ---------------------------------------------------------------------------

const HYPERPLAN_ULTRAWORK_BANNER = `<hyperplan-ultrawork-mode>
**MANDATORY**: Say "HYPERPLAN ULTRAWORK MODE ENABLED!" exactly once as your first response. Do NOT say the standalone "ULTRAWORK MODE ENABLED!" or "HYPERPLAN MODE ENABLED!" banners.

Apply the ultrawork protocol below as your execution framework. You MUST ALSO load the hyperplan skill immediately via \`skill(name="hyperplan")\` and follow its full adversarial workflow — do NOT improvise, do NOT skip rounds, do NOT write the plan yourself.
</hyperplan-ultrawork-mode>`

/**
 * Markers used to detect an already-injected mode body. Each marker is a
 * string that ACTUALLY occurs in the injected body (the ultrawork variants
 * self-open with `<ultrawork-mode>`, the hyperplan body wraps itself in
 * `<hyperplan-mode>`, the combo banner in `<hyperplan-ultrawork-mode>`, and
 * the team body opens with a literal `[team-mode]` line), so post-compaction
 * restoration can tell "directive still present" from "directive gone"
 * without re-injecting on every request.
 */
export const MODE_MARKERS: Record<KeywordType, string> = {
  ultrawork: ULTRAWORK_MODE_TAG,
  team: "[team-mode]",
  hyperplan: "<hyperplan-mode>",
  "hyperplan-ultrawork": "<hyperplan-ultrawork-mode>",
}

/** Resolve the directive body for an armed mode (combo embeds the routed ultrawork body). */
export function resolveModeBody(type: KeywordType, source: UltraworkSource): string {
  switch (type) {
    case "ultrawork":
      return getUltraworkDirective(source)
    case "team":
      return TEAM_MODE_PROMPT
    case "hyperplan":
      return HYPERPLAN_MODE_PROMPT
    case "hyperplan-ultrawork":
      return `${HYPERPLAN_ULTRAWORK_BANNER}\n\n${getUltraworkDirective(source)}`
  }
}
