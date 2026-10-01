import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { registerMcp } from "./mcp"
import { registerSkills } from "./skills"
import { registerConfigMigrationDryRun } from "./config-migration"

/**
 * [OMC] task-14 runtime fixture entry — NOT part of the final `index.ts`
 * wiring (parent wires the real entry). Builds a standalone plugin that
 * exercises the three task-14 modules against the isolated V2 harness:
 *
 *   - `registerMcp`       → builtin MCP injection + a local stdio `omo-echo`
 *                           server (runtime proof: server visible in the list)
 *   - `registerSkills`    → fallback scan of `~/.config/opencode/skills`
 *   - `registerConfigMigrationDryRun` → dry-run field/file rename report
 *
 * RPC surface (unique ids): `omo.mcp.list`, `omo.skill.list`, `omo.config.report`.
 */
export const task14FixturePlugin = Plugin.define({
  id: "omo-task14-test",
  async setup(ctx) {
    const fixtureDir = dirname(fileURLToPath(import.meta.url))
    const echoServerPath = join(fixtureDir, "echo-server.mjs")
    const nodeBin = process.env.NODE_BIN ?? "C:/Program Files/nodejs/node.exe"
    const extraServers = {
      "omo-echo": {
        type: "local" as const,
        command: [nodeBin, echoServerPath],
        enabled: true,
      },
    }

    const disposeMcp = await registerMcp(ctx, { extraServers })
    const disposeSkills = await registerSkills(ctx)
    const disposeConfig = await registerConfigMigrationDryRun(ctx)

    return async () => {
      await disposeMcp()
      await disposeSkills()
      await disposeConfig()
    }
  },
})

export default task14FixturePlugin
