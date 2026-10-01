import type { Plugin } from "@opencode/plugin"
import { z } from "zod"

/**
 * [OMC] v2 MCP injection port (task 14a).
 *
 * Ports the V1 builtin MCP injection (`src/mcp/index.ts`
 * `createBuiltinMcps`) + `applyMcpConfig` merge to the V2 plugin contract:
 *
 *   V1 `config.mcp` object (name → `{type, url|command, enabled, …}`) built
 *   programmatically by the plugin → V2 `ctx.mcp.transform(editor =>
 *   editor.set(name, ServerConfig))`.
 *
 * Config-shape migration (V1 → V2, verified against the installed 2.0.20
 * `@opencode/schema` — `dist/mcp.d.ts`):
 *
 *   - `enabled: boolean`  →  `disabled?: boolean` (inverted; absent = enabled)
 *   - remote: `url`, `headers`, `oauth`  →  same (all optional except `url`)
 *   - local:  `command: string[]`, `cwd`, `environment`  →  same
 *
 * The V1 inventory injected here is the *builtin* set: `websearch` (exa /
 * tavily), `context7`, `grep_app`, `lsp`. User-config MCP servers (the 15
 * servers in `opencode.json`, e.g. jina-reader/linkup/you/tinyfish) are NOT
 * re-injected — V2 already auto-normalizes the `mcp` map into `mcp.servers`
 * in-memory (see docs/v2-config-normalization.md), so parity only requires the
 * builtin set to be injected programmatically.
 */

// ---------------------------------------------------------------------------
// Types derived from the V2 plugin Context (no @opencode/schema runtime import)
// ---------------------------------------------------------------------------

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]
type MCPEditor = Parameters<Parameters<PluginContext["mcp"]["transform"]>[0]>[0]

/** V2 `Mcp.ServerConfig` — the accepted shape of `editor.set(name, config)`. */
export type V2ServerConfig = Parameters<MCPEditor["set"]>[1]

// ---------------------------------------------------------------------------
// V1 config shapes (parity with src/mcp/*.ts)
// ---------------------------------------------------------------------------

export type V1RemoteMcpConfig = {
  readonly type: "remote"
  readonly url: string
  readonly enabled: boolean
  readonly headers?: Record<string, string>
  readonly oauth?: false
}

export type V1LocalMcpConfig = {
  readonly type: "local"
  readonly command: string[]
  readonly enabled: boolean
  readonly cwd?: string
  readonly environment?: Record<string, string>
}

export type V1McpConfig = V1RemoteMcpConfig | V1LocalMcpConfig

// ---------------------------------------------------------------------------
// Shape migration (V1 `enabled` → V2 `disabled`)
// ---------------------------------------------------------------------------

/**
 * Convert a V1 MCP config to the V2 `Mcp.ServerConfig` shape. The V1
 * `enabled: boolean` flag is inverted into the V2 optional `disabled` flag
 * (V2 omits `disabled` for an enabled server).
 */
export function toV2ServerConfig(v1: V1McpConfig): V2ServerConfig {
  if (v1.type === "local") {
    return {
      type: "local",
      command: [...v1.command],
      ...(v1.cwd !== undefined ? { cwd: v1.cwd } : {}),
      ...(v1.environment !== undefined ? { environment: { ...v1.environment } } : {}),
      ...(v1.enabled === false ? { disabled: true } : {}),
    }
  }

  return {
    type: "remote",
    url: v1.url,
    ...(v1.headers !== undefined ? { headers: { ...v1.headers } } : {}),
    ...(v1.oauth !== undefined ? { oauth: v1.oauth } : {}),
    ...(v1.enabled === false ? { disabled: true } : {}),
  }
}

// ---------------------------------------------------------------------------
// Builtin factories (parity with src/mcp/context7.ts, websearch.ts, grep-app.ts)
// ---------------------------------------------------------------------------

const CONTEXT7_URL = "https://mcp.context7.com/mcp"
const GREP_APP_URL = "https://mcp.grep.app"
const EXA_URL = "https://mcp.exa.ai/mcp?tools=web_search_exa"
const TAVILY_URL = "https://mcp.tavily.com/mcp/"

function normalizeContext7ApiKey(value: string | undefined): string | null {
  if (value === undefined || isPlaceholderContext7ApiKey(value)) return null
  return value.trim()
}

function isPlaceholderContext7ApiKey(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[<>"'`]/g, "").replace(/[\s_-]+/g, " ")
  return normalized.length === 0 || normalized === "your api key"
}

export function createContext7Config(
  env: Record<string, string | undefined> = process.env,
): V1RemoteMcpConfig {
  const apiKey = normalizeContext7ApiKey(env.CONTEXT7_API_KEY)
  return {
    type: "remote",
    url: CONTEXT7_URL,
    enabled: true,
    ...(apiKey !== null ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    oauth: false,
  }
}

export function createGrepAppConfig(): V1RemoteMcpConfig {
  return { type: "remote", url: GREP_APP_URL, enabled: true, oauth: false }
}

export function createWebsearchConfig(
  env: Record<string, string | undefined> = process.env,
  provider: "exa" | "tavily" = "exa",
): V1RemoteMcpConfig | undefined {
  if (provider === "tavily") {
    const tavilyKey = env.TAVILY_API_KEY
    if (!tavilyKey) return undefined
    return {
      type: "remote",
      url: TAVILY_URL,
      enabled: true,
      headers: { Authorization: `Bearer ${tavilyKey}` },
      oauth: false,
    }
  }

  return {
    type: "remote",
    url: EXA_URL,
    enabled: true,
    ...(env.EXA_API_KEY ? { headers: { Authorization: `Bearer ${env.EXA_API_KEY}` } } : {}),
    oauth: false,
  }
}

/**
 * LSP builtin (parity with src/mcp/lsp.ts `createLspMcpConfig`). V1 sets
 * `enabled: false` when the lsp-daemon CLI is not resolvable; the isolated V2
 * harness has no daemon, so this injects a disabled local server. The full
 * daemon bootstrap (ancestor CLI resolver + npm install steps) is NOT ported —
 * see the honest-limitation note in the task evidence.
 */
export function createLspServerConfig(
  env: Record<string, string | undefined> = process.env,
): V1LocalMcpConfig {
  const daemonCli = env.OMO_LSP_DAEMON_CLI
  const available = typeof daemonCli === "string" && daemonCli.length > 0
  return {
    type: "local",
    command: available ? [daemonCli, "mcp"] : ["node", "-e", "process.exit(1)"],
    enabled: available,
    ...(env.LSP_TOOLS_MCP_CWD !== undefined ? { cwd: env.LSP_TOOLS_MCP_CWD } : {}),
  }
}

// ---------------------------------------------------------------------------
// Builtin factory (parity with src/mcp/index.ts createBuiltinMcps)
// ---------------------------------------------------------------------------

export type BuiltinMcpOptions = {
  readonly disabledMcps?: readonly string[]
  readonly env?: Record<string, string | undefined>
  readonly websearchProvider?: "exa" | "tavily"
}

export function createBuiltinMcps(options: BuiltinMcpOptions = {}): Record<string, V1McpConfig> {
  const disabled = new Set(options.disabledMcps ?? [])
  const env = options.env ?? process.env
  const mcps: Record<string, V1McpConfig> = {}

  if (!disabled.has("websearch")) {
    const websearch = createWebsearchConfig(env, options.websearchProvider ?? "exa")
    if (websearch) mcps.websearch = websearch
  }
  if (!disabled.has("context7")) {
    mcps.context7 = createContext7Config(env)
  }
  if (!disabled.has("grep_app")) {
    mcps.grep_app = createGrepAppConfig()
  }
  if (!disabled.has("lsp")) {
    mcps.lsp = createLspServerConfig(env)
  }

  return mcps
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export type RegisterMcpOptions = BuiltinMcpOptions & {
  /**
   * Additional servers merged after the builtin set (used by the task-14
   * fixture to inject a local stdio server for the runtime proof).
   */
  readonly extraServers?: Readonly<Record<string, V1McpConfig>>
}

const omoMcpRpc = {
  id: "omo.mcp",
  methods: {
    list: {
      input: z.object({}),
      output: z.object({
        servers: z.array(
          z.object({ name: z.string(), status: z.string(), error: z.string().optional() }),
        ),
      }),
    },
  },
  events: {},
}

export async function registerMcp(
  ctx: PluginContext,
  options: RegisterMcpOptions = {},
): Promise<() => Promise<void>> {
  const builtins = createBuiltinMcps(options)
  const servers: Record<string, V1McpConfig> = { ...builtins, ...(options.extraServers ?? {}) }

  for (const [name, v1] of Object.entries(servers)) {
    const v2 = toV2ServerConfig(v1)
    await ctx.mcp.transform((editor) => editor.set(name, v2))
  }

  // Diagnostic RPC (id "omo.mcp") — exposes the live `ctx.mcp.list()` so the
  // runtime proof can assert the injected servers are visible to the session.
  const rpc = await ctx.rpc.register(
    omoMcpRpc,
    {
      list: async () => {
        const result = await ctx.mcp.list()
        return {
          servers: result.data.map((server) => ({
            name: server.name,
            status: server.status.status,
            ...("error" in server.status ? { error: server.status.error } : {}),
          })),
        }
      },
    },
  )

  return async () => {
    await rpc.dispose()
  }
}
