import type { Plugin } from "@opencode/plugin/tui"
import { jsx } from "@opentui/solid/jsx-runtime"

import { log } from "../../shared/logger"
import { parseBtwQuestion } from "../../features/btw-side/btw-command-draft"
import { getBtwSideMetadata, type BtwSideMetadata } from "../../features/btw-side/metadata"
import { createBtwAdoptionCache } from "../../features/btw-side/tui-adoption-cache"
import { createBtwAdoptionGuard } from "../../features/btw-side/tui-adoption-guard"
import { createBtwSideController } from "../../features/btw-side/tui-controller"
import type { BtwSideControllerDependencies, BtwSideState } from "../../features/btw-side/tui-controller-types"
import { createBtwParentValidator } from "../../features/btw-side/tui-parent-validator"
import { buildBtwPickerOptions, parseBtwPickerValue } from "../../features/btw-side/tui-picker-options"
import { loadBtwSessionCatalog, type BtwCatalogSession } from "../../features/btw-side/tui-session-catalog"
import {
  createBtwControllerDependencies,
  currentTuiSessionID,
  isCurrentTuiSession,
  parentTuiStatusLabel,
  tuiDirectory,
} from "./session"

type BtwSideController = ReturnType<typeof createBtwSideController>

/**
 * [OMC] v2 TUI btw-side slot (task 15).
 *
 * Ports the BTW ("by-the-way" retained side-conversation) TUI layer
 * (`features/btw-side/tui-{wiring,picker,keymap,session-bridge}.ts`) from the
 * V1 `TuiPluginApi` object to the V2 `Plugin.Context`.
 *
 * Slot map (per docs/v2-api-mapping.md §4.3):
 *   - V1 `session_prompt` / `session_prompt_right` → V2 `prompt.footer`
 *     (the full prompt replacement has no V2 equivalent; the status label is
 *     reproduced as a reactive `prompt.footer` claim).
 *   - V1 `api.command.register` slash → V2 `ctx.keymap.layer({ commands:
 *     [{ slash: { name: "btw", aliases: ["side"] } }] })`.
 *   - V1 `api.keymap.registerLayer/intercept` → V2 `ctx.keymap.layer`.
 *   - V1 `api.ui.dialog.replace(() => api.ui.DialogSelect({...}))`
 *     → V2 `ctx.ui.dialog.select({...})`.
 *   - V1 `api.event.on("session.deleted", cb)` → V2
 *     `ctx.data.on("session.deleted", cb)`.
 *
 * The state machine (createBtwSideController), adoption guard/cache,
 * parent-validator and session-catalog are reused verbatim — pure domain,
 * importing nothing from the legacy plugin surface. The host-facing shell was
 * rewritten.
 */

type BtwUiState = {
  state: BtwSideState
  reattaching: readonly string[]
}

const INITIAL_BTW_UI_STATE: BtwUiState = {
  state: { phase: "closed" },
  reattaching: [],
}

export async function registerBtwSideTui(ctx: Plugin.Context): Promise<() => void> {
  log("[btw-side] TUI registration started")

  // Reactive mirror of the (non-reactive) controller state, so the
  // `prompt.footer` claim re-renders via Solid when the BTW phase changes.
  const [btwUi, setBtwUi] = ctx.storage.memory<BtwUiState>(
    "omo-btw-ui",
    { initial: INITIAL_BTW_UI_STATE },
  )

  const adoptionCache = createBtwAdoptionCache()
  const adoptionRequests = new Map<string, Promise<void>>()
  const reattachingSessions = new Set<string>()
  const adoptionFailures = new Set<string>()

  const directory = tuiDirectory(ctx) ?? process.cwd()

  let controller: BtwSideController | undefined

  const syncBtwUi = (): void => {
    const current = controller
    if (current === undefined) return
    setBtwUi((draft) => {
      draft.state = current.state()
      draft.reattaching = [...reattachingSessions]
    })
  }

  const dependencies: BtwSideControllerDependencies = {
    ...createBtwControllerDependencies(ctx),
    // The controller calls requestRender on every state change; piggyback the
    // reactive mirror sync onto it so the footer label stays in sync.
    requestRender: () => {
      syncBtwUi()
      ctx.renderer.requestRender()
    },
  }
  controller = createBtwSideController(dependencies)

  const adoptionGuard = createBtwAdoptionGuard(() => currentTuiSessionID(ctx))
  const parentValidator = createBtwParentValidator({
    fetchStatus: async (sessionID) => {
      try {
        await ctx.client.session.get({ sessionID })
        return "exists"
      } catch (error) {
        log("[btw-side] Failed to validate parent session", { sessionID, error })
        return "retry"
      }
    },
  })

  async function adoptValidatedMetadata(
    sessionID: string,
    parentSessionID: string,
  ): Promise<void> {
    if (controller === undefined) return
    if (!adoptionGuard.canApply(sessionID, parentSessionID)) return
    if (!(await parentValidator.exists(parentSessionID))) return
    if (!adoptionGuard.canApply(sessionID, parentSessionID)) return
    controller.adopt(parentSessionID, sessionID)
    syncBtwUi()
    log("[btw-side] TUI adopted side session", { sessionID, parentSessionID })
  }

  function adoptSideSession(sessionID: string): Promise<void> | undefined {
    const pending = adoptionRequests.get(sessionID)
    if (pending) return pending
    const cached = adoptionCache.read(sessionID)
    if (cached.hydrated) {
      if (!cached.metadata) return
      const request = adoptValidatedMetadata(sessionID, cached.metadata.parent_session_id).finally(() => {
        adoptionRequests.delete(sessionID)
      })
      adoptionRequests.set(sessionID, request)
      return request
    }
    reattachingSessions.add(sessionID)
    adoptionFailures.delete(sessionID)
    syncBtwUi()
    const request = (async (): Promise<void> => {
      try {
        const localSession = ctx.data.session.get(sessionID)
        let metadata: BtwSideMetadata | undefined
        if (localSession !== undefined) {
          metadata = getBtwSideMetadata(localSession)
        } else {
          const session = await ctx.client.session.get({ sessionID })
          metadata = getBtwSideMetadata(session)
        }
        if (!adoptionGuard.canApply(sessionID)) return
        adoptionCache.write(sessionID, metadata)
        if (metadata === undefined) return
        await adoptValidatedMetadata(sessionID, metadata.parent_session_id)
      } catch (error) {
        if (adoptionGuard.canApply(sessionID)) {
          adoptionFailures.add(sessionID)
        }
        log("[btw-side] Failed to adopt side session", { sessionID, error })
      } finally {
        reattachingSessions.delete(sessionID)
        adoptionRequests.delete(sessionID)
        syncBtwUi()
      }
    })()
    adoptionRequests.set(sessionID, request)
    return request
  }

  async function openBtw(): Promise<void> {
    log("[btw-side] TUI open command invoked")
    const sessionID = currentTuiSessionID(ctx)
    if (sessionID) await adoptSideSession(sessionID)
    if (!isCurrentTuiSession(ctx, sessionID)) return
    if (sessionID && adoptionFailures.has(sessionID)) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "Unable to verify whether this is a BTW conversation.",
      })
      return
    }
    // GAP: V2 exposes no prompt-replacement slot, so there is no prompt ref to
    // read a draft from. `startFromPrompt` (BTW from a drafted question) is
    // therefore unavailable and openBtw degrades to this unavailable toast,
    // matching the V1 branch when `api.ui.Prompt` returned no ref.
    ctx.ui.toast.show({
      variant: "warning",
      message: "BTW is unavailable before the session starts.",
    })
  }

  async function showBtwPicker(): Promise<void> {
    await openBtwPicker()
  }

  async function openBtwPicker(): Promise<boolean> {
    if (controller === undefined) return false
    const currentSessionID = currentTuiSessionID(ctx)
    if (!currentSessionID) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "BTW is unavailable before the session starts.",
      })
      return false
    }

    const listSessions = async (input: {
      readonly directory: string
      readonly roots: false
      readonly limit: number
    }): Promise<{ readonly data?: BtwCatalogSession[]; readonly error?: unknown }> => {
      try {
        const response = await ctx.client.session.list({
          limit: input.limit,
          directory: input.directory,
        })
        return {
          data: response.data.map((session) => ({
            id: session.id,
            title: session.title ?? "",
            ...(session.metadata !== undefined ? { metadata: session.metadata } : {}),
            time: { created: session.time.created, updated: session.time.updated },
          })),
        }
      } catch (error) {
        return { error }
      }
    }

    const loaded = await loadBtwSessionCatalog({
      currentSessionID,
      directory,
      listSessions,
    })

    if (!loaded.catalog && loaded.truncated) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "The BTW list is too large to show completely.",
      })
      return false
    }
    if (!loaded.catalog) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "This BTW conversation no longer has a main session.",
      })
      return false
    }
    if (loaded.truncated) {
      ctx.ui.toast.show({
        variant: "warning",
        message: "The BTW list is too large to show completely.",
      })
    }

    for (const [index, side] of loaded.catalog.sides.entries()) {
      controller.adopt(loaded.catalog.main.id, side.id, index + 1)
    }
    const picker = buildBtwPickerOptions(loaded.catalog, currentSessionID)

    const selectionValue = await ctx.ui.dialog.select<string>({
      title: "BTW conversations",
      placeholder: "Choose Main, a retained BTW, or New BTW",
      options: picker.options.map((option) => ({
        title: option.title,
        value: option.value,
        description: option.description,
        category: option.category,
        ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
      })),
      current: picker.current,
    })

    if (selectionValue === undefined) return false
    const selection = parseBtwPickerValue(selectionValue)
    if (!selection) return false

    if (selection.type === "new") {
      // GAP: "New BTW" requires the prompt draft (startFromPrompt), which is
      // unavailable without a V2 prompt ref (see openBtw gap note above).
      ctx.ui.toast.show({
        variant: "warning",
        message: "BTW is unavailable before the session starts.",
      })
      return false
    }

    try {
      await ctx.client.session.get({ sessionID: selection.sessionID })
    } catch (error) {
      log("[btw-side] Failed to validate picker selection", {
        sessionID: selection.sessionID,
        error,
      })
      ctx.ui.toast.show({
        variant: "warning",
        message: `BTW session ${selection.sessionID} no longer exists. Refreshing the list.`,
      })
      return openBtwPicker()
    }
    ctx.ui.router.navigate({ type: "session", sessionID: selection.sessionID })
    return true
  }

  // --- Keymap layer (slash + palette + ctrl+/ toggle + ctrl+c close) ---

  let shortcutOpening = false
  const openPickerFromShortcut = (name: string): void => {
    if (shortcutOpening) return
    shortcutOpening = true
    log("[btw-side] Picker keyboard shortcut invoked", { name })
    void showBtwPicker()
      .catch((error) => {
        log("[btw-side] Failed to open picker from keyboard shortcut", { error })
        ctx.ui.toast.show({
          variant: "error",
          message: "Unable to open BTW conversations.",
        })
      })
      .finally(() => {
        shortcutOpening = false
      })
  }

  ctx.keymap.layer(() => ({
    priority: 20_000,
    commands: [
      {
        id: "omo.btw.open",
        title: "BTW side conversation",
        description: "Start or switch retained side conversations without interrupting the main turn",
        group: "Session",
        palette: true,
        slash: { name: "btw", aliases: ["side"] },
        enabled: true,
        run: () => void openBtw(),
      },
      {
        id: "omo.btw.toggle",
        title: "Switch BTW conversation",
        group: "Session",
        bind: "ctrl+/",
        enabled: true,
        run: () => openPickerFromShortcut("binding"),
      },
      {
        id: "omo.btw.close",
        title: "Close BTW conversation",
        group: "Session",
        bind: "ctrl+c",
        enabled: () => (controller !== undefined ? controller.canCloseCurrentSide() : false),
        run: () => {
          if (controller !== undefined) void controller.close()
        },
      },
    ],
  }))

  // --- prompt.footer slot (status label; V1 session_prompt_right) ---

  // Reads the reactive `btwUi` store so Solid re-runs this claim whenever
  // `setBtwUi` mutates it (i.e. on every controller state change).
  const footerLabel = (
    sessionID: string | undefined,
    state: BtwSideState,
    reattaching: readonly string[],
  ): string | undefined => {
    if (sessionID === undefined) return undefined
    if (state.phase === "creating" && sessionID === state.parentSessionID) {
      return "BTW starting..."
    }
    if (state.phase === "open" && sessionID === state.parentSessionID) {
      return "BTW retained · ctrl+/ picker"
    }
    if (state.phase === "open" && sessionID === state.sideSessionID) {
      const sideNumber = controller?.sideNumber(state.sideSessionID)
      const sideLabel = sideNumber === undefined ? "BTW side" : `BTW #${sideNumber}`
      return `${sideLabel} · ${parentTuiStatusLabel(ctx, state.parentSessionID)} · esc esc return · ctrl+/ picker · ctrl+c delete`
    }
    if (state.phase === "closing" && sessionID === state.sideSessionID) {
      return "BTW closing..."
    }
    if (state.phase === "closed" && reattaching.includes(sessionID)) {
      return "BTW from main · reattaching..."
    }
    return undefined
  }

  const unregisterFooter = ctx.ui.slot({
    append: "prompt.footer",
    render: (input) => {
      const sessionID = input.sessionID ?? currentTuiSessionID(ctx)
      const label = footerLabel(sessionID, btwUi.state, btwUi.reattaching)
      if (label === undefined) return null
      return jsx("text", { fg: ctx.theme.textMuted, children: label })
    },
  })

  // --- session.deleted listener (V1 api.event.on) ---

  const unsubscribeDeleted = ctx.data.on("session.deleted", (event) => {
    const sessionID = event.data.sessionID
    adoptionGuard.markDeleted(sessionID)
    adoptionCache.removeForDeletion(sessionID)
    parentValidator.markDeleted(sessionID)
    if (controller !== undefined) controller.handleSessionDeleted(sessionID)
  })

  log("[btw-side] TUI controls registered")

  return () => {
    adoptionGuard.dispose()
    unsubscribeDeleted()
    unregisterFooter()
    if (controller !== undefined) void controller.dispose()
  }
}
