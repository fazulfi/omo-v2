# Cutover Runbook — opencode V2 Migration (zrouter internal tooling)

Status: **REHEARSED (task 20)** — cutover execution is gated on explicit owner approval (HALT gate, task 21).

Scope: switching the owner's daily-driver CLI from opencode V1 (`opencode-ai@1.18.x`, OMC 5.1.x V1 plugin) to opencode V2 (`@opencode/cli@2.0.20` + the ported `oh-my-openagent` V2 plugin + DCP 3.2.0 + tokenscope PR#50 build).

Evidence base: task-19 runtime parity matrix (`docs/parity-matrix.md`, 19 PASS + 5 PASS* with documented limitations) + task-20 rollback drill (this document).

---

## 1. Architecture facts (verified during the port)

| Fact | Detail | Evidence |
|---|---|---|
| V2 reads V1 config in-memory | `debug config` normalize, NO file rewrite (sha256 before == after) | task-3 `docs/v2-config-normalization.md` |
| Config rollback not required for cutover | Cutover never rewrites config; V1 config keeps working if we roll back | task-3 |
| `~/.bun/bin/opencode.exe` is a bun shim | Effective version lives in `~/.bun/install/global/node_modules/opencode-ai` (bun global package); copying the exe alone to a foreign path fails ("could not find bin metadata file") | task-20 drill finding |
| Task-1 backup scope | binary shim + user config set + workspace config + plugin-cache trees (27,290 files, 642 MB). **Does NOT include** the bun global `opencode-ai` package itself | task-1 |
| Rollback version levers | (1) offline restore of backup files; (2) version pin via `npm install opencode-ai@<version>` (or `bun add -g`) — this is what actually swaps the effective version | task-20 drill |

## 2. Owner-drift history (all out-of-scope, documented per plan rule 1)

| When | Change | Baseline impact |
|---|---|---|
| task-3 (in-flight) | Owner installed mcp-router, removed 15 legacy MCP servers | re-snapshot r2 |
| task-20 (guard rerun) | Owner ran `opencode upgrade`: 1.18.33 → **1.18.34**; OMC re-resolved 5.1.4 → **5.1.7**; config edited 2nd time (sha 192a4ada…) | re-snapshot **r3** (`backup/v1-baseline/manifest-v1-post51-r3.json`) |

**Consequence:** restoring the task-1 backup returns production to the 1.18.33 + OMC-4.19.4-era state — several versions behind the owner's *current* state. The recommendation below (§3, step 1) refreshes the backup immediately before cutover so the primary rollback target matches current reality.

## 3. Pre-cutover checklist (do ALL before touching anything)

1. **Refresh the backup** to the current production state (this supersedes the task-1-era backup as the primary rollback target):
   - Snapshot: `~/.bun/bin/opencode.exe` + `opencode.cmd`, config set (`opencode.json`, `tui.json`, `cli.json`, `dcp.jsonc`, `package.json`), `new-saas/opencode.json`, plugin-cache trees, **and** `~/.bun/install/global/node_modules/opencode-ai` (the version package — new vs task-1 backup).
   - Record the exact `opencode-ai` version present (rollback pin target).
   - Write `manifest-v2-pre-cutover.json` (same format as r3) and verify guard passes against it.
2. **Guard rerun** vs the fresh manifest → exit 0.
3. **V1 retained**: do not uninstall V1 during cutover; the observation window (§6) depends on it.
4. Confirm parity matrix is 100% PASS / PASS* with no new FAILs.

## 4. Cutover steps

1. Install V2 CLI as the new default (`@opencode/cli@2.0.20` — exact version; keep V1 installed for the observation window).
2. Point the plugin config (`plugins` array, V2-shape) at the built V2 artifacts: OMC V2 build (from this fork, `packages/omo-opencode/src/v2`), `@tarquinen/opencode-dcp@3.2.0`, tokenscope PR#50 build (local build — npm `@latest` still resolves 1.8.1 V1-only, which FAILS on V2).
   - Plugin entries must be **absolute paths to plugin directories** (single-file paths are rejected; tokenscope needs a root `index.js` wrapper — see task-16).
3. **Do NOT rewrite the user config.** V2 auto-normalizes in-memory (task-3 proof). Field mapping (model string → `model:{providerID,model}`, `plugin` → `plugins`, `enabled_providers` → `experimental.policies`, `mcp` → `mcp.servers`) is lossless for owner-used keys.
4. Post-cutover smoke: re-run the task-19 parity matrix rows (bootstrap `omo.status`, tools list/invoke, agents list/dispatch, orch spawn/collect, todo roundtrip, MCP list, skills list, DCP status, tokenscope tool). All must PASS with the real environment (real API keys present, unlike the masked harness).

## 5. Rollback

**Triggers:** any parity-matrix row regresses to FAIL in production; plugin load failure of any of the 3 plugins; owner judges the V2 experience unusable.

**Primary path (offline-first, rehearsed):**
- Restore the pre-cutover backup files (config + plugin cache + shim) — measured **0.08 s**, pure local copy, no network.
- Re-pin the effective version if needed: reinstall the recorded `opencode-ai@<version>` into the bun global (this is the lever that actually swaps versions — the shim exe hash never changes).
- Caveat (from drill): the task-1-era backup restores an OLD config snapshot (pre-mcp-router). §3 step 1 (fresh backup) eliminates this caveat. If only the task-1 backup exists, the owner must manually re-apply their mcp-router config edit after restore.

**Fallback path (rehearsed):**
- `npm install --prefix <sandbox> opencode-ai@1.18.33` → self-contained binary verified `--version` = 1.18.33, measured **17.7 s** (includes network — that is why it is the fallback, not the primary).
- Use when the bun global install itself is damaged.

## 6. Observation window (V1 retained)

- Duration: owner's discretion; minimum one full working day.
- Re-verify the 5 PASS* parity items now unblocked by real API keys: hook firing on live sessions, model-backed agent dispatch responses, bg-task complete transition, DCP compress execution, tokenscope real token metrics, TUI render in a real terminal.
- Rollback stays available for the whole window (V1 untouched by cutover).

## 7. Drill record (task 20 evidence)

| Drill | Result | Time | Evidence |
|---|---|---|---|
| Offline primary restore (sandbox) | binary + 5 config hashes MATCH task-1 manifest | 0.08 s | `task-20/` drill log |
| Fallback npm reinstall 1.18.33 | `--version` = 1.18.33, exit 0 | 17.7 s | `task-20/` fallback log |
| Guard vs r2 | FAIL (owner drift: 1.18.34, OMC 5.1.7, config 192a4ada) — documented, out-of-scope | — | `task-20/guard-rerun-drift-detected.log` |
| Re-snapshot r3 + guard vs r3 | **PASS** exit 0 (all 8 files + 3 trees) | — | `task-20/guard-r3-pass.log` |
