# omo-v2 — Oh My OpenCode, ported to OpenCode V2

> **Fork of [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)** (base commit `d1317056`, tag `v5.1.4`).
> Licensed under the [Sustainable Use License 1.0](./LICENSE.md) — maintained as an internal-use port for [zrouter](https://zrouter.dev) tooling.
> Upstream README, history, and all notices are preserved in the upstream repository and in this fork's git history (see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md) and [docs/provenance.md](./docs/provenance.md)).

This repository ports the **OMC plugin** (`packages/omo-opencode`) from the OpenCode V1 plugin
contract (`@opencode-ai/plugin` 1.18.x) to the **official OpenCode V2 plugin API**:

- `@opencode/plugin@2.0.20` (exact, pinned — `Plugin.define`, `ctx.*` domains, TUI Context)
- `@opencode/client@2.0.20` (exact, pinned — `OpenCode.make`, `Service`)
- `@opencode/cli@2.0.20` (exact, pinned — the host used for all verification)

The fork is **V2-only**: all V1-line source (2,493 files) was removed after the port was complete
(task 18). The upstream V1 implementation remains available at the upstream repository and in this
fork's git history.

## Status

| Area | State |
| --- | --- |
| Plugin server entry (`Plugin.define` + RPC `omo.*`) | Ported, runtime-verified |
| Tools (glob/grep) + hooks | Ported, runtime-verified |
| Client migration (`@opencode-ai/sdk` → `@opencode/client`) | Ported, runtime-verified |
| Agents (10 OMC agents + subagent dispatch) | Ported, runtime-verified |
| Orchestration (background tasks, continuation, todos) | Ported, runtime-verified |
| MCP injection + skills resolution + config migration | Ported, runtime-verified |
| TUI binding layer (sidebar, btw-side, native nudge) | Ported (real-terminal render = post-cutover observation item) |
| Static gates (zero `@opencode-ai/*`, strict TS, pinned deps) | Green |
| Runtime parity matrix | 19 PASS + 5 PASS* (documented limitations) — [docs/parity-matrix.md](./docs/parity-matrix.md) |

See [docs/parity-matrix.md](./docs/parity-matrix.md) for the full per-feature matrix with evidence.

## Architecture

The port lives in `packages/omo-opencode/src/v2/`:

| Module | Responsibility |
| --- | --- |
| `index.ts` | `Plugin.define({ id: "oh-my-openagent", setup(ctx) })` — server entry; wires all domains, composite cleanup |
| `tui-entry.ts` | TUI half (`id: "oh-my-openagent:tui"`) — resolved via package exports `./tui` (Host Entrypoints) |
| `tools.ts` | `glob` / `grep` tools (native reimplementation) + 4 hooks (`ctx.tool/session/shell.hook`) + `omo.tools` RPC |
| `client.ts` / `client-events.ts` | `OpenCode.make` / `Service.discover-ensure-stop` + V1→V2 event-name mapping |
| `agents.ts` | 10 OMC agent definitions (`system` field, `mode`, permissions) + `omo.agents` RPC (list/get/dispatch) |
| `orchestration.ts` | Background task manager (spawn/collect/cancel) + todo continuation + `omo.orch` RPC |
| `mcp.ts` / `skills.ts` | MCP server injection (`ctx.mcp.transform`) + skills-location fallback + `omo.mcp` / `omo.skill` RPC |
| `config-migration.ts` | Config/installer migration dry-run (V1 `tui.json` → V2 `cli.json` field mapping) |
| `tui/` | TUI binding layer: `btw.ts`, `sidebar.ts` (slot `sidebar.content`), `session.ts`, `render.ts`, `native-nudge.ts` |

Supporting V1-era modules kept in place (clean of `@opencode-ai/*`): `src/config-migration/`
(exported to `omo-senpi` via package exports), `src/shared/`, `src/cli/doctor`, `src/features/tui-sidebar`.

## Quickstart

Requirements: [Bun](https://bun.sh) 1.3.x.

```bash
bun install
bun run build          # emits dist/index.js, dist/tui-entry.js, dist/oh-my-opencode.schema.json
```

Load the plugin into an OpenCode V2 host (config `plugins` array, absolute directory path):

```json
{
  "plugins": ["C:/absolute/path/to/this/repo"]
}
```

The host resolves the server entry from `exports["."]/import` (`dist/index.js`) and the TUI entry
from `exports["./tui"]` (`dist/tui-entry.js`).

Companion stack used with this port (not vendored here):

- **DCP** — `@tarquinen/opencode-dcp@3.2.0` (dual V1/V2 adapter, loads natively on V2)
- **tokenscope** — upstream PR #50 (`feat/opencode-v2-support`, 2.0.0) build; npm `@latest` resolves
  the V1-only 1.8.1, so reference a local build with a root `index.js` wrapper

## Verification

```bash
bun run gate:v1-imports   # zero @opencode-ai/* imports across packages/
bun run gate:deps         # @opencode/* pinned at exactly 2.0.20, no @opencode-ai/*
bun run gate:any          # no `: any` on the port surface
bun run typecheck         # tsgo --noEmit (root + script + all packages)
bun test --timeout 20000  # suite (see docs/parity-matrix.md for known pre-existing exceptions)
```

Known pre-existing (out of port scope, documented in task-18 evidence): 7 `tsgo` errors in
`packages/omo-native` (senpi engine), a Windows hang in `bun-spawn-shim.test.ts`, and 475 `: any`
matches in non-port packages (vendored upstreams).

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/provenance.md](./docs/provenance.md) | Upstream commit/tag, SUL-1.0 verdict, toolchain pins |
| [docs/v2-api-mapping.md](./docs/v2-api-mapping.md) | Exhaustive V1→V2 API inventory (137-row mapping, gap table, TUI verdict) |
| [docs/parity-matrix.md](./docs/parity-matrix.md) | Runtime parity matrix, per-feature evidence |
| [docs/cutover-runbook.md](./docs/cutover-runbook.md) | Cutover rehearsal, offline rollback drill, runbook |
| [docs/v2-isolation.md](./docs/v2-isolation.md) | Isolated V2 test harness (env vars, proof) |
| [docs/v2-config-normalization.md](./docs/v2-config-normalization.md) | V1 config → V2 in-memory normalization (no rewrite) |
| [docs/mcp-router-v2-addendum.md](./docs/mcp-router-v2-addendum.md) | MCP Router compatibility verification |

## License

[Sustainable Use License 1.0](./LICENSE.md) — internal business use. This fork does not modify,
remove, or obscure any licensing notices; see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)
for redistributed components. Do not redistribute commercially.
