# V1 → V2 API Mapping — `oh-my-openagent` port

> **Task 5** of `opencode-v2-migration` (approved plan). This document is the GO/NO-GO basis for Wave 2 of the port.
>
> **Scope:** `packages/omo-opencode/src` — the authored plugin package (the OpenCode V1 integration surface).
> **Target:** `@opencode/plugin` + `@opencode/client` + `@opencode/cli` **EXACT `2.0.20`**.
> **Fork:** private fork of `code-yeongyu/oh-my-openagent` (SUL-1.0), branch `port/v2`, base `d1317056` (v5.1.4).

| Property | Value |
|---|---|
| V1 upstream package | `oh-my-openagent` (root `package.json` name), devDeps `@opencode-ai/plugin` + `@opencode-ai/sdk` **1.18.31** |
| V1 plugin surface | `@opencode-ai/plugin` (bare) + `/tool` + `/tui` + bridge `/sdk/v2`, `/sdk/v2/gen/client` |
| V2 plugin surface | `@opencode/plugin@2.0.20` → `dist/promise/index.d.ts` (default), `dist/tui/` (TUI) |
| V2 client surface | `@opencode/client@2.0.20` → `dist/promise/index.d.ts` (default) |
| V2 evidence path | `C:\Users\faizz\ports\omo-v2\v2-home\npm-prefix\node_modules\@opencode\{plugin,client}\dist\` |

---

## 1. Importer inventory

Command (from fork repo root):

```
grep -rl "@opencode-ai/" packages/omo-opencode/src | wc -l
```

**Measured result: `347` files** (the plan text noted "expected 349"; the measured figure on the checked-out `port/v2` HEAD is **347** — see cross-check below).

### 1.1 Counts per import specifier (files, `from "..."`-based, `--include="*.ts"`)

| Import specifier | Files | Import statements (lines) | Note |
|---|---|---|---|
| `@opencode-ai/plugin` (bare) | 253 | 254 | the plugin API + main `Plugin()`/`PluginInput` surface |
| `@opencode-ai/sdk` (bare) | 53 | 55 | client + shared types |
| `@opencode-ai/plugin/tool` | 45 | 45 | tool-definition helpers (`tool`, `ToolDefinition`) |
| `@opencode-ai/plugin/tui` | 6 | 6 | TUI extension contract |
| `@opencode-ai/sdk/v2` | 1 | 1 | **bridge subpath — must be eliminated** |
| `@opencode-ai/sdk/v2/gen/client` | 1 | 1 | **bridge subpath — must be eliminated** |

- `@opencode-ai/plugin` (bare) overlaps with `/tool` and `/tui` (subpath imports are separate files that also may import bare plugin). Union of the 6 specifier file-lists = **341**.
- **6 additional files** reference `@opencode-ai/` via string literals, comments, or `import("…").Type` type queries only (no runtime import): `config-migration/config-migration-export.test.ts`, `dependency-security.test.ts`, `hooks/tool-pair-validator/hook.test-support.ts`, `shared/opencode-coupling-audit.test.ts`, `tools/call-omo-agent/tools.test.ts`, `tools/call-omo-agent/tools-edge-cases.test.ts`.
- Total coverage = 341 + 6 = **347** ✓.

### 1.2 Distinct imported symbols (aggregate, both `import {…}` and `import type {…}`)

| Symbol | Specifier | Import-statement count |
|---|---|---|
| `PluginInput` | plugin (bare) | 228 |
| `ToolDefinition` | plugin (bare) | 19 |
| `tool` | plugin (bare) | 17 |
| `Hooks` | plugin (bare) | 6 |
| `PluginModule` | plugin (bare) | 2 |
| `Plugin` | plugin (bare) | 2 |
| `AgentConfig` | sdk | 28 |
| `createOpencodeClient` | sdk | 10 |
| `Part` | sdk | 8 |
| `Message` | sdk | 8 |
| `Session` | sdk | 2 |
| `Project` | sdk | 2 |
| `OpencodeClient` | sdk | 2 |
| `Todo` | sdk | 1 |
| `SessionStatusData` | sdk | 1 |
| `SessionPromptData` | sdk | 1 |
| `SessionPromptAsyncData` | sdk | 1 |
| `Event` | sdk | 1 |
| `createOpencode` | sdk | 1 |
| `AssistantMessage` | sdk | 1 |
| `ToolContext` | plugin/tool | 30 |
| `ToolDefinition` | plugin/tool | 16 |
| `tool` | plugin/tool | 16 |
| `ToolResult` | plugin/tool | 5 |
| `TuiPluginApi` | plugin/tui | 5 |
| `TuiPromptRef` | plugin/tui | 4 |
| `TuiPluginModule` | plugin/tui | 1 |
| `TuiHostSlotMap` | plugin/tui | 1 |
| `TuiSlotContext` | plugin/tui | 1 |
| `KeyEvent` | plugin/tui | 1 |
| `TuiPluginMeta` | plugin/tui | 1 |
| `TuiSlotPlugin` | plugin/tui | 1 |
| `OpencodeClient` | sdk/v2 | 1 |
| `Client` | sdk/v2/gen/client | 1 |

> **Re-verification note vs plan**: the plan's "238+16 / 47+8 / 43+2" notation decomposes to the same import-statement totals measured here (plugin 254, sdk 55, plugin/tool 45). File counts differ slightly from the plan's "349" because the checked-out HEAD (`defe1b991`, `port/v2` with the task-4 provenance docs commit) resolves 347 `.ts` files referencing `@opencode-ai/`. The 2-file delta is a base-revision measurement difference, not a code change; the acceptance cross-check uses **347** as the authoritative number.

---

## 2. API mapping tables

Legend for V2 references: `p/` = `@opencode/plugin/dist/`, `c/` = `@opencode/client/dist/`. All V2 symbol names below are **read from the installed 2.0.20 `.d.ts` files** (paths cited), not guessed.

### 2.1 `@opencode-ai/plugin` (bare) — 253 files

V1 contract (verified from source):

- `Plugin` is a **function** `(input: PluginInput, options?) => Promise<Hooks> | Hooks` — `packages/omo-opencode/src/plugin/types.ts:4` defines `PluginContext = Parameters<Plugin>[0]` and `PluginInstance = Awaited<ReturnType<Plugin>>`.
- `PluginInput` (a.k.a. `PluginContext`) carries `{ directory, client, serverUrl, state, … }` — consumed throughout `create-plugin-module.ts` / `plugin-interface.ts`.
- `PluginModule` = `{ id: string; server: Plugin; tui?: TuiPluginModule }` — `index.ts:4-8` (`pluginModule.server`, default export), `tui.ts:120`.
- `Hooks` = the record of hook handlers returned by the plugin (`chat.params`, `chat.headers`, `command.execute.before`, `chat.message`, `experimental.chat.messages.transform`, `experimental.chat.system.transform`, `tool.definition`, `tool.execute.before`, `tool.execute.after`, `config`, `event`, `experimental.session.compacting`, `experimental.compaction.autocontinue`, `dispose`, plus `tool`) — `plugin-interface.ts:36-109`.
- `tool` = tool-definition factory (see §2.3).
- `ToolDefinition` = the tool record type (see §2.3).

| V1 symbol / family | V1 ref (file:function) | V2 counterpart | V2 ref (file:line) |
|---|---|---|---|
| `Plugin` (function) | `plugin/types.ts:4` | `Plugin.define({ id, setup(ctx) })` | `p/promise/plugin.d.ts:59` (`define`), `:55-58` (`Plugin { id, setup }`) |
| `PluginInput` / `PluginContext` | `plugin/types.ts:4` | `Context` (passed to `setup`) | `p/promise/plugin.d.ts:25-53` |
| `PluginInstance` (hooks record) | `plugin/types.ts:5` | per-domain `ctx.session.hook` / `ctx.tool.hook` / `ctx.shell.hook` | `p/promise/session.d.ts:129-145`, `p/promise/tool.d.ts:53-61`, `p/promise/shell.d.ts:9-13` |
| `PluginModule` | `index.ts:4-8` | single `Plugin.define` module (id + setup); TUI side via `@opencode/plugin/tui` | `p/tui/plugin.d.ts:4-8` |
| `Hooks` (type) | `plugin/types.ts:7-16` | `Hooks<Spec>` / `ModelHooks<Spec>` generics | `p/promise/registration.d.ts:8-11` |
| `tool` (factory) | `create-tools.ts` (indirect), §2.3 | `ctx.tool.transform(editor => editor.add(tool))` | `p/promise/tool.d.ts:24,53-57` |
| `ToolDefinition` | §2.3 | `Tool.Info<Input,Output>` | `p/promise/tool.d.ts:13-15` |
| `PluginInput["client"]` (the in-process client) | `tools/call-omo-agent/tools.test.ts:5` (type query) | `ctx.client` (TUI) / `OpenCodeClient` (base) | `p/tui/context.d.ts:463`; `c/promise/index.d.ts:6` |
| `PluginInput["state"]`, `["directory"]`, `["serverUrl"]` | `tui.ts:144`, `testing/create-plugin-module.ts` | `ctx.location` / `ctx.options` / `context.location` | `p/promise/plugin.d.ts:27,28` |

### 2.2 `@opencode-ai/sdk` (bare) — 53 files

| V1 symbol / family | V1 ref (file:function) | V2 counterpart | V2 ref (file:line) |
|---|---|---|---|
| `createOpencodeClient({ baseUrl })` | `cli/run/server-connection.ts:1,94`; `shared/live-server-route.ts:1,248` | `OpenCode.make({ baseUrl, … })` → `OpenCodeClient` | `c/promise/client.d.ts:6` (`make`); `c/promise/index.d.ts:6` (`OpenCodeClient = ReturnType<typeof OpenCode.make>`); `c/promise/generated/client.d.ts:2-4` (`ClientOptions.baseUrl`) |
| `createOpencode({ signal, port, hostname })` | `cli/run/server-connection.ts:1,78` | **no direct value** → `Service.ensure/discover/stop` (local service lifecycle) | `c/dist/service.d.ts:1-52`; `c/dist/promise/service.d.ts` (`discover/ensure/stop/headers`) |
| `OpencodeClient` (type) | `cli/run/types.ts:1`; `cli/run/agent-profile-colors.ts:1` | `OpenCodeClient` | `c/promise/index.d.ts:6` |
| `AgentConfig` | `agents/agent-builder.ts:1` (28 files) | `Agent` schema (config: `system` not `prompt`; `mode: "subagent"\|"primary"\|"all"`) | `@opencode/schema/dist/config/agent.d.ts:24,26`; re-exported `p/promise/index.d.ts:4` (`Agent`) |
| `Message` | `features/btw-side/context-injector.ts`, `plugin/messages-transform.ts` | `Message` (AI SDK) or `SessionMessage` parts | `p/promise/session.d.ts:2` (`Message` from `@opencode/ai`); `c/promise/client.d.ts:79-80` (`SessionMessage*` union) |
| `Part` | `features/btw-side/context-injector.ts`, `plugin/messages-transform.ts` | `Part` (AI SDK) | `p/promise/session.d.ts:2` (`Message`), `@opencode/ai` |
| `Session` | `features/btw-side/context-injector.ts`, `hooks/atlas/final-wave-approval-gate.test-support.ts` | `SessionInfo` / `Session.ID` | `c/promise/client.d.ts:34` (`session.create → SessionInfo`); `p/promise/session.d.ts:6` |
| `Project` | `hooks/atlas/tool-execute-after-*.test.ts` | `Project` | `c/promise/client.d.ts:146-149` (`project.list → ProjectListOutput`); `p/tui/context.d.ts:73-83` |
| `Todo` | `hooks/compaction-todo-preserver/index.test.ts` | `Todo` schema (session `todos`) | `@opencode/schema` |
| `SessionStatusData` / `SessionPromptData` / `SessionPromptAsyncData` | `tools/delegate-task/types.ts` | event payloads: `OpenCodeEvent` | `c/promise/index.d.ts:5` (`OpenCodeEvent`); `c/promise/generated/types.d.ts` |
| `Event` | `plugin/event-types.ts` | `OpenCodeEvent` | `c/promise/index.d.ts:5` |
| `AssistantMessage` | `hooks/atlas/final-wave-approval-gate.test-support.ts` | `SessionMessageAssistant` | `c/promise/client.d.ts:80` |

### 2.3 `@opencode-ai/plugin/tool` — 45 files

V1 tool shape (verified `tools/grep/tools.ts:9-40`): `tool({ description, args: { …schema… }, execute: async (args, context) => … })` returns a `ToolDefinition`; `tool.schema.string()/number()/enum()/optional()/describe()` builds the arg schema; `execute` receives `(args, context)` where context carries `{ client, directory, … }`.

| V1 symbol | V1 ref | V2 counterpart | V2 ref (file:line) |
|---|---|---|---|
| `tool` (factory) | `tools/grep/tools.ts:9` | register via `ctx.tool.transform(editor => editor.add(tool))`; `Info` shape = `Omit<Tool.Info,"execute"> & { execute(input, ctx) }` | `p/promise/tool.d.ts:13-15,24,53-57` |
| `ToolDefinition` | `tools/grep/tools.ts:7` | `Tool.Info<Input,Output>` | `p/promise/tool.d.ts:13-15` |
| `ToolContext` | `features/team-mode/tools/tasks.ts:1` | `ToolContext { signal, progress }` | `p/promise/tool.d.ts:9-12` |
| `ToolResult` | (team-mode / hook tools) | `Tool.Result<Output>` | `p/promise/tool.d.ts:14` |

### 2.4 `@opencode-ai/plugin/tui` — 6 files

| V1 symbol | V1 ref (file) | V2 counterpart | V2 ref (file:line) |
|---|---|---|---|
| `TuiPluginModule` (`{ id, tui: async (api) => … }`) | `tui.ts:120-197` | `Plugin.define({ id, setup(context) })` from `@opencode/plugin/tui` | `p/tui/plugin.d.ts:4-8` |
| `TuiPluginApi` (the `api` object) | `tui.ts`, `tui-keymap.ts`, `tui-picker.ts`, `tui-session-bridge.ts`, `tui-wiring.ts` | `Context` (TUI) | `p/tui/context.d.ts:458-474` |
| `TuiHostSlotMap` | `tui-wiring.ts:2` | `SlotMap` | `p/tui/context.d.ts:161-178` |
| `TuiPromptRef` | `tui-keymap.ts:3`, `tui-wiring.ts:3` | session `form` / prompt slot input (no direct 1:1) | `p/tui/context.d.ts:63-71` (`form`), `:165-167` (`prompt.footer`) |
| `TuiSlotContext` | `tui-wiring.ts:5` | `SlotClaim.render(input)` | `p/tui/context.d.ts:199-231` |
| `KeyEvent` (re-export) | `tui-keymap.ts:2` | `KeyEvent` from `@opentui/core` | `p/tui/context.d.ts:3` |
| `TuiPluginMeta` / `TuiSlotPlugin` | `tui.test.ts:8` (test-only) | N/A (test types) | — |

### 2.5 Bridge subpaths — `@opencode-ai/sdk/v2` + `/v2/gen/client` (1 file)

Used **only** in `packages/omo-opencode/src/plugin/native-skills.ts` (lines 1-2):

```
import { OpencodeClient as V2OpencodeClient } from "@opencode-ai/sdk/v2"
import type { Client as V2GeneratedClient } from "@opencode-ai/sdk/v2/gen/client"
```

It reaches the V2 generated client **through the V1 plugin's internal `client._client`** and calls `new V2OpencodeClient({ client: generatedClient }).app.skills({ directory }, { throwOnError: true })` to load native skills.

**Port strategy:** in V2 this becomes a direct `@opencode/client` call — `ctx.client.app.skills(...)` (or the plugin's `ctx.skill` / `ctx.client`) with no `_client` reflection. The two bridge imports are **eliminable** (no other file uses them).

---

## 3. GAP table

| # | V1 symbol / behavior | V1 usage files | Gap description | Port strategy |
|---|---|---|---|---|
| G1 | `Plugin()` factory function → `Plugin.define()` | 253 bare-plugin files | Different module shape (`Plugin()` returns hooks record vs `Plugin.define({id, setup(ctx)})`) | **Remap** — rewrite entry (`index.ts` → `setup(ctx)`) and registry calls |
| G2 | V1 hooks `chat.params`, `chat.headers`, `command.execute.before`, `chat.message`, `tool.definition`, `experimental.chat.messages.transform`, `experimental.chat.system.transform` | `plugin-interface.ts`, `plugin/*.ts` | V2 has **no direct** equivalents for these names; V2 hook sets are `session.{prompt,context,compaction,generate,title,model.request,http.request,http.response,experimental.ws.*,retry}`, `tool.{execute.before,execute.after}`, `shell.{create.before}` | **Reimplement / remap** per domain: `chat.message`→`session.prompt`/`context`; `tool.definition`→`ctx.tool.transform`; `tool.execute.before/after`→`ctx.tool.hook("execute.before"/"execute.after")`; `command.execute.before`→shell/command domain (G4) |
| G3 | `config` + `event` plugin handlers | `plugin-interface.ts:85-93`, `plugin/event.ts` | V2 exposes `ctx.event.subscribe` + `ctx.client.event.subscribe`; no `config` hook | **Remap** — `event`→`ctx.event.subscribe`; `config`→read `ctx.options`/`ctx.location` (or drop config transform if it only fed V1 config surface) |
| G4 | `command.execute.before` | `plugin/command-execute-before.ts` | V2 has no command-execute hook in base plugin domain | **Reimplement** via `ctx.shell.hook("create.before")` for shell commands, or drop with justification if the command it guards is CLI-side |
| G5 | `experimental.session.compacting` + `experimental.compaction.autocontinue` | `plugin/session-compacting.ts`, `testing/create-plugin-module.ts` | V2 compaction hook is `session.compaction` (non-experimental) | **Remap** — `ctx.session.hook("compaction", …)` |
| G6 | `createOpencode` (spawn a local server process) | `cli/run/server-connection.ts` | `@opencode/client` has no spawn; local service lifecycle is `Service.discover/ensure/stop` | **Reimplement** via `@opencode/client/service` (`ensure` spawns `opencode serve --service`), or via `@opencode/cli` subprocess |
| G7 | `@opencode-ai/sdk/v2` + `/v2/gen/client` bridge | `plugin/native-skills.ts` | Forbidden bridge subpath | **Eliminate** — direct `@opencode/client` `app.skills` (see §2.5) |
| G8 | V1 TUI `api.slots.register({order, slots:{ session_prompt, session_prompt_right, sidebar_content }})` | `tui.ts:155-163`, `tui-wiring.ts:242-341` | V2 `SlotMap` is a **fixed** set: `app`, `home.footer(.status)`, `prompt.footer(.status/.file)`, `session.composer.top`, `session.panel`, `sidebar.content`, `sidebar.footer` | **Remap** — `sidebar_content`→`sidebar.content`; `session_prompt`/`session_prompt_right` have no V2 slot → reimplement prompt decoration via `prompt.footer` slot + `ctx.data.session` (see TUI verdict §4) |
| G9 | V1 `api.ui.Prompt`, `api.ui.Slot`, `api.command.register` | `tui-wiring.ts:206-221,249-298` | V2 has no `ui.Prompt`/`ui.Slot`; commands → `ctx.keymap.layer` commands with `palette`/`slash`; prompt decoration → `ui.slot(claim)` | **Reimplement** via `ctx.keymap.layer(...)` + `ctx.ui.slot(claim)` |
| G10 | V1 `api.state.session.get/status/permission/question`, `api.client.session.get({sessionID, directory})` | `tui-wiring.ts:63-67,114-123,234-236`; `tui-session-bridge.ts` | V2 reactive collections `ctx.data.session.list/get/status/…` + `ctx.client.session.get({sessionID})` (no `directory` param) | **Remap** — `ctx.data.session` (reactive) for state, `ctx.client.session.*` for reads |
| G11 | V1 `api.renderer._internalKeyInput` / `api.renderer.stdin` raw listeners | `tui-keymap.ts:77-108` | V2 exposes `ctx.renderer: CliRenderer` (`@opentui/core`) but no `_internalKeyInput`/`stdin` internals | **Reimplement** — use `ctx.keymap.layer` (targeted keymap commands) instead of raw stdin/keypress listeners |
| G12 | V1 `api.lifecycle.onDispose(cb)` | `tui.ts:192`, `tui-wiring.ts:350` | V2 cleanup = the value returned from `setup(context)` | **Remap** — return a cleanup function from `setup` |
| G13 | V1 `api.theme.current` (color tokens) | `tui.ts:162`, `tui-wiring.ts:336` | V2 `ctx.theme: ResolvedTheme` + `ctx.themeMode` | **Remap** — `ctx.theme` (and `@opencode/theme/tui` `ResolvedTheme`) |
| G14 | V1 `api.event.on("session.deleted", cb)` | `tui-wiring.ts:343` | V2 `ctx.data.on(type, handler)` / `ctx.data.listen` | **Remap** — `ctx.data.on("session.deleted", …)` |
| G15 | V1 `api.keymap.intercept(kind, cb, {priority})` / `registerLayer` | `tui-keymap.ts:110-214` | V2 `ctx.keymap.layer({commands, bindings, priority})` (no `intercept`) | **Remap** — `ctx.keymap.layer` with `priority` + `mode`/`target` scoping |
| G16 | `AgentConfig.prompt` field | `agents/agent-builder.ts`, 28 files | V2 agent config uses `system` (not `prompt`), `mode` ∈ `subagent|primary|all` | **Remap** — field rename `prompt`→`system`; map mode enum |
| G17 | `Message`/`Part`/`Session`/`Project`/`Todo`/`Event`/`SessionStatusData`/… SDK types | `features/btw-side/context-injector.ts`, `plugin/messages-transform.ts`, `tools/delegate-task/types.ts`, `plugin/event-types.ts`, etc. | Different type homes (`@opencode/ai`, `@opencode/schema`, `@opencode/client` generated) | **Remap** — retype to V2 equivalents (§2.2) |

**No GAP requires dropping a runtime feature.** Every GAP row above has a remap/reimplement strategy; the only "drop" candidates are sub-features already covered by a V2 primitive (G4's command hook, G3's `config` transform) — and even those map to a V2 equivalent rather than being silently removed.

---

## 4. TUI VERDICT — V2 exposes a TUI extension surface (PASS)

### 4.1 V1 contract (verified from source)

`TuiPluginModule` shape — `packages/omo-opencode/src/tui.ts:120-197`:

```ts
const module: TuiPluginModule = {
  id: "oh-my-openagent:tui",
  tui: async (api) => { /* … */ },
}
export default module
```

The `api` object (`TuiPluginApi`) surface used by the OMC TUI layer (`tui.ts`, `features/btw-side/tui-{keymap,picker,session-bridge,wiring}.ts`, `features/tui-sidebar/*`):

| `api.*` member | Used in |
|---|---|
| `api.state.path.directory` | `tui.ts:144`, `tui-wiring.ts:65,120` |
| `api.state.session.get/status/permission/question` | `tui-wiring.ts:114,234-236`, `tui-session-bridge.ts` |
| `api.client.session.get({sessionID, directory})` | `tui-wiring.ts:63-67,118-123` |
| `api.slots.register({order, slots:{…}})` | `tui.ts:155-163`, `tui-wiring.ts:242-341` |
| `api.renderer.requestRender()`, `api.renderer._internalKeyInput`, `api.renderer.stdin` | `tui.ts:160-181`, `tui-keymap.ts:77-108` |
| `api.theme.current` | `tui.ts:162`, `tui-wiring.ts:336` |
| `api.lifecycle.onDispose(cb)` | `tui.ts:192`, `tui-wiring.ts:350` |
| `api.ui.toast({variant,message})`, `api.ui.Prompt`, `api.ui.Slot`, `api.ui.dialog.open` | `tui-wiring.ts:161-172,249-298`, `tui-keymap.ts:39` |
| `api.command.register(cb)` | `tui-wiring.ts:206-221` |
| `api.keymap.intercept/registerLayer/clearPendingSequence` | `tui-keymap.ts:110-214` |
| `api.event.on("session.deleted", cb)` | `tui-wiring.ts:343` |

### 4.2 V2 contract (verified from `.d.ts`, `@opencode/plugin@2.0.20`)

`Plugin.define` (TUI) — `p/tui/plugin.d.ts:4-8`:

```ts
export interface Definition { readonly id: string; readonly setup: (context: Context) => Promise<Cleanup|void>|Cleanup|void; }
export declare function define(plugin: Definition): Definition;
```

TUI `Context` — `p/tui/context.d.ts:458-474`:

```ts
interface Context {
  readonly options: Record<string, any>;
  readonly location: LocationRef | undefined;
  readonly app: App;                          // { version, channel }  (:232-235)
  readonly renderer: CliRenderer;             // @opentui/core          (:3, :462)
  readonly client: OpenCodeClient;            // @opencode/client       (:463)
  readonly data: Data;                        // reactive collections   (:33-111)
  readonly attention: Attention;              // notify()               (:271-273)
  readonly theme: ResolvedTheme;              // @opencode/theme/tui    (:2, :466)
  readonly themeMode: "dark" | "light";       // (:467)
  readonly markdown: { registerCodeBlockRenderer(...): () => void }; // (:468-470)
  readonly keymap: Keymap;                    // (:375-395)
  readonly storage: Storage;                  // store()/memory()       (:6-22)
  readonly ui: UI;                            // (:396-457)
}
```

Key V2 TUI surfaces (with `.d.ts` line citations):

- **Renderer / Solid**: `ctx.renderer: CliRenderer` (`@opentui/core`), `JSX` from `@opentui/solid`, `Store` from `solid-js/store` — `p/tui/context.d.ts:3-5`. Solid component injection is first-class: `PluginContextProvider`/`usePlugin` exported — `p/tui/index.d.ts:2`.
- **Slot tree** (`ui.slot(claim)`): fixed `SlotMap` — `app`, `home.footer`, `home.footer.status`, `prompt.footer`, `prompt.footer.status`, `prompt.footer.file`, `session.composer.top`, `session.panel`, `sidebar.content`, `sidebar.footer` — `p/tui/context.d.ts:161-178`. Placements `prepend/append/before/after/replace` — `:199-231`.
- **UI**: `dialog` (show/set/clear/alert/confirm/prompt/select) `:311-322`, `toast` `:245-247`, `format.path` `:399-401`, `router` (register/navigate/current) `:402-406`, `panel` (open/close/current) `:407-419`, `tabs` `:420-440`, `model` (current/variant) `:441-454` — `p/tui/context.d.ts:396-457`.
- **Keymap**: `layer`, `dispatch`, `shortcuts`, `commands`, `pending`, `active`, `mode` — `p/tui/context.d.ts:375-395`; command shape (`palette`, `slash`, `bind`, `run`) `:323-349`; layer shape `:350-374`.
- **Data** (reactive): `on`/`listen` + `session` (list/get/root/family/cost/status/pending/message/permission/form), `project`, `shell`, `location.{vcs,agent,command,integration,mcp,model,provider,reference,skill}` — `p/tui/context.d.ts:33-111`.
- **Storage**: `store` (durable JSON, hot-reload-safe) + `memory` (ephemeral) — `p/tui/context.d.ts:6-22`.
- **Attention**: `notify()` `:271-273`. **Markdown**: `registerCodeBlockRenderer` `:468-470`.

### 4.3 Verdict

**V2 EXPOSES a TUI surface — PASS.** The V2 TUI `Context` is **richer** than the V1 `TuiPluginApi` object: it adds reactive data collections (`ctx.data`), durable/ephemeral storage (`ctx.storage`), a structured slot tree (`ctx.ui.slot`), dialogs/toasts/router/panel/tabs, a typed keymap layer system, attention notifications, and first-class Solid rendering (`@opentui/solid`, which V2 itself uses).

**Port = rewrite the binding layer** from the V1 `api`-object to the V2 `Context`:
- Slot claims: V1 `api.slots.register({order, slots:{…}})` → V2 `ctx.ui.slot({ render, append|prepend|before|after|replace })`.
- Keymap layers: V1 `api.keymap.registerLayer/intercept` → V2 `ctx.keymap.layer({commands, bindings, priority})`.
- Solid rendering: V1 `materialize(buildViewNodes(...), solid)` (imperative node tree) → V2 returns `JSX.Element` (declarative, `@opentui/solid`).

**Estimated port scale** (authored source, non-test):

| Area | Files | ~Lines | V2 slot / surface |
|---|---|---|---|
| `tui.ts` (module + sidebar polling) | 1 | 199 | `Plugin.define` + `ctx.ui.slot({replace|append: "sidebar.content"})` + `ctx.data` polling |
| `features/btw-side/tui-*` | 16 | ~2,050 | `ctx.keymap.layer`, `ctx.ui.slot({append:"prompt.footer"})`, `ctx.ui.dialog/toast`, `ctx.data.session`, `ctx.client.session` |
| `features/tui-sidebar/*` | 14 | ~1,190 | `ctx.ui.slot({append:"sidebar.content"})`, `ctx.data.{session,project,location}` |
| `features/native-edition-nudge` | 1 | ~small | `ctx.ui.toast` / `ctx.attention.notify` |

**Total TUI binding layer ≈ 3,400–3,600 lines** (excluding tests), concentrated in the slot/keymap/render adapters — a bounded rewrite, not a re-architecture. The domain logic (compute-view, derivers, roster-resolver, mirror-io, snapshot-builder) is largely reusable.

**OMC sidebar feature → V2 slot map**:

| OMC feature (V1 slot name) | V2 slot |
|---|---|
| Sidebar content (`sidebar_content`) | `sidebar.content` |
| Sidebar footer (if any) | `sidebar.footer` |
| BTW prompt decoration (`session_prompt` / `session_prompt_right`) | `prompt.footer` (+ `ctx.data.session` for state) — no direct 1:1; reimplemented as a `prompt.footer` claim |
| BTW slash command | `ctx.keymap.layer({commands:[{slash:{name:"btw"}}]})` |
| BTW palette command | `ctx.keymap.layer({commands:[{palette:true}]})` |
| BTW picker dialog | `ctx.ui.dialog.show(...)` |

---

## 5. `omo` CLI entry classification — NOT in port scope

- `bin/oh-my-opencode.js` = thin platform-detecting wrapper (platform + libc + AVX2 detection, `OH_MY_OPENCODE_FORCE_BASELINE=1`) that spawns the platform binary `oh-my-opencode-windows-x64` (a `bun --compile` of `packages/omo-native/compile-entry.ts` with embedded sidecars `senpi_pty` / `senpi_grep` / desktop engine — `script/build-omo-binary.ts`).
- **VERIFIED**: `compile-entry.ts` + the build scripts contain **ZERO** `@opencode-ai/*` imports. The `omo-native` runtime does **not** embed an OpenCode server fork.
- The OpenCode surface lives **entirely** in the plugin package: root `package.json` exports `./server` → `dist/index.js` and `./tui` → `dist/tui.js`, loaded **by the official OpenCode V1**; devDeps `@opencode-ai/plugin` + `@opencode-ai/sdk` 1.18.31.
- **Classification: `omo` CLI = NOT in port scope** (no `@opencode-ai/*` usage). Port scope = `packages/omo-opencode/src` (347 files).

> Note (honest nuance): `packages/omo-opencode/src/cli/run/*` **is** inside the plugin package and **does** use `@opencode-ai/sdk` (`createOpencode`, `createOpencodeClient`, `OpencodeClient`) — this is the plugin's *in-process* server-spawn/attach helper, not the `omo` native binary. It **is** in port scope and mapped in §2.2 (G6).

---

## 6. GO / NO-GO checkpoint — **GO**

**Verdict: GO.** No scope-changing GAP was found. Rationale:

1. **(a) Plugin API surface covered.** `@opencode/plugin@2.0.20` covers the V1 plugin surface including hooks (`ctx.tool.hook`, `ctx.session.hook`, `ctx.shell.hook`) and tools (`ctx.tool.transform` + `ctx.tool.list/reload`). V1 `Plugin()` → V2 `Plugin.define({id, setup(ctx)})` is a mechanical rewrite (G1).
2. **(b) TUI surface present and richer.** V2 exposes a first-class TUI `Context` (Solid-based) with slot tree, keymap layers, reactive data, storage, dialogs/toasts — §4.3 verdict PASS.
3. **(c) `omo` CLI untouched.** The native binary wrapper has zero `@opencode-ai/*` imports and does not fork/embed the OpenCode server (§5).
4. **(d) Bridge subpaths eliminable.** `@opencode-ai/sdk/v2` + `/v2/gen/client` are used in exactly **2 imports** (one file, `native-skills.ts`), replaced by a direct `@opencode/client` call (§2.5).

**Residual risks (honest):**

- **R1 — V1 hook names have no 1:1 V2 mapping** (G2–G5): `chat.params`, `chat.headers`, `chat.message`, `command.execute.before`, `experimental.chat.*.transform`, `experimental.session.compacting`. Each needs careful semantic remapping to V2 `session.*`/`tool.*`/`shell.*` hooks. The `experimental.chat.messages/system.transform` pair is the riskiest — V2 has no message/system-transform hook; must be validated against `session.context` (mutable `system`/`messages`) during task 10.
- **R2 — `command.execute.before`** may have no V2 hook at all; if it guards shell commands, `ctx.shell.hook("create.before")` is the candidate, else a documented drop.
- **R3 — event name/payload drift**: V1 `api.event.on("session.deleted", …)` and SDK `Event` payloads must be cross-checked against V2 `OpenCodeEvent` names/payloads at runtime (task 11 watch item), not assumed.
- **R4 — `session_prompt` / `session_prompt_right` slots have no V2 equivalent**; BTW prompt decoration must be rebuilt on `prompt.footer` + reactive `ctx.data.session`, which is the largest single TUI reimplementation.
- **R5 — raw key input** (`api.renderer._internalKeyInput`/`stdin`) has no V2 equivalent; BTW `ctrl+/` interception must be re-expressed as a targeted keymap layer. If the host does not deliver those key events to a layer, BTW picker keybinding may need a UX fallback.
- **R6 — `AgentConfig.prompt`→`system`** rename touches 28 agent files; mechanical but broad.

These are remap/reimplement risks within already-scoped parity work — none is scope-changing, so Wave 2 proceeds.

---

*End of body. See Appendix A for the complete file coverage manifest (347 files).*
## Appendix A — Complete file coverage manifest

Every file under `packages/omo-opencode/src` that references `@opencode-ai/` (N=347) is listed below, grouped by import specifier. These lists are the source-of-truth for the coverage cross-check (see `coverage-crosscheck.txt`).

### A.1 `@opencode-ai/plugin` (bare) — 253 files

- `__tests__/perf/plugin-init.test.ts`
- `__tests__/perf/plugin-init-team-mode-resume-defer.test.ts`
- `create-managers.monitor.test.ts`
- `create-managers.test.ts`
- `features/background-agent/atlas-subagent-fallback-retry.test.ts`
- `features/background-agent/cancel-task-cleanup.test.ts`
- `features/background-agent/constants.ts`
- `features/background-agent/manager.polling.session-status-unavailable.test.ts`
- `features/background-agent/manager.polling.test.ts`
- `features/background-agent/manager.test.ts`
- `features/background-agent/manager.ts`
- `features/background-agent/manager-circuit-breaker.test.ts`
- `features/background-agent/manager-continuation-marker.test.ts`
- `features/background-agent/manager-session-activity.test.ts`
- `features/background-agent/manager-session-permission.test.ts`
- `features/background-agent/opencode-client.ts`
- `features/background-agent/parent-wake-active-turn-event.test.ts`
- `features/background-agent/parent-wake-activity-window.test.ts`
- `features/background-agent/parent-wake-empty-turn-requeue.test.ts`
- `features/background-agent/parent-wake-live-read.test.ts`
- `features/background-agent/parent-wake-noreply-liveness.test.ts`
- `features/background-agent/parent-wake-part-event-regression.test.ts`
- `features/background-agent/session-created-callback.test.ts`
- `features/background-agent/subagent-failure-parent-isolation.test.ts`
- `features/background-agent/task-completion-cleanup.test.ts`
- `features/background-agent/task-history-cleanup.test.ts`
- `features/background-agent/task-removal-sync-attach.test.ts`
- `features/monitor/manager-internals.ts`
- `features/monitor/monitor-state-factory.ts`
- `features/task-toast-manager/manager.ts`
- `features/team-mode/team-runtime/create.test.ts`
- `features/tmux-subagent/manager.ts`
- `features/tmux-subagent/manager-cmux-eligibility.test.ts`
- `features/tmux-subagent/manager-project-directory.test.ts`
- `features/tmux-subagent/polling.ts`
- `features/tmux-subagent/session-created-handler.ts`
- `features/tmux-subagent/session-ready-waiter.ts`
- `hooks/agent-usage-reminder/hook.ts`
- `hooks/agent-usage-reminder/index.test.ts`
- `hooks/anthropic-context-window-limit-recovery/client.ts`
- `hooks/anthropic-context-window-limit-recovery/deduplication-recovery.ts`
- `hooks/anthropic-context-window-limit-recovery/message-builder.ts`
- `hooks/anthropic-context-window-limit-recovery/message-storage-directory.ts`
- `hooks/anthropic-context-window-limit-recovery/pruning-deduplication.ts`
- `hooks/anthropic-context-window-limit-recovery/pruning-tool-output-truncation.ts`
- `hooks/anthropic-context-window-limit-recovery/recovery-deduplication.test.ts`
- `hooks/anthropic-context-window-limit-recovery/recovery-hook.test-support.ts`
- `hooks/anthropic-context-window-limit-recovery/recovery-hook.ts`
- `hooks/anthropic-context-window-limit-recovery/storage/empty-text.ts`
- `hooks/anthropic-context-window-limit-recovery/storage/messages-reader.ts`
- `hooks/anthropic-context-window-limit-recovery/storage/parts-reader.ts`
- `hooks/anthropic-context-window-limit-recovery/storage/text-part-injector.ts`
- `hooks/anthropic-context-window-limit-recovery/target-token-truncation.ts`
- `hooks/anthropic-context-window-limit-recovery/tool-result-storage-sdk.ts`
- `hooks/atlas/atlas-hook.ts`
- `hooks/atlas/background-launch-session-tracking.ts`
- `hooks/atlas/background-task-retry.test.ts`
- `hooks/atlas/boulder-continuation-injector.test.ts`
- `hooks/atlas/boulder-continuation-injector.ts`
- `hooks/atlas/boulder-session-lineage.ts`
- `hooks/atlas/event-handler.ts`
- `hooks/atlas/idle-completion-nudge.ts`
- `hooks/atlas/idle-continuation.test.ts`
- `hooks/atlas/idle-continuation.ts`
- `hooks/atlas/idle-event.test.ts`
- `hooks/atlas/idle-event.ts`
- `hooks/atlas/idle-session-eligibility.ts`
- `hooks/atlas/recent-model-resolver.test.ts`
- `hooks/atlas/recent-model-resolver.ts`
- `hooks/atlas/resolve-active-boulder-session.ts`
- `hooks/atlas/subagent-completion-reminder.ts`
- `hooks/atlas/subagent-session-id.ts`
- `hooks/atlas/tool-execute-after.ts`
- `hooks/atlas/tool-execute-after-background-launch.test.ts`
- `hooks/atlas/tool-execute-after-direct-work.ts`
- `hooks/atlas/tool-execute-after-subagent-completion.test.ts`
- `hooks/atlas/tool-execute-after-subagent-completion.ts`
- `hooks/atlas/tool-execute-after-task-timers.test.ts`
- `hooks/atlas/tool-execute-before.ts`
- `hooks/auto-update-checker/hook.test.ts`
- `hooks/auto-update-checker/hook.ts`
- `hooks/auto-update-checker/hook/background-update-check.test.ts`
- `hooks/auto-update-checker/hook/background-update-check.ts`
- `hooks/auto-update-checker/hook/config-errors-toast.ts`
- `hooks/auto-update-checker/hook/connected-providers-status.ts`
- `hooks/auto-update-checker/hook/model-cache-warning.ts`
- `hooks/auto-update-checker/hook/spinner-toast.ts`
- `hooks/auto-update-checker/hook/startup-toasts.ts`
- `hooks/auto-update-checker/hook/update-toasts.ts`
- `hooks/bash-file-read-guard.ts`
- `hooks/category-skill-reminder/hook.ts`
- `hooks/claude-code-hooks/claude-code-hooks-hook.ts`
- `hooks/claude-code-hooks/handlers/chat-message-handler.ts`
- `hooks/claude-code-hooks/handlers/pre-compact-handler.ts`
- `hooks/claude-code-hooks/handlers/session-event-handler.ts`
- `hooks/claude-code-hooks/handlers/tool-execute-after-handler.ts`
- `hooks/claude-code-hooks/handlers/tool-execute-before-handler.ts`
- `hooks/compaction-todo-preserver/hook.ts`
- `hooks/compaction-todo-preserver/index.test.ts`
- `hooks/delegate-task-retry/hook.ts`
- `hooks/directory-agents-injector/hook.ts`
- `hooks/directory-readme-injector/hook.ts`
- `hooks/directory-readme-injector/injector.test.ts`
- `hooks/directory-readme-injector/injector.ts`
- `hooks/edit-error-recovery/hook.ts`
- `hooks/empty-task-response-detector.ts`
- `hooks/goal/index.test.ts`
- `hooks/goal/index.ts`
- `hooks/hashline-read-enhancer/hook.ts`
- `hooks/hashline-read-enhancer/index.test.ts`
- `hooks/hephaestus-agents-md-injector/hook.ts`
- `hooks/interactive-bash-session/hook.ts`
- `hooks/json-error-recovery/hook.ts`
- `hooks/json-error-recovery/index.test.ts`
- `hooks/keyword-detector/hook.ts`
- `hooks/keyword-detector/hyperplan.test.ts`
- `hooks/keyword-detector/hyperplan-ultrawork.test.ts`
- `hooks/keyword-detector/index.test.ts`
- `hooks/keyword-detector/ultrawork-edge-trigger.test.ts`
- `hooks/keyword-detector/ultrawork-followup.test.ts`
- `hooks/legacy-plugin-toast/hook.ts`
- `hooks/native-edition-nudge/hook.ts`
- `hooks/no-hephaestus-non-gpt/hook.ts`
- `hooks/non-interactive-env/non-interactive-env-hook.ts`
- `hooks/no-sisyphus-gpt/hook.ts`
- `hooks/no-sisyphus-gpt/index.test.ts`
- `hooks/notepad-write-guard/index.ts`
- `hooks/plan-format-validator/hook.test.ts`
- `hooks/plan-format-validator/hook.ts`
- `hooks/prometheus-md-only/agent-resolution.ts`
- `hooks/prometheus-md-only/hook.ts`
- `hooks/ralph-loop/catch-fallbacks.test.ts`
- `hooks/ralph-loop/completion-handler.ts`
- `hooks/ralph-loop/completion-promise-detector.ts`
- `hooks/ralph-loop/completion-promise-detector-test-input.test.ts`
- `hooks/ralph-loop/continuation-prompt-injector.ts`
- `hooks/ralph-loop/continuation-prompt-injector-agent-resolution.test.ts`
- `hooks/ralph-loop/event-handler-activity.ts`
- `hooks/ralph-loop/event-handler-completion.ts`
- `hooks/ralph-loop/event-handler-continuation.ts`
- `hooks/ralph-loop/event-handler-feedback.test.ts`
- `hooks/ralph-loop/event-handler-feedback.ts`
- `hooks/ralph-loop/event-handler-idle.ts`
- `hooks/ralph-loop/event-handler-impl.ts`
- `hooks/ralph-loop/event-handler-runtime-error.ts`
- `hooks/ralph-loop/index.test.ts`
- `hooks/ralph-loop/iteration-continuation.ts`
- `hooks/ralph-loop/no-progress-turn-detector.ts`
- `hooks/ralph-loop/pending-verification-handler.ts`
- `hooks/ralph-loop/ralph-loop-event-handler.ts`
- `hooks/ralph-loop/ralph-loop-hook.ts`
- `hooks/ralph-loop/session-reset-strategy.ts`
- `hooks/ralph-loop/stuck-oracle-dispatch-recovery.test.ts`
- `hooks/ralph-loop/verification-failure-handler.ts`
- `hooks/read-image-resizer/hook.test.ts`
- `hooks/read-image-resizer/hook.ts`
- `hooks/rules-injector/hook.ts`
- `hooks/session-notification.ts`
- `hooks/session-notification-desktop-sidecar.test.ts`
- `hooks/session-notification-linux.ts`
- `hooks/session-notification-macos.ts`
- `hooks/session-notification-runner.ts`
- `hooks/session-notification-scheduler.ts`
- `hooks/session-notification-send.ts`
- `hooks/session-notification-sender.test.ts`
- `hooks/session-notification-sound.ts`
- `hooks/session-notification-windows.ts`
- `hooks/session-todo-status.ts`
- `hooks/sisyphus-junior-notepad/hook.ts`
- `hooks/stop-continuation-guard/hook.ts`
- `hooks/stop-continuation-guard/index.test.ts`
- `hooks/task-reminder/hook.ts`
- `hooks/task-reminder/index.test.ts`
- `hooks/team-tool-gating/hook.test.ts`
- `hooks/team-tool-gating/hook.ts`
- `hooks/todo-continuation-enforcer/continuation-injection.ts`
- `hooks/todo-continuation-enforcer/continuation-injection-agent-resolution.test.ts`
- `hooks/todo-continuation-enforcer/countdown.ts`
- `hooks/todo-continuation-enforcer/handler.ts`
- `hooks/todo-continuation-enforcer/idle-event.ts`
- `hooks/todo-continuation-enforcer/index.ts`
- `hooks/todo-continuation-enforcer/opencode-overload-continuation.test.ts`
- `hooks/todo-continuation-enforcer/resolve-message-info.ts`
- `hooks/tool-output-truncator.ts`
- `hooks/ulw-execute/context-info-builder.ts`
- `hooks/ulw-execute/session-plan-affinity.ts`
- `hooks/ulw-execute/ulw-execute-hook.ts`
- `hooks/webfetch-redirect-guard/hook.ts`
- `hooks/write-existing-file-guard/hook.ts`
- `hooks/write-existing-file-guard/tool-execute-before-handler.ts`
- `hooks/zauc-mocks-bg/background-update-check.test.ts`
- `hooks/zauc-mocks-ws/workspace-resolution.test.ts`
- `index.ts`
- `plugin/build-team-idle-wake-hint-client.ts`
- `plugin/event.test.ts`
- `plugin/event.ts`
- `plugin/normalize-tool-arg-schemas.test.ts`
- `plugin/normalize-tool-arg-schemas.ts`
- `plugin/session-compacting.ts`
- `plugin/tool-registry.monitor.test.ts`
- `plugin/tool-registry.team-mode.test.ts`
- `plugin/tool-registry.test.ts`
- `plugin/tool-registry-core-tools.test.ts`
- `plugin/tool-registry-core-tools.ts`
- `plugin/tool-registry-gated-tools.ts`
- `plugin/tool-registry-team-tools.ts`
- `plugin/types.ts`
- `plugin-interface.test.ts`
- `shared/context-window-usage.ts`
- `shared/disabled-tools.ts`
- `shared/dynamic-truncator.ts`
- `shared/dynamic-truncator-types.ts`
- `shared/model-availability.ts`
- `shared/session-route.ts`
- `shared/session-utils.ts`
- `testing/create-plugin-module.ts`
- `tools/background-task/create-background-cancel.ts`
- `tools/background-task/create-background-output.ts`
- `tools/background-task/create-background-task.metadata.test.ts`
- `tools/background-task/create-background-task.test.ts`
- `tools/background-task/create-background-task.ts`
- `tools/call-omo-agent/agent-resolver.ts`
- `tools/call-omo-agent/background-executor.test.ts`
- `tools/call-omo-agent/background-executor.ts`
- `tools/call-omo-agent/completion-poller.ts`
- `tools/call-omo-agent/message-processor.ts`
- `tools/call-omo-agent/session-creator.ts`
- `tools/call-omo-agent/subagent-session-creator.ts`
- `tools/call-omo-agent/sync-executor.ts`
- `tools/call-omo-agent/tools.ts`
- `tools/delegate-task/tools.ts`
- `tools/glob/tools.ts`
- `tools/grep/tools.ts`
- `tools/index.ts`
- `tools/look-at/look-at-session-runner.ts`
- `tools/look-at/multimodal-agent-metadata.test.ts`
- `tools/look-at/multimodal-agent-metadata.ts`
- `tools/look-at/tools.ts`
- `tools/monitor/create-monitor-tools.ts`
- `tools/monitor/monitor-output.ts`
- `tools/monitor/monitor-start.ts`
- `tools/monitor/monitor-stop.ts`
- `tools/session-manager/sdk-storage.ts`
- `tools/session-manager/storage.ts`
- `tools/session-manager/tools.test.ts`
- `tools/session-manager/tools.ts`
- `tools/skill/tools.ts`
- `tools/skill-mcp/tools.ts`
- `tools/task/task-create.ts`
- `tools/task/task-lock-concurrency.test.ts`
- `tools/task/task-update.ts`
- `tools/task/todo-sync.test.ts`
- `tools/task/todo-sync.ts`

### A.2 `@opencode-ai/sdk` (bare) — 53 files

- `__tests__/perf/plugin-init.test.ts`
- `agents/agent-builder.ts`
- `agents/agent-identity.test.ts`
- `agents/agent-skill-resolution.ts`
- `agents/atlas/agent.ts`
- `agents/builtin-agents.ts`
- `agents/builtin-agents/agent-overrides.test.ts`
- `agents/builtin-agents/agent-overrides.ts`
- `agents/builtin-agents/atlas-agent.ts`
- `agents/builtin-agents/environment-context.ts`
- `agents/builtin-agents/general-agents.ts`
- `agents/builtin-agents/hephaestus-agent.ts`
- `agents/builtin-agents/sisyphus-agent.ts`
- `agents/explore.ts`
- `agents/frontier-tool-schema-guard.ts`
- `agents/hephaestus/agent.ts`
- `agents/librarian.ts`
- `agents/metis.ts`
- `agents/momus.ts`
- `agents/multimodal-looker.ts`
- `agents/oracle.ts`
- `agents/sisyphus-agent-config.ts`
- `agents/sisyphus-agent-factory.ts`
- `agents/sisyphus-junior/agent.ts`
- `agents/types.ts`
- `agents/utils.test.ts`
- `cli/run/agent-profile-colors.ts`
- `cli/run/server-connection.ts`
- `cli/run/types.ts`
- `features/background-agent/parent-wake-active-defer-ceiling.test.ts`
- `features/background-agent/parent-wake-active-turn-event.test.ts`
- `features/btw-side/context-injector.ts`
- `features/btw-side/parent-context-budget.ts`
- `features/context-injector/injector.ts`
- `hooks/atlas/final-wave-approval-gate.test-support.ts`
- `hooks/atlas/index.test.ts`
- `hooks/atlas/tool-execute-after-background-launch.test.ts`
- `hooks/atlas/tool-execute-after-task-timers.test.ts`
- `hooks/category-skill-reminder/hook.ts`
- `hooks/category-skill-reminder/index.test.ts`
- `hooks/compaction-todo-preserver/index.test.ts`
- `hooks/todo-continuation-enforcer/opencode-overload-continuation.test.ts`
- `hooks/tool-pair-validator/types.ts`
- `plugin/event-types.ts`
- `plugin/messages-transform.ts`
- `plugin/messages-transform-prefill-alias.test.ts`
- `plugin-handlers/agent-config-assembly.ts`
- `plugin-handlers/agent-config-handler.test.ts`
- `plugin-handlers/agent-config-handler-agents-skills.test.ts`
- `shared/live-server-route.ts`
- `shared/model-suggestion-retry.ts`
- `tools/delegate-task/types.ts`
- `tools/look-at/session-poller.ts`

### A.3 `@opencode-ai/plugin/tool` — 45 files

- `features/team-mode/tools/lifecycle.test.ts`
- `features/team-mode/tools/lifecycle-create-tool.ts`
- `features/team-mode/tools/lifecycle-inline-spec.test.ts`
- `features/team-mode/tools/lifecycle-shutdown-tools.ts`
- `features/team-mode/tools/lifecycle-test-fixture.ts`
- `features/team-mode/tools/messaging.test.ts`
- `features/team-mode/tools/messaging.ts`
- `features/team-mode/tools/messaging-missing-session.test.ts`
- `features/team-mode/tools/query.test.ts`
- `features/team-mode/tools/query.ts`
- `features/team-mode/tools/tasks.test.ts`
- `features/team-mode/tools/tasks.ts`
- `hooks/goal/tools.ts`
- `plugin/skill-context-shared-skill.test.ts`
- `tools/background-task/create-background-output.blocking.test.ts`
- `tools/background-task/create-background-output.metadata.test.ts`
- `tools/background-task/create-background-output.undo.test.ts`
- `tools/background-task/create-background-task.metadata.test.ts`
- `tools/background-task/tools.test.ts`
- `tools/glob/tools.ts`
- `tools/grep/tools.ts`
- `tools/hashline-edit/hashline-edit-executor.ts`
- `tools/hashline-edit/tools.test.ts`
- `tools/hashline-edit/tools.ts`
- `tools/interactive-bash/tools.ts`
- `tools/look-at/look-at-session-runner.ts`
- `tools/look-at/tools.test.ts`
- `tools/monitor/monitor-list.test.ts`
- `tools/monitor/monitor-list.ts`
- `tools/monitor/monitor-output.test.ts`
- `tools/monitor/monitor-start.test.ts`
- `tools/monitor/monitor-stop.test.ts`
- `tools/session-manager/tools.test.ts`
- `tools/session-manager/tools.ts`
- `tools/skill/runtime-native-routing.test.ts`
- `tools/skill/tools.factory.test.ts`
- `tools/skill/tools.ts`
- `tools/skill/zauc-mocks-skill-tools/agent-restriction.test.ts`
- `tools/skill/zauc-mocks-skill-tools/test-support.ts`
- `tools/skill-mcp/tools.test.ts`
- `tools/skill-mcp/tools.ts`
- `tools/task/task-create.ts`
- `tools/task/task-get.ts`
- `tools/task/task-list.ts`
- `tools/task/task-update.ts`

### A.4 `@opencode-ai/plugin/tui` — 6 files

- `features/btw-side/tui-keymap.ts`
- `features/btw-side/tui-picker.ts`
- `features/btw-side/tui-session-bridge.ts`
- `features/btw-side/tui-wiring.ts`
- `tui.test.ts`
- `tui.ts`

### A.5 Bridge subpaths (must be eliminated) — 1 file each

- `plugin/native-skills.ts` (`@opencode-ai/sdk/v2` + `@opencode-ai/sdk/v2/gen/client`)

### A.6 Non-`from` references (string / comment / type-query only) — 6 files

- `config-migration/config-migration-export.test.ts`
- `dependency-security.test.ts`
- `hooks/tool-pair-validator/hook.test-support.ts`
- `shared/opencode-coupling-audit.test.ts`
- `tools/call-omo-agent/tools.test.ts`
- `tools/call-omo-agent/tools-edge-cases.test.ts`

