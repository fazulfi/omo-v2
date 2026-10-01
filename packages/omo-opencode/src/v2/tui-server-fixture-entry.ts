import { Plugin } from "@opencode/plugin"
import { z } from "zod"

/**
 * [OMC] task-15 server-side fixture entry — test-only, NOT part of the final
 * wiring. Provides a valid `server` entrypoint so the fixture package
 * directory loads cleanly via `opencode plugin list` in the headless harness.
 *
 * The real TUI surface lives in `tui.ts` (entrypoint `tui.js`, `registerTui`),
 * which is only executed by the OpenCode terminal process. A headless harness
 * has no TTY, so this no-op server entry exists purely to prove the package
 * loads without a "failed to load plugin" error, while the TUI binding itself
 * is runtime-proven via the mock-Context smoke test (see evidence).
 */
export const omoTuiServerFixture = Plugin.define({
  id: "omo-tui-test",
  async setup(ctx) {
    await ctx.rpc.register(
      {
        id: "omo.tui.fixture",
        methods: {
          status: {
            input: z.object({}),
            output: z.object({ ok: z.boolean(), stage: z.string() }),
          },
        },
        events: {},
      },
      {
        status: async () => ({ ok: true, stage: "server-fixture" }),
      },
    )
    return async () => undefined
  },
})

export default omoTuiServerFixture
