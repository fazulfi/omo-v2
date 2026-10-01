import { Plugin } from "@opencode/plugin"
import { z } from "zod"
import { registerAgents } from "./agents"
import { registerMcp } from "./mcp"
import { registerOrchestration } from "./orchestration"
import { registerSkills } from "./skills"
import { registerToolsAndHooks } from "./tools"

/**
 * [OMC] v2 entry point — full server-side wiring (tasks 9-15).
 *
 * This is the opencode v2 plugin contract port of the V1 `PluginModule`
 * server entry (src/index.ts → testing/create-plugin-module.ts). The TUI
 * binding layer is exposed as a separate `tui` entrypoint
 * (`src/v2/tui-entry.ts`, package exports `./tui`) mirroring the V1
 * `PluginModule { server, tui }` shape via `Host.resolve`
 * `Entrypoints{server, tui, rpc}`.
 *
 * Every feature register is isolated: one feature failing to register must
 * not take down the rest of the plugin. Cleanup functions are composed and
 * invoked in reverse registration order.
 */
const bootstrapRpc = {
  id: "omo",
  methods: {
    status: {
      input: z.object({}),
      output: z.object({ ok: z.boolean(), stage: z.string() }),
    },
  },
  events: {},
}

export const omoV2Plugin = Plugin.define({
  id: "oh-my-openagent",
  async setup(ctx) {
    await ctx.rpc.register(bootstrapRpc, {
      status: async () => ({ ok: true, stage: "bootstrap" }),
    })

    const cleanups: Array<() => Promise<void>> = []

    const disposeTools = await registerToolsAndHooks(ctx)
    cleanups.push(disposeTools)

    try {
      cleanups.push(await registerAgents(ctx))
    } catch (error) {
      console.error("[OMC] v2 registerAgents failed:", error)
    }

    try {
      cleanups.push(await registerOrchestration(ctx))
    } catch (error) {
      console.error("[OMC] v2 registerOrchestration failed:", error)
    }

    try {
      cleanups.push(await registerMcp(ctx))
    } catch (error) {
      console.error("[OMC] v2 registerMcp failed:", error)
    }

    try {
      cleanups.push(await registerSkills(ctx))
    } catch (error) {
      console.error("[OMC] v2 registerSkills failed:", error)
    }

    return async () => {
      for (const dispose of cleanups.reverse()) {
        try {
          await dispose()
        } catch (error) {
          console.error("[OMC] v2 dispose step failed:", error)
        }
      }
    }
  },
})

export default omoV2Plugin
