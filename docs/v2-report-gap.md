# OpenCode V2 re-port gap — tools and hooks that never made it across

> **Status:** inventory + prioritization. Every row below is evidence-backed against
> `d6096afe2^` (the last V1-line commit) and the current `packages/omo-opencode/src/v2/`.
>
> **Headline:** the V2 port is not a port of the V1 plugin surface, it is a **new minimal
> plugin**. V1 shipped 2,788 files under `packages/omo-opencode/src/`; V2 ships 22 under
> `packages/omo-opencode/src/v2/`. `docs/parity-matrix.md` scores 24/24 PASS because it
> measured the harness (plugin loads, tools register, RPCs respond) rather than the
> **capability** surface.

## What V2 actually ships today

| Surface | V1 | V2 today |
|---|---|---|
| Registry tools | 37 names | 5 (`glob`, `grep`, `background_task`, `background_output`, `background_cancel`) |
| Lifecycle hooks | 54 wired slots (61 team / 62 monitor) | 4 (`tool.execute.before`, `tool.execute.after`, `session.compaction`, `shell.create.before`) |
| Agents | 11 | 11 registered as definitions, but only `omo.agents dispatch` as a callable surface |
| Built-in MCP | 4 (3 remote + `lsp`) | 4, but `lsp` was `disabled` until `fix/v2-lsp-mcp-report` |
| Mode prompts | 4 keyword modes | 0 (no keyword detector) |
| Team mode | 12 tools + core | 0 |
| Guard hooks (write guard, comment checker, rules, SSRF) | present | 0 |

The V1 directories that still exist under `packages/omo-opencode/src/{hooks,tools,features,plugin}/`
are **`AGENTS.md`-only stubs**. They document the V1 semantics, which makes them a useful port
spec, but they contain no implementation.

---

## 1. Tools that were never re-ported

### 1a. Adapter-only re-ports (the domain logic already lives in a harness-neutral core package)

These are the cheapest real capability wins: the core package holds the behavior, and only a
thin V2 tool shell is missing.

| Tool(s) | V1 source | Core package that already holds the logic | Gate | Difficulty |
|---|---|---|---|---|
| `skill_mcp` | `tools/skill-mcp/` | `packages/mcp-client-core/src/skill-mcp-manager/` (manager, connection, oauth-handler, stdio-client, http-client) | none | **Easy** |
| `edit` (hashline) | `tools/hashline-edit/` (21 files) | `packages/hashline-core/` — **17 of 21 files already extracted** | `hashline_edit` | **Easy** |
| `team_*` (12 tools) | `features/team-mode/tools/` | `packages/team-core/` (registry, mailbox, tasklist, state-store, worktree, tmux layout) | `team_mode.enabled` | **Medium** (12 thin adapters) |

`edit` matters beyond its own feature: the repo's own `LINE#ID` editing invariant (root
`AGENTS.md`, "Hashline edit + read pairing") has **no V2 implementation**, so edits fall back
to unguarded line-number edits with no staleness detection.

### 1b. Core holds the primitives, the wrapper is V1-only

| Tool | V1 source | What survives | Missing | Difficulty |
|---|---|---|---|---|
| `skill` | `tools/skill/` | `skills-loader-core/src/tools/skill/` (matcher, scope priority) + `opencode-skill-loader/` (discovery, content) | the tool shell, body injection, session skill cache | **Medium** |
| `interactive_bash` | `tools/interactive-bash/` | `packages/tmux-core/` (runner, tmux-utils, cmux-detect) | the command builder + blocklist | **Medium** |
| `task` (delegate) | `tools/delegate-task/` (100+ files) | `packages/delegate-core/` (model selection, retry), `packages/model-core/` (category routing) | the whole session create/prompt/poll/fetch chain | **High** |
| `call_omo_agent` | `tools/call-omo-agent/` (25 files) | `packages/delegate-core/`, `packages/model-core/` | session creator, completion poller, message processor, executors | **High** |

V2 registers the 11 agent **definitions** (`ctx.agent.transform`) but exposes **no model-facing
tool** to invoke one. The `omo.agents dispatch` RPC is a diagnostic surface.

### 1c. Full rewrites (no core to lean on)

| Tool(s) | V1 source | Why it is a rewrite | Difficulty |
|---|---|---|---|
| `session_list`, `session_read`, `session_search`, `session_info` | `tools/session-manager/` | `sdk-storage.ts` calls the OpenCode SDK and `file-storage.ts` reads the storage dir; no `session-core` package exists | **High** |
| `monitor_start`, `monitor_stop`, `monitor_list`, `monitor_output` | `tools/monitor/` + `features/monitor/` (36 files) | the entire supervision engine (manager, ring buffer, line stream, output injector, pipeline) is gone | **High** |
| `look_at` | `tools/look-at/` (26 files) | child-session runner + image conversion (sips/ImageMagick) + mime inference | **Medium-High** |
| `task_create`, `task_get`, `task_list`, `task_update` | `tools/task/` | the task store and the todo bridge are gone; `boulder-state` is plan state, not the V1 task API | **Medium-High** |
| `create_goal`, `update_goal`, `get_goal` | `hooks/goal/tools.ts` | the goal controller and its persistence are gone | **Medium-High** |

---

## 2. Hooks that were never re-ported

V1 composed **54** hook slots (61 with team mode, 62 with monitor) across 62 directories.
V2 registers **4**. The full per-hook table lives in the audit notes; the ranked shortlist:

| Rank | Hook | V2 hook to use | Breaks without it? | Safety/security |
|---|---|---|---|---|
| 1 | `write-existing-file-guard` | `ctx.tool.hook("execute.before")` | yes | **yes** |
| 2 | `keyword-detector` (the ULW entry point) | `ctx.session.hook("prompt")` + `ctx.session.hook("context")` | the headline feature is dead | no |
| 3 | `prometheus-md-only` | `ctx.tool.hook("execute.before")` | no | **yes** |
| 4 | `notepad-write-guard` | `ctx.tool.hook("execute.before")` | no | **yes** |
| 5 | `comment-checker` | `ctx.tool.hook("execute.before"/"execute.after")` | no | no (`comment-checker-core` survives) |
| 6 | `rules-injector` | `ctx.tool.hook("execute.before"/"execute.after")` | project rules never reach the model | no |
| 7 | `model-fallback` (proactive) | `ctx.session.hook("model.request")` + `ctx.session.switchModel()` | yes | no |
| 8 | `runtime-fallback` (reactive) | `ctx.session.hook("retry")` + `ctx.session.switchModel()` | yes | no |
| 9 | `todo-continuation-enforcer` + `goal` | `ctx.event.subscribe` + `ctx.tool.transform` | yes | no |
| 10 | `compaction-todo-preserver` | `ctx.tool.hook("execute.before")` + `ctx.session.hook("compaction")` | yes | no |
| 11 | `tool-pair-validator` | `ctx.session.hook("context")` (mutate `input.messages`) | yes (hard API 400s) | no |
| 12 | `webfetch-redirect-guard` | `ctx.tool.hook("execute.before"/"execute.after")` | no | **yes** (SSRF) |
| 13 | `bash-file-read-guard` | `ctx.tool.hook("execute.before")` | no | no |
| 14 | `non-interactive-env` | `ctx.tool.hook("execute.before")` | yes for `opencode run` | no |
| 15 | `auto-slash-command` | `ctx.command.transform` + `ctx.session.hook("prompt")` | no | no |

Do **not** port: `ralph-loop` (V1 unwired, superseded by `goal`), `task-reminder` and
`hashline-edit-diff-enhancer` (V1 unwired orphans), the `zauc-mocks-*` directories (test
scaffolding).

### V2 hook surface that exists today

From `node_modules/@opencode/plugin/dist/promise/`:

- `ctx.session.hook(...)`: `prompt`, `context`, `compaction`, `generate`, `title`,
  `model.request`, `http.request`, `http.response`, `retry`, `experimental.ws.*`
- `ctx.tool.hook("execute.before" | "execute.after")`
- `ctx.shell.hook("create.before")`
- `ctx.permission.hook("evaluate")`
- `ctx.event.subscribe(cb)` (no named `event` hook)
- transforms: `ctx.tool.transform`, `ctx.agent.transform`, `ctx.model.transform`,
  `ctx.provider.transform`, `ctx.mcp.transform`, `ctx.command.transform`,
  `ctx.skill.transform`, `ctx.integration.transform`, `ctx.vcs.transform`,
  `ctx.websearch.transform`, `ctx.worktree.transform`

Mutability facts that decide the ports: `SessionPrompt.prompt` is `DeepMutable` (so
`input.prompt.text` is assignable); `SessionContext.system` is a mutable array of
`SystemPart` whose `text` is readonly (push a new part, never mutate in place);
`SessionContext.model` is readonly (use `ctx.session.switchModel`, not an in-place rewrite);
`SessionRequestOptions` is mutable.

---

## 3. The ULW / ultrawork chain

The prompt bodies **already exist** and survive in `packages/prompts-core/`:

| File | Purpose |
|---|---|
| `prompts/ultrawork/default.md` | Claude/other-model variant |
| `prompts/ultrawork/gpt.md` | GPT variant |
| `prompts/ultrawork/gemini.md` | Gemini variant (adds a `<GEMINI_INTENT_GATE>`) |
| `prompts/ultrawork/glm.md` | GLM variant |
| `prompts/ultrawork/planner.md` | Prometheus/planner doctrine |
| `prompts/ultrawork/codex.md` | Codex harness variant (not used by the OpenCode adapter) |
| `prompts/mode/team.md` | team-mode reference |
| `prompts/mode/hyperplan.md` | hyperplan banner + skill load |

So the ULW port is mostly **adapter** work, not content work.

### Correction to the stale root `AGENTS.md`

The root `AGENTS.md` says the IntentGate classifies `ultrawork`/`ulw`, `search`, `analyze`,
`team`. **That is stale.** The `search` and `analyze` modes were removed upstream
(`b2f6bcdba refactor(keyword-detector): remove search and analyze modes`). V1 at
`d6096afe2^` detects exactly **four** keyword types:

| type | pattern | injected message |
|---|---|---|
| `ultrawork` | `/\b(ultrawork\|ulw)\b/i` | `getUltraworkMessage(agentName, modelID)`, routed by model family |
| `team` | `/\bteam[\s_-]?mode\b/i` | `TEAM_MODE_PROMPT` |
| `hyperplan` | `/\bhyperplan\b\|(?<![\w.])hpp\b/i` | `HYPERPLAN_MODE_PROMPT` (negative lookbehind avoids the `.hpp` C++ header false positive) |
| `hyperplan-ultrawork` | `/\b(?:hpp\|hyperplan)\s+(?:ulw\|ultrawork)\b\|\b(?:ulw\|ultrawork)\s+(?:hpp\|hyperplan)\b/i` | hyperplan banner + ultrawork message |

### Ordered porting steps

| Step | V1 source | V1 hook | V2 hook |
|---|---|---|---|
| 1 | `hooks/keyword-detector/ultrawork/*` loader shims | n/a | new `src/v2/keyword-detector/ultrawork/*.ts`, re-importing the `prompts-core` constants |
| 2 | `hooks/keyword-detector/{constants,detector}.ts` | consumed by `chat.message` | new `src/v2/keyword-detector/detector.ts`; V1's `output.parts[]` collapses to the single flat `input.prompt.text` string |
| 3 | `hooks/keyword-detector/hook.ts` | `chat.message` | `ctx.session.hook("prompt")` -> `input.prompt.text += "\n\n---\n\n" + messages`. `session.prompt` carries no agent/model, so track them per session from the `context` hook |
| 4 | `hooks/keyword-detector/hook.ts` + `plugin/system-transform.ts` | `experimental.chat.system.transform` | `ctx.session.hook("context")` -> `input.system.push({type:"text", text: message})`; guard with `input.system.some(p => p.text.includes("<ultrawork-mode>"))` |
| 5 | `hooks/compaction-todo-preserver/` | `tool.execute.before` + `event` | `ctx.session.hook("compaction")` -> re-inject the body plus the preserved todos |
| 6 | `hooks/ulw-execute/*` (20 files) + `features/builtin-commands/templates/ulw-execute.ts` | `chat.message` + `command.execute.before` | `ctx.command.transform` (V2 has **no** command-execute hook) + `ctx.session.hook("prompt")`. The `ULW_EXECUTE_TEMPLATE` with the `"You are starting an Atlas work session."` marker is **gone and must be re-authored**; `packages/boulder-state/` survives intact |
| 7 | `hooks/goal/*` | `event` only (`session.idle`, `session.deleted`) | `ctx.event.subscribe` + `ctx.session.hook("prompt")` + `ctx.tool.transform` for `create_goal` / `update_goal` / `get_goal` |
| 8 | `plugin/hooks/create-transform-hooks.ts` | n/a | wire the new module into `src/v2/index.ts` `setup(ctx)` with the same per-feature try/catch isolation the existing registers use |

### Guards that must survive the port

1. Skip synthetic/internal-only text.
2. Skip system directives.
3. Skip slash-command invocations.
4. Skip non-OMO agents (`builder`, `plan`).
5. Filter ultrawork/hyperplan for planner agents.
6. Skip background/subagent sessions.
7. In non-main sessions allow only `ultrawork` / `hyperplan-ultrawork`.
8. Skip if the message body is already present in the text.
9. Session cap 256 (LRU) for the mode set and the explicit-ultrawork map.
10. `default_mode.ultrawork` auto-activation.
11. `session.compacted` marks the session for restoration; `session.deleted` clears it.
12. Toast on ultrawork / hyperplan / hyperplan-ultrawork / default-mode activation.

### Two blockers to resolve before starting

1. **V2 event names.** V1 `session.idle` has no direct V2 equivalent in the `.d.ts` files. The
   names visible in `src/v2/client-events.ts` and `src/v2/orchestration.ts` are
   `session.execution.succeeded|failed|interrupted` and `session.compaction.*`. The `goal` and
   `todo-continuation-enforcer` ports depend on getting this exactly right; validate it
   against a real OpenCode 2.0.20 SSE stream before writing the hook.
2. **V2 client shape.** Every V1 call site that used
   `ctx.client.session.messages(...)` / `ctx.client.session.promptAsync({path, body})` must be
   rewritten to the flat V2 API (`client.session.message.list(...)`,
   `client.session.prompt({sessionID, text})`). Affected: `ulw-execute/session-plan-affinity.ts`,
   `goal/index.ts`, and the `packages/utils/src/prompt-async-gate.ts` client adapter (the gate
   itself is harness-neutral and needs only an adapter).

---

## 4. Recommended PR sequence

Cheapest and highest value first; each entry is one atomic PR.

| # | PR | Why now |
|---|---|---|
| 1 | `fix/v2-lsp-mcp-report` (done) | the LSP MCP was `disabled` in every install |
| 2 | `feat/v2-guard-hooks` | `write-existing-file-guard`, `prometheus-md-only`, `notepad-write-guard`, `bash-file-read-guard`, `webfetch-redirect-guard` -- all `tool.execute.before`, all small, three of them safety guards |
| 3 | `feat/v2-hashline-edit` | re-host `hashline-core` as the `edit` tool; restores the repo's own `LINE#ID` invariant |
| 4 | `feat/v2-skill-mcp` | thin wrapper over `mcp-client-core`; unlocks tier-3 skill MCP servers |
| 5 | `feat/v2-skill-tool` | re-host the `skills-loader-core` tool shell; skill bodies become loadable again |
| 6 | `feat/v2-ultrawork-intent` | the ULW keyword detector plus the system injection; the product's front door |
| 7 | `feat/v2-rules-and-comment-checker` | `rules-injector` and `comment-checker` over the surviving core packages |
| 8 | `feat/v2-session-tools` | `session_list` / `session_read` / `session_search` / `session_info` rewritten onto the V2 client |
| 9 | `feat/v2-task-and-call-omo-agent` | the big one: the delegation session chain |
| 10 | `feat/v2-team-mode` | 12 thin adapters over `team-core` |
| 11 | `feat/v2-goal-and-continuation` | `goal` + `todo-continuation-enforcer`; needs the V2 event-name mapping settled first |
| 12 | `feat/v2-fallbacks` | proactive `model-fallback` + reactive `runtime-fallback` via `ctx.session.switchModel` |

---

## 5. Doc drift found while auditing

- Root `AGENTS.md`: the IntentGate keyword list still names the removed `search` and
  `analyze` modes, and the "TOOL CATALOG" section still lists the V1 tool set and the
  "14 OpenCode hook handlers" table.
- `packages/omo-opencode/src/AGENTS.md`: the "INITIALIZATION (7 STEPS)" flow, the "14 OPENCODE
  HOOK HANDLERS" table, the 5-tier hook composition and the subsystem inventory all describe
  the removed V1 architecture.
- `packages/omo-opencode/src/{hooks,tools,features,plugin}/AGENTS.md`: AGENTS.md-only stubs
  that read as if the implementations are present.
- `docs/parity-matrix.md`: measures harness behavior, not capability; row 16 recorded the
  disabled LSP MCP as PASS.
