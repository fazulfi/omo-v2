import type { Plugin } from "@opencode/plugin"
import { z } from "zod"
import type { KeywordType } from "../../config/schema/keyword-detector"
import { KEYWORD_DETECTORS } from "./constants"
import { detectKeywordsWithType, looksLikeSlashCommand } from "./detector"
import { SessionModeStore } from "./session-modes"
import { getUltraworkMessage, isNonOmoAgent, isPlannerAgent } from "./ultrawork-router"

/**
 * [OMC] v2 ULW intent gate.
 *
 * Ports the V1 `hooks/keyword-detector` hook (bound to `chat.message`) onto the
 * V2 plugin contract.
 *
 * The V1 hook had one binding and two injection targets:
 *
 *   - `chat.message` appended the mode bodies to the user text part, and
 *   - `experimental.chat.system.transform` re-injected the ultrawork body into
 *     the system prompt after a compaction (or when `default_mode.ultrawork`
 *     was on).
 *
 * V2 splits that cleanly across two hooks:
 *
 *   - `ctx.session.hook("prompt")` detects the keyword types. The prompt
 *     payload carries neither the agent nor the model, so detection only needs
 *     the text; the armed types are remembered per session.
 *   - `ctx.session.hook("context")` resolves each armed mode against the agent
 *     and model actually in play (`input.agent`, `input.model.id`) and pushes
 *     the body into `input.system`.
 *
 * Injecting into the system prompt rather than the user text keeps the
 * directive standing across turns and restores it automatically after a
 * compaction, which is exactly what the V1 system-transform path did.
 */

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

export type KeywordDetectorOptions = {
  /** Keyword types that never fire. */
  readonly disabledKeywords?: readonly KeywordType[]
  /** When set, only these keyword types fire. */
  readonly enabledExpansions?: readonly KeywordType[]
  /** Inject the ultrawork body on every request, without a keyword. */
  readonly defaultModeUltrawork?: boolean
}

/** The marker each mode body carries, used to avoid double injection. */
const MODE_MARKERS: Record<KeywordType, string> = {
  ultrawork: "<ultrawork-mode>",
  team: "<team-mode>",
  hyperplan: "<hyperplan-mode>",
  "hyperplan-ultrawork": "<hyperplan-ultrawork-mode>",
}

function resolveModeMessage(type: KeywordType, agentName?: string, modelID?: string): string | undefined {
  const detector = KEYWORD_DETECTORS.find((candidate) => candidate.type === type)
  if (!detector) return undefined
  return typeof detector.message === "function" ? detector.message(agentName, modelID) : detector.message
}

/**
 * The modes that apply to the agent in play.
 *
 * Non-OMO agents (OpenCode's built-in Builder/Plan) get nothing. Planner
 * agents get the planner ultrawork doctrine but not the adversarial planning
 * modes, which are the job of the planner itself.
 */
export function selectApplicableModes(
  types: readonly KeywordType[],
  agentName?: string,
): KeywordType[] {
  if (isNonOmoAgent(agentName)) return []
  if (!isPlannerAgent(agentName)) return [...types]
  return types.filter((type) => type === "ultrawork" || type === "team")
}

export interface KeywordDetectorInjection {
  readonly sessionID: string
  readonly type: KeywordType
  readonly agent: string
  readonly model: string
  readonly characters: number
}

/**
 * Diagnostic RPC (id "omo.keyword"). The injected body lands in the system
 * prompt, which no session API exposes, so this RPC is the runtime seam that
 * proves the gate fired. It mirrors the other `omo.*` diagnostic RPCs.
 */
const omoKeywordRpc = {
  id: "omo.keyword",
  methods: {
    state: {
      input: z.object({ sessionID: z.string().optional() }),
      output: z.object({
        armed: z.array(z.object({ sessionID: z.string(), modes: z.array(z.string()) })),
        injections: z.array(
          z.object({
            sessionID: z.string(),
            type: z.string(),
            agent: z.string(),
            model: z.string(),
            characters: z.number(),
          }),
        ),
      }),
    },
  },
  events: {},
}

export async function registerKeywordDetector(
  ctx: PluginContext,
  options: KeywordDetectorOptions = {},
): Promise<() => Promise<void>> {
  const store = new SessionModeStore()
  const injections: KeywordDetectorInjection[] = []

  const promptHook = await ctx.session.hook("prompt", (input) => {
    const text = input.prompt.text
    if (typeof text !== "string" || text.length === 0) return
    // A slash command is a user command, not an intent signal.
    if (looksLikeSlashCommand(text)) return

    const detected = detectKeywordsWithType(
      text,
      undefined,
      undefined,
      options.disabledKeywords,
      options.enabledExpansions,
    )
    if (detected.length === 0) return
    store.arm(
      input.sessionID,
      detected.map(({ type }) => type),
    )
  })

  const contextHook = await ctx.session.hook("context", (input) => {
    const armed = store.get(input.sessionID)?.modes
    const types = new Set<KeywordType>(armed ?? [])
    if (options.defaultModeUltrawork) types.add("ultrawork")
    if (types.size === 0) return

    const agentName = input.agent
    const modelID = input.model.id
    for (const type of selectApplicableModes([...types], agentName)) {
      const message = resolveModeMessage(type, agentName, modelID)
      if (!message) continue
      const marker = MODE_MARKERS[type]
      if (input.system.some((part) => part.text.includes(marker))) continue
      input.system.push({ type: "text", text: message })
      injections.push({
        sessionID: input.sessionID,
        type,
        agent: agentName,
        model: modelID,
        characters: message.length,
      })
      while (injections.length > 100) injections.shift()
    }
  })

  const rpc = await ctx.rpc.register(omoKeywordRpc, {
    state: async (input) => ({
      armed: [...store.entries()].map(([sessionID, state]) => ({
        sessionID,
        modes: [...state.modes],
      })),
      injections: injections.filter(
        (injection) => input.sessionID === undefined || injection.sessionID === input.sessionID,
      ),
    }),
  })

  return async () => {
    await promptHook.dispose()
    await contextHook.dispose()
    await rpc.dispose()
  }
}
