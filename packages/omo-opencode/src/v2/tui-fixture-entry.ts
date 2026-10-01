import { Plugin } from "@opencode/plugin/tui"

import { registerTui } from "./tui"

export { registerTui }

/**
 * [OMC] task-15 runtime fixture entry — NOT part of the final wiring (parent
 * wires `registerTui` into the real plugin definition alongside the server
 * `setup`). Builds a standalone TUI plugin that exercises the task-15
 * `registerTui(ctx)` binding layer against the isolated V2 harness.
 *
 * A V2 plugin package can expose both a `server` and a `tui` entrypoint
 * (see `@opencode/plugin/host` `Host.resolve` → `Entrypoints{server,tui,rpc}`);
 * this fixture only exercises the `tui` entrypoint. The server side of the
 * fixture is intentionally a no-op so `opencode plugin list` can load the
 * package directory without a TTY (the TUI `setup` runs in the terminal
 * process, which a headless harness cannot drive — documented in evidence).
 */
export const omoTuiFixturePlugin = Plugin.define({
  id: "omo-tui-test",
  async setup(ctx) {
    return registerTui(ctx)
  },
})

export default omoTuiFixturePlugin
