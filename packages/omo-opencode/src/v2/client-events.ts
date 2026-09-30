/**
 * [OMC] v2 client events — event name catalog + V1→V2 mapping (task 11).
 *
 * This file is the single source of truth for the cross-check of event names
 * between the V1 SDK event stream (`Event` type) and the V2
 * `@opencode/client` event stream (`OpenCodeEvent` / `V2Event`).
 *
 * Every V2 name below was read from the installed 2.0.20 `.d.ts`
 * (`@opencode/client/dist/promise/generated/types.d.ts`, `V2Event` union and
 * each member's literal `type` discriminant), NOT guessed. The V1 side was
 * read from the OMC source event handlers (`src/cli/run/event-*.ts`) and
 * `src/features/btw-side/tui-wiring.ts`.
 */

/**
 * Complete catalog of `type` discriminants emitted by the V2 server on the
 * shared event stream (the `V2Event` union). `rpc.*` is a template-literal
 * wildcard (`V2EventRpc`) and is documented separately below.
 */
export const V2_EVENT_NAMES = [
  "server.connected",
  "location.shutdown",
  "models-dev.refreshed",
  "credential.updated",
  "credential.switched",
  "integration.updated",
  "provider.updated",
  "model.updated",
  "agent.updated",
  "session.created",
  "session.agent.selected",
  "session.model.selected",
  "session.moved",
  "session.renamed",
  "session.metadata.updated",
  "session.permissions",
  "session.viewed",
  "session.usage.updated",
  "session.deleted",
  "session.forked",
  "session.inbox.delivered",
  "session.inbox.enqueued",
  "session.inbox.cancelled",
  "session.inbox.delivery.changed",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.instructions.updated",
  "session.synthetic",
  "session.skill.activated",
  "session.shell.started",
  "session.shell.ended",
  "session.step.started",
  "session.step.streamed",
  "session.step.ended",
  "session.step.failed",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.delta",
  "session.reasoning.ended",
  "session.tool.input.started",
  "session.tool.input.delta",
  "session.tool.input.ended",
  "session.tool.called",
  "session.tool.progress",
  "session.tool.success",
  "session.tool.failed",
  "session.retry.scheduled",
  "session.compaction.started",
  "session.compaction.delta",
  "session.compaction.ended",
  "session.compaction.failed",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
  "session.usage.recorded",
  "session.message.content.updated",
  "session.status",
  "session.idle",
  "filesystem.changed",
  "reference.updated",
  "permission.asked",
  "permission.replied",
  "plugin.updated",
  "project.updated",
  "worktree.updated",
  "worktree.resolved",
  "command.updated",
  "config.updated",
  "skill.updated",
  "pty.created",
  "pty.updated",
  "pty.exited",
  "pty.deleted",
  "persistent-pty.added",
  "persistent-pty.removed",
  "shell.created",
  "shell.exited",
  "shell.deleted",
  "form.created",
  "form.replied",
  "form.cancelled",
  "websearch.updated",
  "tui.prompt.append",
  "tui.command.execute",
  "tui.toast.show",
  "tui.session.select",
  "installation.updated",
  "installation.update-available",
  "vcs.branch.updated",
  "mcp.status.changed",
  "mcp.resources.changed",
] as const

/** The wildcard `rpc.*` event namespace (`V2EventRpc`), separate from the fixed catalog. */
export const V2_EVENT_RPC_WILDCARD = "rpc." as const

export type V2EventName = (typeof V2_EVENT_NAMES)[number]

const V2_EVENT_NAME_SET = new Set<string>(V2_EVENT_NAMES)

/** Type guard: is `name` a fixed V2 event `type` discriminant? */
export function isV2EventName(name: string): name is V2EventName {
  return V2_EVENT_NAME_SET.has(name)
}

/**
 * The V1 event names OMC actually consumes, sourced from:
 * - `src/cli/run/event-session-handlers.ts`   ("session.idle", "session.status", "session.error")
 * - `src/cli/run/event-message-handlers.ts`   ("message.updated", "message.part.updated", "message.part.delta")
 * - `src/cli/run/event-tool-handlers.ts`      ("tool.execute", "tool.result")
 * - `src/cli/run/event-toast-handlers.ts`     ("tui.toast.show")
 * - `src/features/btw-side/tui-wiring.ts`     ("session.deleted")
 */
export type V1EventName =
  | "session.idle"
  | "session.status"
  | "session.error"
  | "session.deleted"
  | "message.updated"
  | "message.part.updated"
  | "message.part.delta"
  | "tool.execute"
  | "tool.result"
  | "tui.toast.show"

/**
 * V1 → V2 event name mapping with drift classification.
 *
 * `kind`:
 * - "exact"   — same `type` string in V1 and V2 (payload still needs re-check).
 * - "renamed" — same intent, different name.
 * - "split"   — one V1 event decomposed into several V2 events (payload shape
 *               also changed; a V1 handler typically maps to a *set* of V2
 *               events, not a 1:1 name).
 */
export type V1ToV2EventEntry = {
  readonly v1: V1EventName
  readonly v2: readonly string[]
  readonly kind: "exact" | "renamed" | "split"
}

export const V1_TO_V2_EVENT: readonly V1ToV2EventEntry[] = [
  { v1: "session.idle", v2: ["session.idle"], kind: "exact" },
  { v1: "session.status", v2: ["session.status"], kind: "exact" },
  { v1: "session.error", v2: ["session.execution.failed", "session.step.failed"], kind: "renamed" },
  { v1: "session.deleted", v2: ["session.deleted"], kind: "exact" },
  { v1: "message.updated", v2: ["session.message.content.updated"], kind: "renamed" },
  {
    v1: "message.part.updated",
    v2: ["session.message.content.updated", "session.text.delta", "session.reasoning.delta", "session.tool.input.delta"],
    kind: "split",
  },
  {
    v1: "message.part.delta",
    v2: ["session.text.delta", "session.reasoning.delta", "session.tool.input.delta"],
    kind: "split",
  },
  { v1: "tool.execute", v2: ["session.tool.called"], kind: "renamed" },
  { v1: "tool.result", v2: ["session.tool.success", "session.tool.failed"], kind: "split" },
  { v1: "tui.toast.show", v2: ["tui.toast.show"], kind: "exact" },
]

/** Map a V1 event name to its V2 equivalents (empty array = unmapped). */
export function mapV1EventToV2(v1: V1EventName): readonly string[] {
  const entry = V1_TO_V2_EVENT.find((e) => e.v1 === v1)
  return entry ? entry.v2 : []
}
