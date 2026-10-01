import type { Plugin } from "@opencode/plugin/tui"

import { log } from "../shared/logger"
import { registerBtwSideTui } from "./tui/btw"
import { registerNativeNudgeTui } from "./tui/native-nudge"
import { registerSidebarSlot } from "./tui/sidebar"

/**
 * [OMC] v2 TUI binding layer (task 15).
 *
 * Ports the V1 `TuiPluginModule` (`src/tui.ts`, `{ id, tui: async (api) => … }`)
 * to the V2 TUI plugin contract — `Plugin.define({ id, setup(context) })` from
 * `@opencode/plugin/tui` with a `Context` (`Plugin.Context`) in place of the
 * V1 `TuiPluginApi` object.
 *
 * The V2 entry point (`src/v2/index.ts`, task 9) registers the *server*
 * plugin. This file registers the *TUI* side, wired by the parent into the
 * same plugin definition as the `tui` feature (a plugin can expose both
 * `server` and `tui`; V2 loads them as one `Plugin.define` with both a domain
 * `setup` and a TUI `setup`).
 *
 * Slot map (docs/v2-api-mapping.md §4.3):
 *   - V1 `sidebar_content`                → V2 `sidebar.content`
 *   - V1 `session_prompt`/`session_prompt_right` → V2 `prompt.footer`
 *   - V1 `api.command.register` slash      → V2 `ctx.keymap.layer` slash
 *   - V1 `api.ui.dialog.select`           → V2 `ctx.ui.dialog.select`
 *   - V1 `api.lifecycle.onDispose`        → V2 `setup` return value (cleanup)
 *
 * @opentui/solid remains the rendering foundation (see `./tui/render.ts`).
 */
export async function registerTui(ctx: Plugin.Context): Promise<() => void> {
  const cleanups: Array<() => void> = []

  try {
    cleanups.push(await registerBtwSideTui(ctx))
  } catch (error) {
    log("[btw-side] TUI registration failed", { error })
  }

  try {
    cleanups.push(registerNativeNudgeTui(ctx))
  } catch (error) {
    log("[native-edition-nudge] TUI registration failed", { error })
  }

  try {
    cleanups.push(await registerSidebarSlot(ctx))
  } catch (error) {
    log("[tui-sidebar] TUI registration failed", { error })
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}
