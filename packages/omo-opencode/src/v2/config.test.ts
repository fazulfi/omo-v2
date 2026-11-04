import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearOmoConfigCache, loadOmoConfig } from "./config"

/**
 * [OMC] v2 shared config loader tests.
 *
 * Covers the loadOmoConfig contract extracted from the ultrawork port:
 * missing/unparseable/schema-invalid → null, valid → parsed config,
 * mtime-visible edits are re-read, and the cache is resettable.
 */

const createdProjects: string[] = []

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), "omo-v2-config-"))
  createdProjects.push(project)
  return project
}

function writeConfig(project: string, raw: string): void {
  writeFileSync(join(project, "omo.json"), raw)
}

afterEach(() => {
  clearOmoConfigCache()
  for (const project of createdProjects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }
})

describe("config — loadOmoConfig", () => {
  it("returns null when omo.json is missing", async () => {
    // given / when
    const config = await loadOmoConfig(makeProject())
    // then
    expect(config).toBeNull()
  })

  it("returns null for unparseable JSON", async () => {
    // given
    const project = makeProject()
    writeConfig(project, "{ not json")
    // when
    const config = await loadOmoConfig(project)
    // then
    expect(config).toBeNull()
  })

  it("returns null when the file fails schema validation", async () => {
    // given
    const project = makeProject()
    writeConfig(project, JSON.stringify({ agents: { oracle: { mode: "not-a-mode" } } }))
    // when
    const config = await loadOmoConfig(project)
    // then
    expect(config).toBeNull()
  })

  it("parses a valid config with agent overrides", async () => {
    // given
    const project = makeProject()
    writeConfig(
      project,
      JSON.stringify({
        agents: {
          oracle: { model: "openai/gpt-5.6-sol#high" },
          momus: { disable: true },
        },
      }),
    )
    // when
    const config = await loadOmoConfig(project)
    // then
    expect(config?.agents?.oracle?.model).toBe("openai/gpt-5.6-sol#high")
    expect(config?.agents?.momus?.disable).toBe(true)
  })

  it("re-reads the file after an mtime-visible edit", async () => {
    // given
    const project = makeProject()
    writeConfig(project, JSON.stringify({ agents: { oracle: { color: "#111111" } } }))
    expect((await loadOmoConfig(project))?.agents?.oracle?.color).toBe("#111111")

    // when the file changes on disk
    await Bun.sleep(5)
    writeConfig(project, JSON.stringify({ agents: { oracle: { color: "#222222" } } }))

    // then the next read sees the new value
    expect((await loadOmoConfig(project))?.agents?.oracle?.color).toBe("#222222")
  })

  it("resolves without rejecting when directory is undefined", async () => {
    // given the caller passes no directory (falls back to process.cwd())
    // when / then: the call must resolve, not reject
    const config = await loadOmoConfig(undefined)
    expect(typeof config).toBe("object")
  })

  it("reads from an explicit nested directory", async () => {
    // given
    const project = makeProject()
    const nested = join(project, "work")
    mkdirSync(nested)
    writeConfig(nested, JSON.stringify({ default_run_agent: "atlas" }))
    // when
    const config = await loadOmoConfig(nested)
    // then
    expect(config?.default_run_agent).toBe("atlas")
  })

  it("clearOmoConfigCache drops cached entries", async () => {
    // given
    const project = makeProject()
    writeConfig(project, JSON.stringify({}))
    await loadOmoConfig(project)
    // when
    clearOmoConfigCache()
    // then a fresh read still works (cache miss path)
    expect(await loadOmoConfig(project)).not.toBeNull()
  })
})
