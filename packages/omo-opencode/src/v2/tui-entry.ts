import { Plugin } from "@opencode/plugin/tui"

import { registerTui } from "./tui"

/**
 * [OMC] v2 TUI entry point (task 15) — the `tui` half of the V1
 * `PluginModule { server, tui }` shape. The host resolves this via package
 * exports `./tui` (`Host.resolve` → `Entrypoints{server, tui, rpc}`); the
 * server side lives in `src/v2/index.ts`.
 *
 * Id mirrors the V1 TUI module id (`oh-my-openagent:tui`).
 */
export const omoV2TuiPlugin = Plugin.define({
  id: "oh-my-openagent:tui",
  async setup(ctx) {
    return registerTui(ctx)
  },
})

export { registerTui }

export default omoV2TuiPlugin
