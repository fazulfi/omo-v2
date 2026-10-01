import { Plugin } from "@opencode/plugin"
import { registerAgents } from "./agents"

/**
 * task-12 empirical fixture entry (temporary, not part of the shipped port).
 *
 * Loads the real `registerAgents` port into an isolated plugin so the agent
 * catalog, the subagent dispatch roundtrip and the unknown-agent error path can
 * be exercised against a live V2 server (see the task-12 runtime evidence).
 */
export default Plugin.define({
  id: "omo.agent-test",
  async setup(ctx) {
    return await registerAgents(ctx)
  },
})
