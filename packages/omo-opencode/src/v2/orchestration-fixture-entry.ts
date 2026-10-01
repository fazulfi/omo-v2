/**
 * [OMC] v2 orchestration fixture entry (task 13 runtime proof).
 *
 * Standalone plugin bootstrap for the isolated harness: wires only the
 * orchestration surface (background tasks + todo roundtrip) into a dedicated
 * plugin id so it can be loaded without touching `src/v2/index.ts` (which is
 * wired by the parent in a later task).
 */
import { Plugin } from "@opencode/plugin"
import { registerOrchestration } from "./orchestration"

export const orchestrationFixturePlugin = Plugin.define({
  id: "omo-orch-test",
  async setup(ctx) {
    const cleanup = await registerOrchestration(ctx)
    return async () => {
      await cleanup()
    }
  },
})

export default orchestrationFixturePlugin
