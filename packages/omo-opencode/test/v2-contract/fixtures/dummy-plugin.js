/**
 * Dummy plugin for INTEGRATION contract proof (task 6).
 *
 * Plain ESM module with the minimal opencode v2 plugin shape.
 * Loaded by the REAL @opencode/cli@2.0.20 in the task-3 isolated harness.
 */
const plugin = {
  id: "task6-dummy",
  async setup(ctx) {
    // Minimal lifecycle registration — prove setup(ctx) executes.
    if (ctx && typeof ctx.log === "function") {
      ctx.log.info("task6-dummy setup executed")
    }
  },
}

export default plugin
