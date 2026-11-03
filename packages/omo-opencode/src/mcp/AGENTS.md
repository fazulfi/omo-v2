# src/mcp/ — Built-in MCP inventory

> **V2 port note (2026-11-03).** The V1 implementation of this directory was removed with the
> V1-line source (`d6096afe2`). In the V2 port the built-in MCP registry lives in
> `packages/omo-opencode/src/v2/mcp.ts`, and the LSP server resolution lives in
> `packages/omo-opencode/src/v2/lsp-server.ts`. This file documents the **current** surface.

## OVERVIEW

Tier 1 of the three-tier MCP system. The built-in servers are created by
`createBuiltinMcps()` in `packages/omo-opencode/src/v2/mcp.ts` and injected into the OpenCode
V2 plugin contract with `ctx.mcp.transform((editor) => editor.set(name, config))`.

## BUILT-IN MCPs

| Name | Type | Endpoint / Command | Env Vars | Tools |
|------|------|--------------------|----------|-------|
| **websearch** | remote | `mcp.exa.ai` (default) or `mcp.tavily.com` | `EXA_API_KEY` (optional), `TAVILY_API_KEY` (if tavily) | Web search |
| **context7** | remote | `mcp.context7.com/mcp` | `CONTEXT7_API_KEY` (optional) | Library documentation |
| **grep_app** | remote | `mcp.grep.app` | None | GitHub code search |
| **lsp** | local (stdio, node/bun) | `<root>/packages/lsp-daemon/dist/cli.js mcp` (or `src/cli.ts mcp` under Bun) | `LSP_TOOLS_MCP_CWD`, `LSP_TOOLS_MCP_PROJECT_CONFIG`, `LSP_TOOLS_MCP_USER_CONFIG`, `LSP_TOOLS_MCP_INSTALL_DECISIONS` | `status`, `diagnostics`, `goto_definition`, `find_references`, `symbols`, `prepare_rename`, `rename`, `install_decision`, `format` |

## VENDORED LSP ARCHITECTURE

- The local `lsp` MCP is the vendored shared daemon at `packages/lsp-daemon/`, which proxies the
  `lsp-core` engine over stdio. `packages/lsp-tools-mcp/` is the standalone equivalent and
  backs the Codex edition.
- `packages/omo-opencode/src/v2/lsp-server.ts` resolves the daemon CLI by walking ancestors
  from the module location:
  1. `<ancestor>/packages/lsp-daemon/dist/cli.js` -> `[node, cli, "mcp"]` (preferred), and
  2. `<ancestor>/packages/lsp-daemon/src/cli.ts` -> `[bun, cli, "mcp"]` (source checkout).

  The dist candidate wins across every ancestor before any source candidate is considered, so
  a published install (`<pkgroot>/packages/lsp-daemon/dist/cli.js`, shipped through the root
  `package.json` `files` array) and a source checkout (`<repo>/packages/lsp-daemon/dist/cli.js`)
  behave identically.
- When no daemon CLI resolves, the server stays registered but **disabled**. OpenCode then
  reports it honestly as `disabled` instead of failing plugin load.
- The daemon resolves its own runtime through `OMO_LSP_DAEMON_DIR`, or the paired
  `OMO_LSP_DAEMON_CLI` + `OMO_LSP_DAEMON_VERSION` override. Source mode sets the paired
  override, because the daemon cannot otherwise locate its compiled sibling.
- OpenCode supplies exactly three ordered project config paths to the MCP translator:
  `<cwd>/.opencode/lsp.json`, `<cwd>/.omo/lsp.json`, and `<cwd>/.omo/lsp-client.json`, where
  `<cwd>` is the OpenCode project directory (`ctx.location.directory`).
- The user-level inputs are OpenCode config paths: `<opencode config dir>/lsp.json` for server
  config and `<opencode config dir>/lsp-install-decisions.json` for install decisions. The
  OpenCode config dir is `OPENCODE_CONFIG_DIR`, or `$XDG_CONFIG_HOME/opencode`.

## THREE-TIER SYSTEM

| Tier | Source | Mechanism |
|------|--------|-----------|
| 1. Built-in | `src/v2/mcp.ts` | 3 remote HTTP MCPs + 1 local stdio MCP (`lsp`) via `createBuiltinMcps()` |
| 2. Claude Code | `.mcp.json` | `${VAR}` env expansion via `claude-code-mcp-loader` |
| 3. Skill-embedded | SKILL.md YAML | Managed by `SkillMcpManager` (stdio + HTTP) |

## FILES

| File | Purpose |
|------|---------|
| `v2/mcp.ts` | `createBuiltinMcps()` registry for built-in MCPs, `toV2ServerConfig()` V1 -> V2 shape mapping, `registerMcp()` injection |
| `v2/lsp-server.ts` | LSP daemon CLI resolution + `LSP_TOOLS_MCP_*` environment construction |
| `v2/lsp-server.test.ts` | Unit coverage for the resolver and the environment block |
| `types.ts` | `McpNameSchema`: `"websearch" \| "context7" \| "grep_app" \| "lsp"` |
| `script/qa/lsp-mcp-qa.sh` | Live QA driver: proves the `lsp` server status and its tool registration on a real isolated OpenCode server |
