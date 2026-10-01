import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { z } from "zod"

/**
 * [OMC] v2 config/installer migration dry-run (task 14c).
 *
 * Ports the V1 config-manipulation/installer flow (`src/cli/config-manager/*`:
 * `addPluginToOpenCodeConfig` writes the `plugin` array; `ensureTuiPluginEntry`
 * writes the terminal config) to the V2 field layout — as a DRY-RUN only.
 *
 * V1 → V2 field/file renames (source of truth: docs/v2-config-normalization.md
 * + the installed 2.0.20 `@opencode/schema` `dist/config.d.ts`):
 *
 *   - `plugin`            → `plugins`        (rename)
 *   - `provider`          → `providers`      (rename)
 *   - `mcp` (flat map)    → `mcp.servers`    (nested restructure)
 *   - `enabled_providers` → `experimental.policies` (semantic; V2 auto-normalizes)
 *   - `model` (string)    → `{providerID, model}`   (semantic; V2 auto-splits)
 *   - `tui.json`          → `cli.json`       (file rename)
 *
 * This module NEVER writes to a config file — it only produces a rename report
 * (and a best-effort in-memory migration of the mechanical renames). The user's
 * production config is untouched.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

export type ConfigFieldChangeKind = "rename" | "nested-restructure" | "semantic"

export type ConfigFieldChange = {
  readonly field: string
  readonly kind: ConfigFieldChangeKind
  readonly to?: string
  readonly note: string
}

export type ConfigMigrationDryRun = {
  readonly changes: ConfigFieldChange[]
  readonly migrated: Record<string, unknown>
}

export type TuiConfigRename = {
  readonly from: string
  readonly to: string
  readonly present: boolean
  readonly note: string
}

// ---------------------------------------------------------------------------
// Field migration (dry-run)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Produce an in-memory V1→V2 config migration. Mechanical renames are applied
 * to the returned `migrated` object; semantic changes (handled by V2 itself,
 * in-memory, at boot) are recorded in the report only.
 */
export function migrateConfigFields(config: Record<string, unknown>): ConfigMigrationDryRun {
  const changes: ConfigFieldChange[] = []
  const migrated: Record<string, unknown> = { ...config }

  if (Object.prototype.hasOwnProperty.call(migrated, "plugin")) {
    migrated.plugins = migrated.plugin
    delete migrated.plugin
    changes.push({
      field: "plugin",
      kind: "rename",
      to: "plugins",
      note: "V1 installer writes the `plugin` array; V2 reads `plugins`",
    })
  }

  if (Object.prototype.hasOwnProperty.call(migrated, "provider")) {
    migrated.providers = migrated.provider
    delete migrated.provider
    changes.push({
      field: "provider",
      kind: "rename",
      to: "providers",
      note: "V1 `provider` map → V2 `providers` map",
    })
  }

  if (Object.prototype.hasOwnProperty.call(migrated, "mcp") && isPlainObject(migrated.mcp)) {
    const mcp = migrated.mcp
    if (!Object.prototype.hasOwnProperty.call(mcp, "servers")) {
      migrated.mcp = { servers: mcp }
      changes.push({
        field: "mcp",
        kind: "nested-restructure",
        to: "mcp.servers",
        note: "V1 flat `mcp` map → V2 `{ servers: { … } }`",
      })
    }
  }

  if (Object.prototype.hasOwnProperty.call(migrated, "enabled_providers")) {
    changes.push({
      field: "enabled_providers",
      kind: "semantic",
      to: "experimental.policies",
      note: "V2 normalizes the allowlist into `experimental.policies` in-memory (not rewritten here)",
    })
  }

  if (typeof migrated.model === "string") {
    changes.push({
      field: "model",
      kind: "semantic",
      to: "model{providerID,model}",
      note: "V2 splits the `provider/model` string into `{ providerID, model }` in-memory",
    })
  }

  if (Object.prototype.hasOwnProperty.call(migrated, "small_model")) {
    changes.push({
      field: "small_model",
      kind: "semantic",
      note: "absorbed into the V2 model shape (not surfaced explicitly)",
    })
  }

  return { changes, migrated }
}

// ---------------------------------------------------------------------------
// Terminal-config file rename (dry-run)
// ---------------------------------------------------------------------------

export function planTuiConfigRename(configDir: string): TuiConfigRename {
  const from = join(configDir, "tui.json")
  return {
    from: "tui.json",
    to: "cli.json",
    present: existsSync(from),
    note: "V1 installer writes `tui.json`; the V2 terminal config is `cli.json`",
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type ConfigMigrationDryRunOptions = {
  /** Config directory to inspect. Defaults to `OPENCODE_CONFIG_DIR` then `~/.config/opencode`. */
  readonly configDir?: string
}

export type ConfigMigrationDryRunResult = {
  readonly configDir: string
  readonly configPath: string
  readonly configReadError?: string
  readonly changes: ConfigFieldChange[]
  readonly tuiRename: TuiConfigRename
}

export function runConfigMigrationDryRun(options: ConfigMigrationDryRunOptions = {}): ConfigMigrationDryRunResult {
  const configDir =
    options.configDir ?? process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode")
  const configPath = join(configDir, "opencode.json")

  let changes: ConfigFieldChange[] = []
  let configReadError: string | undefined

  if (!existsSync(configPath)) {
    configReadError = `config not found at ${configPath}`
  } else {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown
      if (isPlainObject(raw)) {
        changes = migrateConfigFields(raw).changes
      } else {
        configReadError = `config is not a JSON object at ${configPath}`
      }
    } catch (error) {
      configReadError = error instanceof Error ? error.message : String(error)
    }
  }

  const tuiRename = planTuiConfigRename(configDir)

  return { configDir, configPath, ...(configReadError !== undefined ? { configReadError } : {}), changes, tuiRename }
}

const changeSchema = z.object({
  field: z.string(),
  kind: z.string(),
  to: z.string().optional(),
  note: z.string(),
})

const omoConfigRpc = {
  id: "omo.config",
  methods: {
    report: {
      input: z.object({}),
      output: z.object({
        configDir: z.string(),
        configPath: z.string(),
        configReadError: z.string().optional(),
        changes: z.array(changeSchema),
        tuiRename: z.object({ from: z.string(), to: z.string(), present: z.boolean(), note: z.string() }),
      }),
    },
    preview: {
      input: z.object({ config: z.record(z.string(), z.unknown()) }),
      output: z.object({ changes: z.array(changeSchema) }),
    },
  },
  events: {},
}

function serializeChange(change: ConfigFieldChange) {
  return {
    field: change.field,
    kind: change.kind,
    ...(change.to !== undefined ? { to: change.to } : {}),
    note: change.note,
  }
}

export async function registerConfigMigrationDryRun(
  ctx: PluginContext,
  options: ConfigMigrationDryRunOptions = {},
): Promise<() => Promise<void>> {
  const result = runConfigMigrationDryRun(options)

  // Emit the report to stdout so it is captured in the server log (the V2
  // server context has no `log` domain — see shared-context gotcha).
  // eslint-disable-next-line no-console
  console.log(
    `[omo.config] dry-run ${result.configPath}: ` +
      `${result.changes.length} field change(s), tui rename ${result.tuiRename.from}→${result.tuiRename.to}` +
      ` (present=${result.tuiRename.present})`,
  )
  for (const change of result.changes) {
    // eslint-disable-next-line no-console
    console.log(
      `[omo.config]   ${change.field} → ${change.to ?? "(semantic)"} [${change.kind}] ${change.note}`,
    )
  }

  const rpc = await ctx.rpc.register(
    omoConfigRpc,
    {
      report: async () => ({
        configDir: result.configDir,
        configPath: result.configPath,
        ...(result.configReadError !== undefined ? { configReadError: result.configReadError } : {}),
        changes: result.changes.map(serializeChange),
        tuiRename: {
          from: result.tuiRename.from,
          to: result.tuiRename.to,
          present: result.tuiRename.present,
          note: result.tuiRename.note,
        },
      }),
      preview: async (input) => ({
        changes: migrateConfigFields(input.config).changes.map(serializeChange),
      }),
    },
  )

  return async () => {
    await rpc.dispose()
  }
}
