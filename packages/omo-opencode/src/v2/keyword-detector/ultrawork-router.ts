import { isGeminiModel, isGlmModel, isGptModel } from "@oh-my-opencode/model-core"
import {
  ULTRAWORK_DEFAULT_PROMPT,
  ULTRAWORK_GEMINI_PROMPT,
  ULTRAWORK_GLM_PROMPT,
  ULTRAWORK_GPT_PROMPT,
  ULTRAWORK_PLANNER_PROMPT,
} from "@oh-my-opencode/prompts-core"

/**
 * [OMC] v2 ultrawork message routing.
 *
 * Ports the V1 `hooks/keyword-detector/ultrawork/source-detector.ts` routing:
 * the same five ultrawork prompt variants, selected by agent name first and
 * model family second.
 */

/**
 * Planner agents (prometheus, plan) get the planner doctrine instead of the
 * execution protocol. They ARE the planner, so the execution framing does not
 * apply to them.
 */
export function isPlannerAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  if (lowerName.includes("prometheus") || lowerName.includes("planner")) return true

  const normalized = lowerName.replace(/[_-]+/g, " ")
  return /\bplan\b/.test(normalized)
}

/**
 * Non-OMO agents (OpenCode's built-in Builder/Plan) must not receive keyword
 * injection.
 */
export function isNonOmoAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  return lowerName.includes("builder") || lowerName === "plan"
}

export type UltraworkSource = "planner" | "gpt" | "gemini" | "glm" | "default"

const ULTRAWORK_PROMPTS: Record<UltraworkSource, string> = {
  planner: ULTRAWORK_PLANNER_PROMPT,
  gpt: ULTRAWORK_GPT_PROMPT,
  gemini: ULTRAWORK_GEMINI_PROMPT,
  glm: ULTRAWORK_GLM_PROMPT,
  default: ULTRAWORK_DEFAULT_PROMPT,
}

/**
 * Pick the ultrawork variant for the agent and model actually in play.
 */
export function getUltraworkSource(agentName?: string, modelID?: string): UltraworkSource {
  if (isPlannerAgent(agentName)) return "planner"
  if (modelID && isGptModel(modelID)) return "gpt"
  if (modelID && isGeminiModel(modelID)) return "gemini"
  if (modelID && isGlmModel(modelID)) return "glm"
  return "default"
}

export function getUltraworkMessage(agentName?: string, modelID?: string): string {
  return ULTRAWORK_PROMPTS[getUltraworkSource(agentName, modelID)]
}
