import { Plugin } from "@opencode/plugin"
import { ultraworkPromptVariants } from "@oh-my-opencode/prompts-core"
import { loadOmoConfig, type OmoConfig } from "./config"

/**
 * [OMC] v2 ultrawork port (restores the V1 keyword-detector `ultrawork` arm).
 *
 * V1 wiring (deleted in d6096afe2, task 18) used `chat.message` to append the
 * model-routed directive to the user message, `ultrawork-model-override.ts` to
 * swap `output.message.model/variant/thinking`, and
 * `experimental.chat.system.transform` to restore the directive after
 * compaction. None of those hooks exist in v2 (docs/v2-api-mapping.md G2).
 *
 * v2 mapping (verified against @opencode/plugin@2.0.20 `promise/session.d.ts`):
 *
 *   V1 `chat.message` keyword arm        → `ctx.session.hook("prompt")`.
 *     `SessionPrompt.prompt` is `DeepMutable`, so the directive is appended to
 *     `prompt.text` BEFORE admission — the injected bytes persist into the
 *     transcript (cache-stable by construction, V1 parity).
 *   V1 per-message `output.message.model`→ `ctx.session.switchModel`, awaited
 *     inside the prompt hook. v2 prompts carry no model; the admission blocks
 *     on the hook, making the switch land before the turn's first request.
 *     v2 `switchModel` is non-atomic for reverts, so — per the V1 sticky
 *     (`explicitUltraworkSessions`) semantics we keep — the override is STICKY
 *     until disarmed: no switch-back race.
 *   V1 `system.transform` restoration     → `ctx.session.hook("context")`.
 *     Armed sessions get the directive re-appended to `event.system` when no
 *     system part carries the marker AND no message in the request still
 *     contains it (post-compaction restoration).
 *
 * Deliberate scope: `ultrawork` only. The V1 team/hyperplan keyword expansions
 * stay unported; their config schemas remain at HEAD for a follow-up.
 */

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

type UltraworkSource = keyof typeof ultraworkPromptVariants

interface ArmedSession {
  readonly source: UltraworkSource
  readonly switchedTo?: string
}

// ---------------------------------------------------------------------------
// Detection (V1 `hooks/keyword-detector/{constants,detector}.ts` parity)
// ---------------------------------------------------------------------------

const ULTRAWORK_PATTERN = /\b(?:ultrawork|ulw)\b/i
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`]+`/g
const SLASH_COMMAND_LEAD_PATTERN = /^\s*\/[a-zA-Z][\w-]*(?:\s|$)/
const DISARM_PATTERN = /^\s*\/stop-continuation\b/
const ULTRAWORK_MODE_TAG = "<ultrawork-mode>"

function stripCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, " ").replace(INLINE_CODE_PATTERN, " ")
}

function looksLikeSlashCommand(text: string): boolean {
  return SLASH_COMMAND_LEAD_PATTERN.test(text)
}

/**
 * Model/agent routing (V1 `ultrawork/source-detector.ts` parity). The model
 * helpers (`isGptModel`/`isGeminiModel`/`isGlmModel` from the deleted
 * `src/agents/types.ts`) are inlined as conservative substring checks.
 */
function detectUltraworkSource(agentName?: string, modelID?: string): UltraworkSource {
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
function isNonOmoAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lower = agentName.toLowerCase()
  return lower.includes("builder") || lower === "plan" || lower === "general"
}

// ---------------------------------------------------------------------------
// Config: shared mtime-cached loader → ./config.ts (extracted 2026-11-04)
// ---------------------------------------------------------------------------

interface ResolvedModelOverride {
  providerID: string
  modelID: string
  variant?: string
}

function resolveModelOverride(config: OmoConfig | null, agentID?: string): ResolvedModelOverride | undefined {
  if (!config?.agents || !agentID) return undefined
  const agentConfig = (config.agents as Record<string, { ultrawork?: { model?: string; variant?: string } } | undefined>)[agentID]
  const ultrawork = agentConfig?.ultrawork
  if (!ultrawork?.model && !ultrawork?.variant) return undefined
  if (!ultrawork.model) return ultrawork.variant ? { providerID: "", modelID: "", variant: ultrawork.variant } : undefined
  const parts = ultrawork.model.split("/")
  if (parts.length < 2) return undefined
  return { providerID: parts[0], modelID: parts.slice(1).join("/"), variant: ultrawork.variant }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const MAX_TRACKED_SESSIONS = 1024

export async function registerUltrawork(ctx: PluginContext): Promise<() => Promise<void>> {
  const armed = new Map<string, ArmedSession>()

  function trackArmed(sessionID: string, entry: ArmedSession) {
    if (armed.size >= MAX_TRACKED_SESSIONS) {
      const oldest = armed.keys().next().value
      if (oldest !== undefined) armed.delete(oldest)
    }
    armed.set(sessionID, entry)
  }

  // Structural probes (slim-fork discipline): the branded schema types are not
  // worth importing for two calls; runtime shapes are stable in 2.0.20.
  const switchModel = (ctx.session as unknown as {
    switchModel?: (input: { sessionID: string; model: { id: string; providerID: string; variant?: string } }) => Promise<void>
  }).switchModel
  const sessionGet = (ctx.session as unknown as {
    get?: (input: { id: string }) => Promise<{ agent?: string; parentID?: string }>
  }).get

  await ctx.session.hook("prompt", async (event) => {
    const sessionID = event.sessionID as string
    const text = event.prompt?.text ?? ""

    if (DISARM_PATTERN.test(text)) {
      armed.delete(sessionID)
      return
    }
    if (looksLikeSlashCommand(text) || armed.has(sessionID)) return

    const config = await loadOmoConfig(ctx.location?.directory)
    if (config?.keyword_detector?.disabled_keywords?.includes("ultrawork")) return
    const allowlist = config?.keyword_detector?.enabled_expansions
    if (allowlist && !allowlist.includes("ultrawork")) return

    const detected = ULTRAWORK_PATTERN.test(stripCodeBlocks(text))
    const autoArm = config?.default_mode?.ultrawork === true
    if (!detected && !autoArm) return

    let agentID: string | undefined
    let parentID: string | undefined
    try {
      const session = await sessionGet?.({ id: sessionID })
      agentID = session?.agent
      parentID = session?.parentID
    } catch {
      // Session lookup is best-effort; arming proceeds without agent gating.
    }
    if (parentID || isNonOmoAgent(agentID)) return

    const override = resolveModelOverride(config, agentID)
    let switchedTo: string | undefined
    if (override && override.providerID && override.modelID && typeof switchModel === "function") {
      try {
        await Promise.race([
          switchModel({ sessionID, model: { id: override.modelID, providerID: override.providerID, ...(override.variant ? { variant: override.variant } : {}) } }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000)),
        ])
        switchedTo = `${override.providerID}/${override.modelID}`
        console.error(`[OMC] ultrawork: model switched to ${switchedTo}${override.variant ? ` (variant ${override.variant})` : ""}`)
      } catch (error) {
        console.error("[OMC] ultrawork: switchModel failed; continuing with the session model", error)
      }
    }

    const source = detectUltraworkSource(agentID, override?.modelID ?? switchedTo)
    const directive = ultraworkPromptVariants[source].content
    event.prompt.text = `${text}\n\n---\n\n${directive}`
    trackArmed(sessionID, { source, switchedTo })
    console.error(`[OMC] ultrawork: armed (source=${source}, agent=${agentID ?? "unknown"})`)
  })

  await ctx.session.hook("context", (event) => {
    const sessionID = event.sessionID as string
    const state = armed.get(sessionID)
    if (!state) return

    const markerPresent =
      event.system.some((part) => typeof part.text === "string" && part.text.includes(ULTRAWORK_MODE_TAG)) ||
      event.messages.some((message) =>
        JSON.stringify(message).includes(ULTRAWORK_MODE_TAG),
      )
    if (markerPresent) return

    // Re-route with the live request model (the switch may not have applied).
    const liveModelID = (event.model as { id?: string } | undefined)?.id
    const source = detectUltraworkSource(event.agent as string | undefined, liveModelID ?? state.switchedTo)
    event.system.push({
      type: "text",
      text: `${ULTRAWORK_MODE_TAG}active</ultrawork-mode>\n\n${ultraworkPromptVariants[source].content}`,
    })
  })

  return async () => {
    armed.clear()
  }
}
