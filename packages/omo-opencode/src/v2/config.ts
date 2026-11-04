import { promises as nodeFs } from "node:fs"
import * as nodePath from "node:path"
import { OhMyOpenCodeConfigSchema } from "../config/schema/oh-my-opencode-config"

/**
 * [OMC] v2 shared omo.json loader.
 *
 * Extracted from the ultrawork port (task 19 → agent-overrides, 2026-11-04):
 * one mtime-cached, schema-validated read of `<directory|cwd>/omo.json` shared
 * by every v2 feature that reads the OMO config. Single-layer only (project
 * root); the V1 user/project merge walk stays unported (gap documented in
 * docs/parity-matrix.md).
 *
 * Contract:
 *   - missing file / unreadable / invalid JSON  → `null` (feature defaults)
 *   - schema-invalid                            → `null` + one console.error
 *   - schema-valid                              → parsed config
 *   - mtime-identical re-read                   → cached value (no re-parse)
 *   - cache is bounded (cleared past 8 entries) and test-resettable
 */

export type OmoConfig = ReturnType<typeof OhMyOpenCodeConfigSchema.parse>

const CONFIG_CACHE_MAX_ENTRIES = 8

const configCache = new Map<string, { mtimeMs: number; config: OmoConfig | null }>()

export async function loadOmoConfig(directory: string | undefined): Promise<OmoConfig | null> {
  const base = directory ?? process.cwd()
  const file = nodePath.join(base, "omo.json")
  try {
    const stat = await nodeFs.stat(file)
    const cached = configCache.get(file)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.config
    const raw = JSON.parse(await nodeFs.readFile(file, "utf8"))
    const parsed = OhMyOpenCodeConfigSchema.safeParse(raw)
    const config = parsed.success ? parsed.data : null
    if (!parsed.success) {
      console.error("[OMC] config: omo.json failed schema validation; ignoring file", parsed.error.message)
    }
    if (configCache.size > CONFIG_CACHE_MAX_ENTRIES) configCache.clear()
    configCache.set(file, { mtimeMs: stat.mtimeMs, config })
    return config
  } catch {
    return null
  }
}

/** Test seam: drops every cached entry so the next read re-parses from disk. */
export function clearOmoConfigCache(): void {
  configCache.clear()
}
