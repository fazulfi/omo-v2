import { promises as nodeFs } from "node:fs"
import * as nodePath from "node:path"
import { Plugin } from "@opencode/plugin"
import type { KeywordType } from "../../config/schema/keyword-detector"
import { OhMyOpenCodeConfigSchema } from "../../config/schema/oh-my-opencode-config"
import { detectKeywordTypes, detectThinkKeyword, DISARM_PATTERN, looksLikeSlashCommand } from "./detection"
import { detectUltraworkSource, isNonOmoAgent, MODE_MARKERS, resolveModeBody, ULTRAWORK_MODE_TAG } from "./modes"
import { isAlreadyHighVariant } from "./think-mode"

/**
 * [OMC] v2 keyword detector (restores the V1 `hooks/keyword-detector` arms).
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
 *     Armed sessions get each armed mode's directive re-appended to
 *     `event.system` when no system part carries the mode marker AND no
 *     message in the request still contains it (post-compaction restoration).
 *
 * Arms (V1 keyword types, all four ported):
 *   - `ultrawork`/`ulw`  — model-routed directive, `agents.<id>.ultrawork`
 *     model override, sticky until `/stop-continuation`.
 *   - `team mode`        — team-mode directive body from prompts-core. The
 *     body keeps its own degraded-mode instruction (v2 has no `team_*` tools;
 *     the body tells the user to enable `team_mode.enabled`).
 *   - `hyperplan`/`hpp`  — adversarial-planning directive body.
 *   - `hyperplan-ultrawork` — strict-adjacency combo banner embedding the
 *     routed ultrawork body; requires BOTH base keywords enabled (V1 rule:
 *     disabling either base disables the combo) and suppresses the standalone
 *     arms in the same message.
 * Plus the V1 think arm: `think`/`ultrathink` (and V1's multilingual arms)
 * raise the session's reasoning variant to `high` via `session.switchModel`
 * with the SAME model id/providerID — never a model switch. The variant rides
 * the session's `Model.Ref`, so it survives compaction with no per-request
 * re-application; the context-hook `event.options` seam was rejected because
 * `variant` is not a `GenerationOptionsFields` key and would land in untyped
 * provider options. Think is not agent-gated (V1 parity) and needs no disarm —
 * the raise is idempotent and "already high+" sessions are left alone.
 */

export type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

interface SessionModelRef {
  id: string
  providerID: string
  variant?: string
}

interface SessionInfo {
  agent?: string
  parentID?: string
  model?: SessionModelRef
}

interface ArmedSession {
  readonly modes: Set<KeywordType>
  readonly switchedTo?: string
}

// ---------------------------------------------------------------------------
// Config (lazy omo.json read, mtime-cached)
// ---------------------------------------------------------------------------

type OmoConfig = ReturnType<typeof OhMyOpenCodeConfigSchema.parse>

const configCache = new Map<string, { mtimeMs: number; config: OmoConfig | null }>()

async function loadOmoConfig(directory: string | undefined): Promise<OmoConfig | null> {
  const base = directory ?? process.cwd()
  const file = nodePath.join(base, "omo.json")
  try {
    const stat = await nodeFs.stat(file)
    const cached = configCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.config
    const raw = JSON.parse(await nodeFs.readFile(file, "utf8"))
    const parsed = OhMyOpenCodeConfigSchema.safeParse(raw)
    const config = parsed.success ? parsed.data : null
    if (!parsed.success) {
      console.error("[OMC] keyword-detector: omo.json failed schema validation; ignoring file", parsed.error.message)
    }
    if (configCache.size > 8) configCache.clear()
    configCache.set(file, { mtimeMs: stat.mtimeMs, config })
    return config
  } catch {
    return null
  }
}

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

export async function registerKeywordDetector(ctx: PluginContext): Promise<() => Promise<void>> {
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
    get?: (input: { id: string }) => Promise<SessionInfo>
  }).get

  /**
   * Think arm: raise the session's reasoning variant to `high` on the SAME
   * model. Idempotent — "already high+" sessions keep their variant. The
   * switch lands before the turn's first request because prompt admission
   * blocks on this hook.
   */
  async function raiseThinkVariant(sessionID: string, getSessionInfo: () => Promise<SessionInfo | undefined>) {
    if (typeof switchModel !== "function") return
    const model = (await getSessionInfo())?.model
    if (!model?.id || !model.providerID) return
    if (isAlreadyHighVariant(model.id, model.variant)) return
    try {
      await Promise.race([
        switchModel({ sessionID, model: { id: model.id, providerID: model.providerID, variant: "high" } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10_000)),
      ])
      console.error(`[OMC] think-mode: variant raised to high (${model.providerID}/${model.id})`)
    } catch (error) {
      console.error("[OMC] think-mode: switchModel failed; continuing with the current variant", error)
    }
  }

  const promptHook = await ctx.session.hook("prompt", async (event) => {
    const sessionID = event.sessionID as string
    const text = event.prompt?.text ?? ""

    if (DISARM_PATTERN.test(text)) {
      armed.delete(sessionID)
      return
    }
    if (looksLikeSlashCommand(text)) return

    const config = await loadOmoConfig(ctx.location?.directory)

    let sessionInfo: SessionInfo | undefined
    let sessionInfoLoaded = false
    const getSessionInfo = async (): Promise<SessionInfo | undefined> => {
      if (!sessionInfoLoaded) {
        sessionInfoLoaded = true
        try {
          sessionInfo = await sessionGet?.({ id: sessionID })
        } catch {
          // Session lookup is best-effort; arming proceeds without agent gating.
        }
      }
      return sessionInfo
    }

    // Think arm first: it is independent of directive arming and, by V1
    // parity, not agent-gated — a subagent or builder session still gets the
    // variant raise when the user's message asks for maximum reasoning.
    if (detectThinkKeyword(text)) {
      await raiseThinkVariant(sessionID, getSessionInfo)
    }

    const state = armed.get(sessionID)
    let detectedTypes = detectKeywordTypes(text, {
      disabledKeywords: config?.keyword_detector?.disabled_keywords,
      enabledExpansions: config?.keyword_detector?.enabled_expansions,
    })
    if (config?.default_mode?.ultrawork === true && !detectedTypes.includes("ultrawork")) {
      detectedTypes = ["ultrawork", ...detectedTypes]
    }
    const freshTypes = state ? detectedTypes.filter((type) => !state.modes.has(type)) : detectedTypes
    if (freshTypes.length === 0) return

    const session = await getSessionInfo()
    const agentID = session?.agent
    if (session?.parentID || isNonOmoAgent(agentID)) return

    // The ultrawork model override applies whenever a fresh ultrawork-flavored
    // arm (ultrawork or the combo, which embeds the ultrawork body) fires.
    let switchedTo: string | undefined
    let overrideModelID: string | undefined
    if (
      (freshTypes.includes("ultrawork") || freshTypes.includes("hyperplan-ultrawork")) &&
      typeof switchModel === "function"
    ) {
      const override = resolveModelOverride(config, agentID)
      if (override && override.providerID && override.modelID) {
        overrideModelID = override.modelID
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
    }

    const source = detectUltraworkSource(agentID, overrideModelID ?? switchedTo)
    const bodies = freshTypes.map((type) => resolveModeBody(type, source))
    event.prompt.text = `${text}\n\n---\n\n${bodies.join("\n\n")}`

    const modes = new Set(state?.modes ?? [])
    for (const type of freshTypes) modes.add(type)
    trackArmed(sessionID, { modes, switchedTo: switchedTo ?? state?.switchedTo })
    console.error(`[OMC] keyword-detector: armed (modes=[${[...modes].join(", ")}], source=${source}, agent=${agentID ?? "unknown"})`)
  })

  const contextHook = await ctx.session.hook("context", (event) => {
    const sessionID = event.sessionID as string
    const state = armed.get(sessionID)
    if (!state) return

    // Re-route with the live request model (the switch may not have applied).
    const liveModelID = (event.model as { id?: string } | undefined)?.id
    const source = detectUltraworkSource(event.agent as string | undefined, liveModelID ?? state.switchedTo)
    const serializedMessages = event.messages.map((message) => JSON.stringify(message))

    for (const type of state.modes) {
      const marker = MODE_MARKERS[type]
      const markerPresent =
        event.system.some((part) => typeof part.text === "string" && part.text.includes(marker)) ||
        serializedMessages.some((blob) => blob.includes(marker))
      if (markerPresent) continue

      const body = resolveModeBody(type, source)
      // The ultrawork restoration keeps the V1-style "active" wrapper; the
      // other bodies already open with their own mode markers.
      const restoration = type === "ultrawork" ? `${ULTRAWORK_MODE_TAG}active</ultrawork-mode>\n\n${body}` : body
      event.system.push({ type: "text", text: restoration })
    }
  })

  return async () => {
    await promptHook.dispose()
    await contextHook.dispose()
    armed.clear()
  }
}
