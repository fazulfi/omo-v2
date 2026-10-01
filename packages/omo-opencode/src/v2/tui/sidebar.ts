import type { Plugin } from "@opencode/plugin/tui"

import { validatePluginConfig } from "../../config/validate"
import { computeView, viewKey } from "../../features/tui-sidebar/compute-view"
import { POLL_INTERVAL_MS } from "../../features/tui-sidebar/constants"
import {
  deriveAgents,
  deriveConfig,
  deriveJobBoard,
  deriveLoop,
  deriveRoster,
} from "../../features/tui-sidebar/derivers"
import { readMirror } from "../../features/tui-sidebar/mirror-io"
import { buildViewNodes } from "../../features/tui-sidebar/render-view"
import { resolveRoster } from "../../features/tui-sidebar/roster-resolver"
import type { SidebarView } from "../../features/tui-sidebar/state-types"
import { log } from "../../shared/logger"
import { materializeNodes } from "./render"

/**
 * [OMC] v2 TUI sidebar slot (task 15).
 *
 * Ports the sidebar half of the V1 `tui.ts` module:
 *
 *   V1 `api.slots.register({ order: 900, slots: { sidebar_content } })`
 *   →  V2 `ctx.ui.slot({ append: "sidebar.content", render })`.
 *
 * The domain pipeline (validate config → read mirror → resolve roster →
 * `computeView` → `buildViewNodes`) is reused verbatim from
 * `features/tui-sidebar/*` (pure domain, importing nothing from the legacy
 * plugin surface). Only the host-facing shell changed:
 *
 *   - V1 imperative `api.renderer.requestRender()` on view-key change
 *     → V2 reactive `ctx.storage.memory` store. The slot `render` reads the
 *       store, so mutating it re-renders the claim reactively (Solid) without
 *       a manual render call.
 *   - V1 `api.state.path.directory` → V2 `ctx.location?.directory`.
 */

type SidebarState = {
  key: string
  view: SidebarView | null
}

function readSidebarView(directory: string): SidebarView {
  const validation = validatePluginConfig(directory)
  const mirror = readMirror(directory)
  const roster = resolveRoster(directory)
  return computeView({
    config: deriveConfig({ valid: validation.valid, messages: validation.messages }),
    roster: deriveRoster(roster),
    agents: deriveAgents(mirror),
    jobs: deriveJobBoard(mirror),
    loop: deriveLoop(mirror),
  })
}

/**
 * Registers the `sidebar.content` slot and starts the mirror-file poll loop.
 * Returns a cleanup function that clears the timer and unregisters the slot.
 */
export async function registerSidebarSlot(
  ctx: Plugin.Context,
): Promise<() => void> {
  const directory = ctx.location?.directory
  if (directory === undefined) {
    // V1 `api.state.path.directory` was always present; V2 `ctx.location`
    // is optional. Without a project directory the mirror-file path cannot be
    // resolved, so the sidebar is skipped (honest gap — documented in report).
    log("[tui-sidebar] no project directory; sidebar slot not registered")
    return () => undefined
  }

  const validation = validatePluginConfig(directory)
  if (validation.config.tui?.sidebar?.enabled === false) {
    log("[tui-sidebar] sidebar disabled by config")
    return () => undefined
  }

  const [state, mutate] = ctx.storage.memory<SidebarState>(
    "omo-sidebar-view",
    { initial: { key: "", view: null } },
  )

  let disposed = false
  let inFlight = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const unregisterSlot = ctx.ui.slot({
    append: "sidebar.content",
    render: () => {
      const view = state.view
      if (view === null) {
        return materializeNodes([])
      }
      return materializeNodes(buildViewNodes(view, ctx.theme))
    },
  })

  const applyView = (view: SidebarView): void => {
    const nextKey = viewKey(view)
    if (state.key === nextKey) return
    mutate((draft) => {
      draft.key = nextKey
      draft.view = view
    })
  }

  // Initial load (before the first paint, mirroring V1's awaited readView).
  try {
    applyView(readSidebarView(directory))
  } catch (error) {
    log("[tui-sidebar] initial view load failed", { error })
  }

  const schedule = (): void => {
    timer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  const tick = async (): Promise<void> => {
    if (disposed || inFlight) {
      if (!disposed) schedule()
      return
    }
    inFlight = true
    try {
      applyView(readSidebarView(directory))
    } catch (error) {
      log("[tui-sidebar] polling failed", { error })
    } finally {
      inFlight = false
      if (!disposed) schedule()
    }
  }

  schedule()

  return () => {
    disposed = true
    if (timer !== null) clearTimeout(timer)
    unregisterSlot()
  }
}
