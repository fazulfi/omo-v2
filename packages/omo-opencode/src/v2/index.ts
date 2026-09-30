import { Plugin } from "@opencode/plugin"
import { z } from "zod"
import { registerToolsAndHooks } from "./tools"

/**
 * [OMC] v2 entry point — bootstrap lifecycle (task 9) + tools/hooks (task 10).
 *
 * This is the opencode v2 plugin contract port of the V1 `PluginModule`
 * entry (src/index.ts). Only the plugin definition, basic lifecycle
 * (setup/cleanup), a bootstrap RPC surface (omo.status) and the tools/hooks
 * surface (omo.tools) live here; the remaining feature ports (client, agents,
 * background tasks, MCP, TUI) are migrated in tasks 11-15 and wire into this
 * entry.
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
    const disposeTools = await registerToolsAndHooks(ctx)
    return async () => {
      await disposeTools()
    }
  },
})

export default omoV2Plugin
