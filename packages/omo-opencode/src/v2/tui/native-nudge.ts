import type { Plugin } from "@opencode/plugin/tui"

import {
  applyNativeEditionNudgeAction,
  NATIVE_NUDGE_DIALOG_TITLE,
  NATIVE_NUDGE_OPTIONS,
  type NativeEditionNudgeAction,
} from "../../features/native-edition-nudge/tui"
import { createNudgeStateStore, nativeEditionStateDir } from "../../hooks/native-edition-nudge/state"

/**
 * [OMC] v2 TUI native-edition nudge (task 15).
 *
 * Ports `features/native-edition-nudge/tui.ts` `registerNativeEditionNudgeTui`
 * from the V1 `TuiApi` object to the V2 `Plugin.Context`:
 *
 *   - V1 `api.command.register(() => [{ slash: { name: "native" }, onSelect }])`
 *     → V2 `ctx.keymap.layer(() => ({ commands: [{ slash: { name: "native",
 *       aliases: ["omo-native"] }, palette: true, run: open }] }))`.
 *   - V1 `api.ui.dialog.replace(() => api.ui.DialogSelect({...}))`
 *     → V2 `ctx.ui.dialog.select({...})` (returns the selected value, or
 *       `undefined` on cancel).
 *   - V1 `api.ui.toast?.({ message })` → V2 `ctx.ui.toast.show({ message })`.
 *
 * The decision logic (`applyNativeEditionNudgeAction`) and the option list
 * (`NATIVE_NUDGE_OPTIONS`) are reused verbatim — pure domain, importing
 * nothing from the legacy plugin surface.
 */

export function registerNativeNudgeTui(ctx: Plugin.Context): () => void {
  const store = createNudgeStateStore(nativeEditionStateDir())

  const open = async (): Promise<void> => {
    const action = await ctx.ui.dialog.select<NativeEditionNudgeAction>({
      title: NATIVE_NUDGE_DIALOG_TITLE,
      placeholder: "The same omo as one command, with no host app",
      options: NATIVE_NUDGE_OPTIONS.map((option) => ({
        title: option.title,
        value: option.value,
      })),
    })
    if (action === undefined) return
    const result = applyNativeEditionNudgeAction(action, {
      store,
      now: Date.now(),
      bunAvailable: true,
    })
    // V1 parity: `registerNativeEditionNudgeTui` shows the toast and does not
    // open the guide URL itself (the `result.url` field is returned but
    // unused by the V1 TUI path).
    ctx.ui.toast.show({ message: result.toast })
  }

  ctx.keymap.layer(() => ({
    priority: 20_000,
    commands: [
      {
        title: "OmO Native",
        description: "Install the standalone OmO Native edition, or stop being reminded about it",
        group: "Session",
        slash: { name: "native", aliases: ["omo-native"] },
        palette: true,
        enabled: true,
        run: () => void open(),
      },
    ],
  }))

  // keymap.layer has no per-command unregister; the whole layer is owned by
  // the plugin and released when the plugin unloads. Nothing to clean up here.
  return () => undefined
}
