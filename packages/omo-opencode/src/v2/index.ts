import { Plugin } from "@opencode/plugin"
import { z } from "zod"

/**
 * [OMC] v2 entry point — bootstrap lifecycle only (task 9).
 *
 * This is the opencode v2 plugin contract port of the V1 `PluginModule`
 * entry (src/index.ts). Only the plugin definition, basic lifecycle
 * (setup/cleanup) and a bootstrap RPC surface live here; the feature
 * ports (tools/hooks, client, agents, background tasks, MCP, TUI) are
 * migrated in tasks 10-15 and wire into this entry.
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
    return () => {
      // Dispose (task 9): bootstrap RPC registration is torn down by the
      // host on unload; feature teardowns are added by tasks 10-15.
    }
  },
})

export default omoV2Plugin
