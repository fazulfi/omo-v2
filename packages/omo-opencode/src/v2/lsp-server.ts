import { existsSync, readFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { bunWhich } from "../shared/bun-which-shim"
import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"

/**
 * [OMC] v2 LSP MCP server resolution.
 *
 * Re-ports the deleted V1 `packages/omo-opencode/src/mcp/lsp.ts`
 * (`createLspMcpConfig`) onto the V2 plugin contract.
 *
 * The V1 plugin resolved the shared LSP daemon CLI by walking ancestors from the
 * module location and produced a local stdio MCP config carrying the whole
 * `LSP_TOOLS_MCP_*` environment block. The V2 port shipped a stub that only
 * honored a pre-set `OMO_LSP_DAEMON_CLI`, so the `lsp` server was registered
 * with `disabled: true` and never spawned.
 *
 * Resolution modes (both from the same ancestor walk):
 *
 *   dist   <ancestor>/packages/lsp-daemon/dist/cli.js  -> [node, cli, "mcp"]
 *   source <ancestor>/packages/lsp-daemon/src/cli.ts  -> [bun,  cli, "mcp"]
 *
 * A published install resolves `<pkgroot>/packages/lsp-daemon/dist/cli.js`
 * (shipped through the root `package.json` `files` array); a source checkout
 * resolves `<repo>/packages/lsp-daemon/dist/cli.js`. The dist candidate wins
 * across every ancestor before any source candidate is considered.
 */

const DAEMON_PACKAGE_REL = "packages/lsp-daemon"
const DIST_CLI_REL = "dist/cli.js"
const SOURCE_CLI_REL = "src/cli.ts"
const DAEMON_PACKAGE_JSON_REL = "package.json"
const PROJECT_LSP_CONFIGS = [".opencode/lsp.json", ".omo/lsp.json", ".omo/lsp-client.json"] as const
const OMO_LSP_DAEMON_CLI = "OMO_LSP_DAEMON_CLI"
const OMO_LSP_DAEMON_VERSION = "OMO_LSP_DAEMON_VERSION"

export type LspDaemonMode = "dist" | "source"

export interface LspDaemonCandidate {
  /** Full argv, including the trailing `mcp` subcommand. */
  readonly command: string[]
  readonly path: string
  readonly root: string
  readonly mode: LspDaemonMode
}

export interface LspDaemonResolutionOptions {
  readonly moduleUrl?: string
  readonly exists?: (path: string) => boolean
  readonly which?: (name: string) => string | null
}

export interface LspServerConfig {
  readonly type: "local"
  readonly command: string[]
  readonly enabled: boolean
  readonly cwd: string
  readonly environment: Record<string, string>
}

export interface LspServerConfigOptions {
  /** The OpenCode project directory the LSP servers must resolve against. */
  readonly cwd: string
  readonly env?: Record<string, string | undefined>
  readonly resolution?: LspDaemonResolutionOptions
  /** Override for the OpenCode config dir; defaults to the shared resolver. */
  readonly configDir?: string
}

function resolveModuleDirectory(moduleUrl: string): string | null {
  try {
    return dirname(fileURLToPath(moduleUrl))
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

function ancestorDirectories(startDirectory: string): string[] {
  const directories: string[] = []
  let current = resolve(startDirectory)
  while (true) {
    directories.push(current)
    const parent = resolve(current, "..")
    if (parent === current) return directories
    current = parent
  }
}

function readDaemonPackageVersion(root: string): string | null {
  try {
    const raw = readFileSync(resolve(root, DAEMON_PACKAGE_REL, DAEMON_PACKAGE_JSON_REL), "utf-8")
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const version = Reflect.get(parsed, "version")
      if (typeof version === "string" && version.length > 0) return version
    }
    return null
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return null
  }
}

/**
 * Resolve the LSP daemon CLI, preferring a built dist over a TypeScript source
 * checkout. Returns `null` when neither is available.
 */
export function resolveLspDaemon(options: LspDaemonResolutionOptions = {}): LspDaemonCandidate | null {
  const pathExists = options.exists ?? existsSync
  const which = options.which ?? bunWhich
  const node = which("node")
  const bun = which("bun")
  const startDirectory = resolveModuleDirectory(options.moduleUrl ?? import.meta.url)
  if (!startDirectory) return null

  const roots = ancestorDirectories(startDirectory)

  const distRuntime = node ?? bun
  if (distRuntime) {
    for (const root of roots) {
      const distPath = resolve(root, DAEMON_PACKAGE_REL, DIST_CLI_REL)
      if (!pathExists(distPath)) continue
      return { command: [distRuntime, distPath, "mcp"], path: distPath, root, mode: "dist" }
    }
  }

  if (bun) {
    for (const root of roots) {
      const sourcePath = resolve(root, DAEMON_PACKAGE_REL, SOURCE_CLI_REL)
      if (!pathExists(sourcePath)) continue
      return { command: [bun, sourcePath, "mcp"], path: sourcePath, root, mode: "source" }
    }
  }

  return null
}

/**
 * The directory OpenCode reads its own config from. The shared helper owns that
 * resolution (`OPENCODE_CONFIG_DIR`, XDG, the WSL/Windows/Tauri rules), so the
 * LSP server and the rest of the plugin agree on one answer.
 */
export function resolveOpenCodeConfigDir(): string {
  return getOpenCodeConfigDir({ binary: "opencode" })
}

function buildLspEnvironment(
  cwd: string,
  configDir: string,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const environment: Record<string, string> = {
    LSP_TOOLS_MCP_CWD: cwd,
    LSP_TOOLS_MCP_PROJECT_CONFIG: PROJECT_LSP_CONFIGS.map((configPath) => resolve(cwd, configPath)).join(
      delimiter,
    ),
    LSP_TOOLS_MCP_USER_CONFIG: resolve(configDir, "lsp.json"),
    LSP_TOOLS_MCP_INSTALL_DECISIONS: resolve(configDir, "lsp-install-decisions.json"),
  }

  const externalCli = env[OMO_LSP_DAEMON_CLI]
  const externalVersion = env[OMO_LSP_DAEMON_VERSION]
  if (externalCli !== undefined && externalCli.length > 0 && externalVersion !== undefined) {
    environment[OMO_LSP_DAEMON_CLI] = externalCli
    environment[OMO_LSP_DAEMON_VERSION] = externalVersion
  }

  return environment
}

/**
 * Build the V2 local MCP config for the `lsp` server.
 *
 * The server is enabled only when a daemon CLI actually resolved; otherwise it
 * stays registered but disabled, which OpenCode reports honestly as
 * `disabled` instead of failing the whole plugin load.
 */
export function createLspServerConfig(options: LspServerConfigOptions): LspServerConfig {
  const env = options.env ?? process.env
  const cwd = resolve(options.cwd)
  const configDir = options.configDir ?? resolveOpenCodeConfigDir()
  const environment = buildLspEnvironment(cwd, configDir, env)
  const daemon = resolveLspDaemon(options.resolution)

  if (!daemon) {
    return {
      type: "local",
      command: ["node", "-e", "process.exit(1)"],
      enabled: false,
      cwd,
      environment,
    }
  }

  if (daemon.mode === "source" && environment[OMO_LSP_DAEMON_CLI] === undefined) {
    const version = readDaemonPackageVersion(daemon.root)
    if (version !== null) {
      environment[OMO_LSP_DAEMON_CLI] = daemon.path
      environment[OMO_LSP_DAEMON_VERSION] = version
    }
  }

  return { type: "local", command: daemon.command, enabled: true, cwd, environment }
}
