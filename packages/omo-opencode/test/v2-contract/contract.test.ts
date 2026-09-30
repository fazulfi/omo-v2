import { describe, expect, it } from "bun:test"

/**
 * V2 plugin contract test (task 6 — TDD RED).
 *
 * The port target is a native opencode v2 plugin entry at
 * `src/v2/index.ts` exporting `Plugin.define({ id: "oh-my-openagent", setup })`
 * from `@opencode/plugin@2.0.20`.
 *
 * This file intentionally stays RED until task 9 lands the entry point.
 * It asserts ONLY the plugin contract shape — no V1 imports are used here.
 */

const V2_ENTRY = "../../src/v2/index"

describe("OMC v2 plugin contract (task 6 RED -> task 9 GREEN)", () => {
  it("src/v2/index.ts exports a default plugin definition with id 'oh-my-openagent'", async () => {
    let mod: { default: unknown }
    try {
      mod = (await import(V2_ENTRY)) as { default: unknown }
    } catch (err) {
      throw new Error(
        `RED (expected until task 9): cannot import ${V2_ENTRY}: ${(err as Error).message}`,
      )
    }
    const def = mod.default as { id?: string; setup?: unknown } | null
    expect(def).toBeDefined()
    expect(def?.id).toBe("oh-my-openagent")
    expect(typeof def?.setup).toBe("function")
  })

  it("plugin definition carries no V1 bridge exports (no server/tui keys)", async () => {
    let mod: { default: unknown }
    try {
      mod = (await import(V2_ENTRY)) as { default: unknown }
    } catch (err) {
      throw new Error(
        `RED (expected until task 9): cannot import ${V2_ENTRY}: ${(err as Error).message}`,
      )
    }
    const def = mod.default as Record<string, unknown> | null
    expect(def?.server).toBeUndefined()
    expect(def?.tui).toBeUndefined()
  })
})
