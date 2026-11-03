import { describe, expect, test } from "bun:test"
import { delimiter, join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  createLspServerConfig,
  resolveLspDaemon,
  resolveOpenCodeConfigDir,
} from "./lsp-server"

const REPO_ROOT = "/fake/repo"
const MODULE_URL = pathToFileURL(join(REPO_ROOT, "packages/omo-opencode/src/v2/lsp-server.ts")).href
const DIST_CLI = join(REPO_ROOT, "packages/lsp-daemon/dist/cli.js")
const SOURCE_CLI = join(REPO_ROOT, "packages/lsp-daemon/src/cli.ts")

function pathExistsFor(paths: readonly string[]): (path: string) => boolean {
  const set = new Set(paths)
  return (path) => set.has(path)
}

const whichAll: (name: string) => string | null = (name) => `/usr/bin/${name}`

describe("resolveLspDaemon", () => {
  test("#given a built daemon dist #when resolving #then it prefers the dist CLI over the source CLI", () => {
    const resolved = resolveLspDaemon({
      moduleUrl: MODULE_URL,
      exists: pathExistsFor([DIST_CLI, SOURCE_CLI]),
      which: whichAll,
    })

    expect(resolved?.mode).toBe("dist")
    expect(resolved?.path).toBe(DIST_CLI)
    expect(resolved?.command).toEqual(["/usr/bin/node", DIST_CLI, "mcp"])
  })

  test("#given only the TypeScript source #when resolving #then it falls back to the bun source CLI", () => {
    const resolved = resolveLspDaemon({
      moduleUrl: MODULE_URL,
      exists: pathExistsFor([SOURCE_CLI]),
      which: whichAll,
    })

    expect(resolved?.mode).toBe("source")
    expect(resolved?.path).toBe(SOURCE_CLI)
    expect(resolved?.command).toEqual(["/usr/bin/bun", SOURCE_CLI, "mcp"])
  })

  test("#given no daemon artifacts #when resolving #then it returns null", () => {
    const resolved = resolveLspDaemon({
      moduleUrl: MODULE_URL,
      exists: () => false,
      which: whichAll,
    })

    expect(resolved).toBeNull()
  })

  test("#given no node runtime #when a dist CLI exists #then it still resolves through bun", () => {
    const resolved = resolveLspDaemon({
      moduleUrl: MODULE_URL,
      exists: pathExistsFor([DIST_CLI]),
      which: (name) => (name === "node" ? null : `/usr/bin/${name}`),
    })

    expect(resolved?.command).toEqual(["/usr/bin/bun", DIST_CLI, "mcp"])
  })
})

describe("resolveOpenCodeConfigDir", () => {
  test("#given OPENCODE_CONFIG_DIR #when resolving #then the shared resolver honours it", () => {
    const previous = process.env["OPENCODE_CONFIG_DIR"]
    process.env["OPENCODE_CONFIG_DIR"] = "/custom/opencode"
    try {
      expect(resolveOpenCodeConfigDir()).toBe("/custom/opencode")
    } finally {
      if (previous === undefined) delete process.env["OPENCODE_CONFIG_DIR"]
      else process.env["OPENCODE_CONFIG_DIR"] = previous
    }
  })

  test("#given no override #when resolving #then the shared resolver falls back to the XDG config dir", () => {
    const previousDir = process.env["OPENCODE_CONFIG_DIR"]
    const previousXdg = process.env["XDG_CONFIG_HOME"]
    delete process.env["OPENCODE_CONFIG_DIR"]
    process.env["XDG_CONFIG_HOME"] = "/xdg"
    try {
      expect(resolveOpenCodeConfigDir()).toBe(join("/xdg", "opencode"))
    } finally {
      if (previousDir === undefined) delete process.env["OPENCODE_CONFIG_DIR"]
      else process.env["OPENCODE_CONFIG_DIR"] = previousDir
      if (previousXdg === undefined) delete process.env["XDG_CONFIG_HOME"]
      else process.env["XDG_CONFIG_HOME"] = previousXdg
    }
  })
})

describe("createLspServerConfig", () => {
  test("#given a resolvable daemon #when building the config #then it is enabled and carries the mcp subcommand", () => {
    const config = createLspServerConfig({
      cwd: "/work/project",
      env: {},
      resolution: { moduleUrl: MODULE_URL, exists: pathExistsFor([DIST_CLI]), which: whichAll },
    })

    expect(config.enabled).toBe(true)
    expect(config.command).toEqual(["/usr/bin/node", DIST_CLI, "mcp"])
    expect(config.cwd).toBe("/work/project")
  })

  test("#given a resolvable daemon #when building the config #then it exports the full LSP_TOOLS_MCP environment", () => {
    const config = createLspServerConfig({
      cwd: "/work/project",
      env: {},
      configDir: "/xdg/opencode",
      resolution: { moduleUrl: MODULE_URL, exists: pathExistsFor([DIST_CLI]), which: whichAll },
    })

    expect(config.environment["LSP_TOOLS_MCP_CWD"]).toBe("/work/project")
    expect(config.environment["LSP_TOOLS_MCP_PROJECT_CONFIG"]).toBe(
      [
        join("/work/project", ".opencode/lsp.json"),
        join("/work/project", ".omo/lsp.json"),
        join("/work/project", ".omo/lsp-client.json"),
      ].join(delimiter),
    )
    expect(config.environment["LSP_TOOLS_MCP_USER_CONFIG"]).toBe(join("/xdg/opencode", "lsp.json"))
    expect(config.environment["LSP_TOOLS_MCP_INSTALL_DECISIONS"]).toBe(
      join("/xdg/opencode", "lsp-install-decisions.json"),
    )
  })

  test("#given no resolvable daemon #when building the config #then it stays registered but disabled", () => {
    const config = createLspServerConfig({
      cwd: "/work/project",
      env: {},
      resolution: { moduleUrl: MODULE_URL, exists: () => false, which: whichAll },
    })

    expect(config.enabled).toBe(false)
    expect(config.type).toBe("local")
  })

  test("#given an external daemon override #when building the config #then the override pair is preserved", () => {
    const config = createLspServerConfig({
      cwd: "/work/project",
      env: { OMO_LSP_DAEMON_CLI: "/external/cli.js", OMO_LSP_DAEMON_VERSION: "9.9.9" },
      resolution: { moduleUrl: MODULE_URL, exists: pathExistsFor([DIST_CLI]), which: whichAll },
    })

    expect(config.environment["OMO_LSP_DAEMON_CLI"]).toBe("/external/cli.js")
    expect(config.environment["OMO_LSP_DAEMON_VERSION"]).toBe("9.9.9")
  })
})
