import { ultraworkPromptVariants } from "@oh-my-opencode/prompts-core"

/**
 * [OMC] v2 keyword mode bodies.
 *
 * Ultrawork message routing ports the V1 `hooks/keyword-detector/ultrawork/
 * source-detector.ts`: the same five ultrawork prompt variants, selected by
 * agent name first and model family second. The model helpers (`isGptModel`/
 * `isGeminiModel`/`isGlmModel` from the deleted `src/agents/types.ts`) are
 * inlined as conservative substring checks.
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
