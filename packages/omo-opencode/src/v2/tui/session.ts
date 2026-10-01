import type { Plugin } from "@opencode/plugin/tui"
import type { JsonValue, SessionMessageInfo } from "@opencode/client"

import type {
  BtwSessionMessage,
  BtwSideControllerDependencies,
} from "../../features/btw-side/tui-controller-types"

/**
 * [OMC] v2 TUI session bridge (task 15).
 *
 * Ports `features/btw-side/tui-session-bridge.ts` from the V1 `TuiPluginApi`
 * object to the V2 `Plugin.Context`:
 *
 *   - `api.route.current` / `api.route.navigate("session", {...})`
 *     → `ctx.ui.router.current()` / `ctx.ui.router.navigate({ type:
 *       "session", sessionID })`.
 *   - `api.state.session.*` (status/permission/question/messages)
 *     → `ctx.data.session.*` (status/permission/message; `question` has no V2
 *       equivalent and is mapped to the closest `form` collection).
 *   - `api.client.session.*` (get/list/create/abort/delete, `{data, error}`
 *     wrapper + `directory` param) → `ctx.client.session.*` (V2 throws on
 *     error and takes no `directory` param).
 */

/** V1 `api.state.path.directory` → V2 `ctx.location` is optional. */
export function tuiDirectory(ctx: Plugin.Context): string | undefined {
  return ctx.location?.directory
}

export function currentTuiSessionID(ctx: Plugin.Context): string | undefined {
  const route = ctx.ui.router.current()
  return route.type === "session" ? route.sessionID : undefined
}

export function isCurrentTuiSession(
  ctx: Plugin.Context,
  sessionID: string | undefined,
): boolean {
  return currentTuiSessionID(ctx) === sessionID
}

export function parentTuiStatusLabel(
  ctx: Plugin.Context,
  parentSessionID: string,
): string {
  const permissions = ctx.data.session.permission.list(parentSessionID)
  if (permissions !== undefined && permissions.length > 0) {
    return "main needs permission"
  }
  const forms = ctx.data.session.form.list(parentSessionID)
  if (forms !== undefined && forms.length > 0) {
    return "main needs input"
  }
  return ctx.data.session.status(parentSessionID) === "running"
    ? "main working"
    : "main ready"
}

/**
 * V1 `Record<string, unknown>` metadata is always JSON in the BTW flow
 * (`createBtwSideMetadata` output); coerce it to the V2 `JsonValue` map
 * honestly via a JSON round-trip (no lossy casts).
 */
function toJsonMetadata(metadata: Record<string, unknown>): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(metadata))
}

function toBtwMessage(message: SessionMessageInfo): BtwSessionMessage | undefined {
  if (message.type === "user") {
    return { info: { id: message.id, role: "user" } }
  }
  if (message.type === "assistant") {
    return {
      info: {
        id: message.id,
        role: "assistant",
        ...(message.time.completed !== undefined
          ? { time: { completed: message.time.completed } }
          : {}),
      },
    }
  }
  return undefined
}

export function createBtwControllerDependencies(
  ctx: Plugin.Context,
): BtwSideControllerDependencies {
  return {
    getCurrentSessionID: () => currentTuiSessionID(ctx),
    getSession: (sessionID) => {
      const session = ctx.data.session.get(sessionID)
      if (!session) return undefined
      return {
        id: session.id,
        title: session.title ?? "",
        ...(session.agent !== undefined ? { agent: session.agent } : {}),
        ...(session.model !== undefined
          ? {
              model: {
                providerID: session.model.providerID,
                id: session.model.id,
              },
            }
          : {}),
      }
    },
    getMessages: (sessionID) =>
      ctx.data.session.message.list(sessionID).flatMap((message) => {
        const mapped = toBtwMessage(message as never)
        return mapped === undefined ? [] : [mapped]
      }),
    createSession: async (input) => {
      const session = await ctx.client.session.create({
        title: input.title,
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
        ...(input.model !== undefined
          ? { model: { id: input.model.id, providerID: input.model.providerID } }
          : {}),
        metadata: toJsonMetadata(input.metadata),
      })
      return { id: session.id, title: session.title ?? "" }
    },
    navigateSession: (sessionID) => {
      ctx.ui.router.navigate({ type: "session", sessionID })
    },
    abortSession: async (sessionID) => {
      await ctx.client.session.interrupt({ sessionID })
    },
    deleteSession: async (sessionID) => {
      await ctx.client.session.remove({ sessionID })
    },
    showToast: (message) => {
      ctx.ui.toast.show({ variant: "warning", message })
    },
    requestRender: () => ctx.renderer.requestRender(),
  }
}
