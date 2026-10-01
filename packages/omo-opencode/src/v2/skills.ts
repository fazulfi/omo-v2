import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { z } from "zod"

/**
 * [OMC] v2 skills-location fallback (task 14b).
 *
 * V2 (2.0.20) scans skills from `~/.agents/skills`, `~/.claude/skills` and the
 * project `.agents/skills` — but NOT `~/.config/opencode/skills`, the location
 * of the 11 OCS production skills (`enowx-rag`, `frontend-ui-ux`,
 * `impeccable`, `impeccable-style`, `ocs-*`…). Without a fallback those 11
 * skills silently disappear on the V2 cutover.
 *
 * This module re-exposes them to V2 WITHOUT moving or deleting the production
 * files: it reads each `SKILL.md` from `~/.config/opencode/skills`, parses the
 * frontmatter (`name`, `description`), and injects a `Skill.Info` via
 * `ctx.skill.transform(editor => editor.add(info))` — the V2 equivalent of the
 * V1 skill registry (same transform mechanism the task-10 tool port uses).
 *
 * The production `~/.config/opencode/skills` tree is only ever READ, never
 * written, renamed, or deleted.
 */

// ---------------------------------------------------------------------------
// Types derived from the V2 plugin Context (no @opencode/schema runtime import)
// ---------------------------------------------------------------------------

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]
type SkillEditor = Parameters<Parameters<PluginContext["skill"]["transform"]>[0]>[0]

/** V2 `Skill.Info` — the accepted shape of `editor.add(skill)`. */
export type SkillInfo = Parameters<SkillEditor["add"]>[0]

// ---------------------------------------------------------------------------
// Frontmatter parsing (YAML subset: `name`, `description`)
// ---------------------------------------------------------------------------

export type SkillFrontmatter = {
  readonly name?: string
  readonly description?: string
}

function unquoteScalar(value: string): string {
  if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
    return value.slice(1, -1)
  }
  if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
    return value.slice(1, -1)
  }
  return value
}

/**
 * Parse the leading `---` frontmatter block of a SKILL.md. Handles:
 *   - `name: value` (plain scalar)
 *   - `description: value` (plain or quoted scalar)
 *   - `description: >-` / `>` / `|-` / `|` (block scalar, indented continuation)
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const lines = content.split(/\r?\n/)
  if (lines[0] !== "---") return {}

  const endIndex = lines.indexOf("---", 1)
  if (endIndex === -1) return {}

  const fmLines = lines.slice(1, endIndex)
  let name: string | undefined
  let description: string | undefined

  for (let i = 0; i < fmLines.length; i += 1) {
    const line = fmLines[i]
    if (line.startsWith("name:")) {
      name = unquoteScalar(line.slice("name:".length).trim())
    } else if (line.startsWith("description:")) {
      const rest = line.slice("description:".length).trim()
      if (rest === ">-" || rest === ">" || rest === "|-" || rest === "|") {
        const block: string[] = []
        let j = i + 1
        while (j < fmLines.length && (fmLines[j].startsWith("  ") || fmLines[j] === "")) {
          if (fmLines[j] !== "") block.push(fmLines[j].trim())
          j += 1
        }
        i = j - 1
        description = block.join(rest.startsWith("|") ? "\n" : " ")
      } else {
        description = unquoteScalar(rest)
      }
    }
  }

  return { name, description }
}

// ---------------------------------------------------------------------------
// Skill directory scanning
// ---------------------------------------------------------------------------

/**
 * Build a V2 `Skill.Info` from a raw record. The V2 `Skill.Info` uses branded
 * string fields (`Skill.ID`, `Skill.Name`, `AbsolutePath`); the brands are
 * compile-time-only (no runtime effect), so the field-level `as` assertions are
 * safe downcasts of plain strings.
 */
function toSkillInfo(raw: {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly path: string
  readonly content: string
}): SkillInfo {
  return {
    id: raw.id as SkillInfo["id"],
    name: raw.name as SkillInfo["name"],
    path: raw.path as SkillInfo["path"],
    content: raw.content,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  }
}

export type ScannedSkill = {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly path: string
}

/**
 * Scan a skills directory (one sub-directory per skill, each with a SKILL.md).
 * Returns `Skill.Info` records ready for `editor.add`.
 */
export function scanSkillDirectory(dir: string): { readonly infos: SkillInfo[]; readonly scanned: ScannedSkill[] } {
  const infos: SkillInfo[] = []
  const scanned: ScannedSkill[] = []

  if (!existsSync(dir)) return { infos, scanned }

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return { infos, scanned }
  }

  for (const entry of entries) {
    const skillDir = join(dir, entry)
    const skillFile = join(skillDir, "SKILL.md")
    if (!existsSync(skillFile)) continue

    let content: string
    try {
      content = readFileSync(skillFile, "utf8")
    } catch {
      continue
    }

    const { name, description } = parseSkillFrontmatter(content)
    const id = name ?? entry
    const effectiveName = name ?? entry

    infos.push(toSkillInfo({ id, name: effectiveName, description, path: skillDir, content }))
    scanned.push({ id, name: effectiveName, ...(description !== undefined ? { description } : {}), path: skillDir })
  }

  return { infos, scanned }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export type RegisterSkillsOptions = {
  /**
   * Directories to scan for skills. Defaults to the OCS production location
   * `~/.config/opencode/skills` (the V2 fallback target — V2 itself does not
   * scan this path).
   */
  readonly skillDirs?: readonly string[]
  readonly homeDir?: string
}

const omoSkillRpc = {
  id: "omo.skill",
  methods: {
    list: {
      input: z.object({}),
      output: z.object({
        skills: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().optional(),
            path: z.string(),
          }),
        ),
      }),
    },
  },
  events: {},
}

export async function registerSkills(
  ctx: PluginContext,
  options: RegisterSkillsOptions = {},
): Promise<() => Promise<void>> {
  const home = options.homeDir ?? homedir()
  const fallbackDir = join(home, ".config", "opencode", "skills")
  const dirs = options.skillDirs ?? [fallbackDir]

  const scanned: ScannedSkill[] = []

  // Single transform per directory batch (boot-time transforms coalesce).
  for (const dir of dirs) {
    const { infos, scanned: dirScanned } = scanSkillDirectory(dir)
    scanned.push(...dirScanned)
    if (infos.length === 0) continue
    await ctx.skill.transform((editor) => {
      const existing = new Set(editor.list().map((skill) => skill.id))
      for (const info of infos) {
        if (existing.has(info.id)) continue
        editor.add(info)
      }
    })
  }

  // Diagnostic RPC (id "omo.skill") — exposes the live `ctx.skill.list()` so
  // the runtime proof can assert the fallback skills are loaded in the session.
  const rpc = await ctx.rpc.register(
    omoSkillRpc,
    {
      list: async () => {
        const result = await ctx.skill.list()
        return {
          skills: result.data.map((skill) => ({
            id: skill.id,
            name: skill.name,
            ...(skill.description !== undefined ? { description: skill.description } : {}),
            path: skill.path,
          })),
        }
      },
    },
  )

  return async () => {
    await rpc.dispose()
  }
}
