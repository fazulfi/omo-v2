/**
 * [OMC] v2 orchestration — background tasks + todo continuation (task 13).
 *
 * Ports the core OMC V1 orchestration semantics onto the V2 client layer
 * (task 11, `./client`):
 *
 *   - Background task manager: spawn → `bg_...` ID, collect output, cancel
 *     (single + `all=true`), terminal-status lifecycle
 *     `pending → running → completed|error|cancelled|interrupt`.
 *   - Todo read/write roundtrip for continuation.
 *
 * V1 → V2 mapping (source of truth: docs/v2-api-mapping.md §2.2):
 *
 *   BackgroundTask statuses / `bg_${uuid}` ID        → identical (parity)
 *   manager.launch()    (create child session + prompt) → `client.session.create`
 *                                                           + `client.session.prompt`
 *   manager.cancelTask() (abort child session)          → `client.session.interrupt`
 *   background_output (read child session messages)     → `client.message.list`
 *   task-registry (in-memory global)                    → `BackgroundTaskRegistry` below
 *   Todo read  `ctx.client.session.todo({path:{id}})`   → `client.session.get().metadata`
 *   Todo write `Todo.update({sessionID, todos})` (GAP)  → `client.session.update().metadata`
 *
 * Gap notes (honest):
 *   - V2 exposes **no** native `session.todo` API (grep of the 2.0.20 client
 *     `types.d.ts` for "todo" returns nothing). OMC V1 read/wrote todos via the
 *     V1-only `opencode/session/todo` module. The roundtrip parity is preserved
 *     by persisting the `TodoInfo[]` shape under a reserved session-metadata key
 *     (`omc.todos`) through `session.get`/`session.update` — a verified V2 path.
 *   - Terminal detection: V1 used `session.status`/`session.idle`/`session.error`;
 *     V2 emits `session.execution.succeeded|failed|interrupted` (see
 *     `./client-events.ts`), consumed here via `subscribeEvents`.
 */

import { Plugin } from "@opencode/plugin"
import { z } from "zod"
import type {
  OpenCodeClient,
  OpenCodeEvent,
  SessionMessageAssistant,
  SessionMessageInfo,
} from "@opencode/client"
import { createClientFromEndpoint, discoverService, subscribeEvents } from "./client"

type PluginContext = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]

// ---------------------------------------------------------------------------
// Types (parity subset of V1 `features/background-agent/types.ts` +
// `tools/task/todo-sync.ts`)
// ---------------------------------------------------------------------------

export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "interrupt"

export interface BackgroundTask {
  readonly id: string
  sessionId?: string
  readonly parentSessionId: string
  readonly description: string
  /** Redacted in the registry copy (parity with V1 `cloneRegisteredTask`). */
  readonly prompt: string
  readonly agent: string
  status: BackgroundTaskStatus
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

export interface LaunchInput {
  readonly description: string
  readonly prompt: string
  readonly agent: string
  readonly parentSessionId: string
  readonly parentAgent?: string
}

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

export interface TodoInfo {
  readonly id?: string
  readonly content: string
  readonly status: TodoStatus
  readonly priority?: "low" | "medium" | "high"
}

const TERMINAL_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  "completed",
  "error",
  "cancelled",
  "interrupt",
])

/** Reserved session-metadata key under which `TodoInfo[]` is persisted. */
const TODO_METADATA_KEY = "omc.todos"

// ---------------------------------------------------------------------------
// In-memory task registry (parity: V1 `task-registry.ts`)
// ---------------------------------------------------------------------------

interface BackgroundTaskRegistry {
  readonly active: Map<string, BackgroundTask>
  readonly completed: Map<string, BackgroundTask>
}

const MAX_COMPLETED_TASKS = 100
const REGISTRY_GLOBAL_KEY = "__omoV2BackgroundTaskRegistry"

function getRegistry(): BackgroundTaskRegistry {
  const globalThisWithRegistry = globalThis as typeof globalThis & {
    [REGISTRY_GLOBAL_KEY]?: BackgroundTaskRegistry
  }
  globalThisWithRegistry[REGISTRY_GLOBAL_KEY] ??= {
    active: new Map<string, BackgroundTask>(),
    completed: new Map<string, BackgroundTask>(),
  }
  return globalThisWithRegistry[REGISTRY_GLOBAL_KEY]!
}

function redactTask(task: BackgroundTask): BackgroundTask {
  return { ...task, prompt: "[redacted]" }
}

function rememberBackgroundTask(task: BackgroundTask): void {
  const registry = getRegistry()
  registry.completed.delete(task.id)
  registry.active.set(task.id, redactTask(task))
}

function archiveBackgroundTask(task: BackgroundTask): void {
  const registry = getRegistry()
  registry.active.delete(task.id)
  registry.completed.delete(task.id)
  if (!task.sessionId || !TERMINAL_STATUSES.has(task.status)) return
  registry.completed.set(task.id, redactTask(task))
  while (registry.completed.size > MAX_COMPLETED_TASKS) {
    const oldest = registry.completed.keys().next().value
    if (typeof oldest !== "string") return
    registry.completed.delete(oldest)
  }
}

function forgetBackgroundTask(taskId: string): void {
  const registry = getRegistry()
  registry.active.delete(taskId)
  registry.completed.delete(taskId)
}

function getRegisteredBackgroundTask(taskId: string): BackgroundTask | undefined {
  const registry = getRegistry()
  return registry.active.get(taskId) ?? registry.completed.get(taskId)
}

function findTaskBySessionId(sessionId: string): BackgroundTask | undefined {
  const registry = getRegistry()
  for (const task of registry.active.values()) {
    if (task.sessionId === sessionId) return task
  }
  return undefined
}

function listDescendantTasks(parentSessionId: string): BackgroundTask[] {
  const registry = getRegistry()
  return [...registry.active.values()].filter((task) => task.parentSessionId === parentSessionId)
}

// ---------------------------------------------------------------------------
// Diagnostics (activity log surfaced via the `omo.orch` RPC for runtime proof)
// ---------------------------------------------------------------------------

interface OrchActivity {
  readonly at: string
  readonly kind: string
  readonly detail: string
}

const activityLog: OrchActivity[] = []

function recordActivity(kind: string, detail: string): void {
  activityLog.push({ at: new Date().toISOString(), kind, detail })
  if (activityLog.length > 200) activityLog.shift()
}

// ---------------------------------------------------------------------------
// Task lifecycle (spawn / collect / cancel) — on top of the V2 client
// ---------------------------------------------------------------------------

function newTaskId(): string {
  return `bg_${crypto.randomUUID().slice(0, 8)}`
}

function isSessionId(value: string): boolean {
  return /^ses[_-]/.test(value)
}

function isBackgroundTaskId(value: string): boolean {
  return /^bg[_-]/.test(value)
}

function extractSessionIdFromEvent(event: OpenCodeEvent): string | undefined {
  const data = (event as { data?: unknown }).data
  if (data && typeof data === "object" && "sessionID" in data) {
    const sessionID = (data as { sessionID?: unknown }).sessionID
    if (typeof sessionID === "string") return sessionID
  }
  return undefined
}

/**
 * Launches a background task: creates a child session bound to `agent`, then
 * enqueues the prompt (steer delivery). Returns the registered task. On any
 * synchronous create/prompt failure the task is recorded as `error` (parity:
 * V1 fail-closed — no silent swallow, no hang).
 */
async function launchBackgroundTask(
  client: OpenCodeClient,
  input: LaunchInput,
  directory: string,
): Promise<BackgroundTask> {
  const task: BackgroundTask = {
    id: newTaskId(),
    parentSessionId: input.parentSessionId,
    description: input.description,
    prompt: input.prompt,
    agent: input.agent,
    status: "pending",
    startedAt: Date.now(),
  }
  rememberBackgroundTask(task)

  try {
    const session = await client.session.create({
      agent: input.agent,
      title: input.description,
      location: { directory },
      metadata: { parentSessionId: input.parentSessionId },
    })
    task.sessionId = session.id
    task.status = "running"
    rememberBackgroundTask(task)
    recordActivity("task-running", `${task.id}:${session.id}`)

    await client.session.prompt({
      sessionID: session.id,
      text: input.prompt,
      delivery: "steer",
    })
    recordActivity("task-prompted", task.id)
  } catch (error) {
    task.status = "error"
    task.error = error instanceof Error ? error.message : String(error)
    task.completedAt = Date.now()
    recordActivity("task-error", `${task.id}:${task.error ?? ""}`)
    archiveBackgroundTask(task)
  }

  return task
}

/** Extracts the final assistant text from a list of session messages. */
function extractAssistantText(messages: SessionMessageInfo[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== "assistant") continue
    const assistant = message as SessionMessageAssistant
    const textParts = assistant.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0)
    if (textParts.length > 0) return textParts.join("\n")
  }
  return ""
}

function formatTaskLaunchResult(task: BackgroundTask): string {
  return `Background task launched successfully.

Task ID: ${task.id}
Session ID: ${task.sessionId ?? "(not yet assigned)"}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Do NOT call background_output now. Wait for <system-reminder> notification first. The system will deliver the result when the task completes; you do not need to poll for it.`
}

function formatTaskNotFound(taskId: string): string {
  if (!isSessionId(taskId)) return `Task not found: ${taskId}`
  return `Task not found: ${taskId}

background_output expects a background task ID such as \`bg_...\`, not a session ID.
Use the \`background_task_id\` / \`Background Task ID\` from the task launch output or completion notification.`
}

/**
 * Collects output for a background task. Reads the child session messages via
 * `client.message.list` and returns the final assistant text (or the
 * status/error for terminal non-completed states).
 */
async function collectBackgroundOutput(
  client: OpenCodeClient,
  taskId: string,
): Promise<string> {
  const task = getRegisteredBackgroundTask(taskId)
  if (!task) return formatTaskNotFound(taskId)

  if (task.status === "completed") {
    if (!task.sessionId) return formatTaskStatus(task)
    try {
      const response = await client.message.list({ sessionID: task.sessionId, order: "asc" })
      const text = extractAssistantText(response.data)
      return text.length > 0 ? text : formatTaskStatus(task)
    } catch (error) {
      return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (task.status === "error") {
    return formatTaskStatus(task)
  }

  if (task.status === "cancelled" || task.status === "interrupt") {
    return formatTaskStatus(task)
  }

  return formatTaskStatus(task)
}

function formatTaskStatus(task: BackgroundTask): string {
  switch (task.status) {
    case "completed":
      return `Task completed successfully

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}`
    case "error":
      return `Task failed

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}
${task.error ? `Error: ${task.error}` : ""}`
    case "cancelled":
      return `Task cancelled

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}`
    case "interrupt":
      return `Task interrupted

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}`
    case "pending":
    case "running":
      return `Task is still ${task.status}

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}`
  }
}

interface CancelResult {
  readonly id: string
  readonly description: string
  readonly status: "running" | "pending"
  readonly sessionID?: string
}

/**
 * Cancels a single background task. Interrupts the child session when it is
 * running, then records the task as `cancelled` (parity: V1 `cancelTask`).
 */
async function cancelBackgroundTask(
  client: OpenCodeClient,
  taskId: string,
): Promise<string> {
  const task = getRegisteredBackgroundTask(taskId)
  if (!task) return `[ERROR] Task not found: ${taskId}`
  if (task.status !== "running" && task.status !== "pending") {
    return `[ERROR] Cannot cancel task: current status is "${task.status}".
Only running or pending tasks can be cancelled.`
  }

  const originalStatus = task.status
  if (task.status === "running" && task.sessionId) {
    try {
      await client.session.interrupt({ sessionID: task.sessionId })
    } catch (error) {
      recordActivity("cancel-interrupt-error", `${taskId}:${String(error)}`)
    }
  }

  task.status = "cancelled"
  task.completedAt = Date.now()
  recordActivity("task-cancelled", taskId)
  archiveBackgroundTask(task)

  if (originalStatus === "pending") {
    return `Pending task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Status: pending`
  }

  return `Task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Session ID: ${task.sessionId}
Status: ${originalStatus}`
}

async function cancelAllBackgroundTasks(client: OpenCodeClient, parentSessionId: string): Promise<string> {
  const tasks = listDescendantTasks(parentSessionId)
  const cancellable = tasks.filter(
    (task) => task.status === "running" || task.status === "pending",
  )

  if (cancellable.length === 0) {
    return `No running or pending background tasks to cancel.`
  }

  const cancelled: CancelResult[] = []
  for (const task of cancellable) {
    if (task.status === "running" && task.sessionId) {
      try {
        await client.session.interrupt({ sessionID: task.sessionId })
      } catch (error) {
        recordActivity("cancel-interrupt-error", `${task.id}:${String(error)}`)
      }
    }
    const originalStatus = task.status
    task.status = "cancelled"
    task.completedAt = Date.now()
    archiveBackgroundTask(task)
    cancelled.push({
      id: task.id,
      description: task.description,
      status: originalStatus === "pending" ? "pending" : "running",
      sessionID: task.sessionId,
    })
  }

  const rows = cancelled
    .map(
      (entry) =>
        `| \`${entry.id}\` | ${entry.description} | ${entry.status} | ${
          entry.sessionID ? `\`${entry.sessionID}\`` : "(not started)"
        } |`,
    )
    .join("\n")

  return `Cancelled ${cancelled.length} background task(s):

| Task ID | Description | Status | Session ID |
|---------|-------------|--------|------------|
${rows}`
}

// ---------------------------------------------------------------------------
// Todo roundtrip (session metadata backed — see gap note in the header)
// ---------------------------------------------------------------------------

function isTodoInfo(value: unknown): value is TodoInfo {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    typeof record.content === "string" &&
    (record.status === "pending" ||
      record.status === "in_progress" ||
      record.status === "completed" ||
      record.status === "cancelled")
  )
}

async function readTodos(client: OpenCodeClient, sessionId: string): Promise<TodoInfo[]> {
  try {
    const info = await client.session.get({ sessionID: sessionId })
    const raw = info.metadata?.[TODO_METADATA_KEY]
    if (!Array.isArray(raw)) return []
    const todos: TodoInfo[] = []
    for (const item of raw) {
      if (isTodoInfo(item)) todos.push(item)
    }
    return todos
  } catch (error) {
    recordActivity("todo-read-error", `${sessionId}:${String(error)}`)
    return []
  }
}

async function writeTodos(client: OpenCodeClient, sessionId: string, todos: TodoInfo[]): Promise<void> {
  const info = await client.session.get({ sessionID: sessionId })
  const metadata = { ...(info.metadata ?? {}) }
  metadata[TODO_METADATA_KEY] = todos as unknown as import("@opencode/client").JsonValue
  await client.session.update({ sessionID: sessionId, metadata })
  recordActivity("todo-write", `${sessionId}:${todos.length}`)
}

// ---------------------------------------------------------------------------
// Event loop — terminal detection (parity: V1 session status/idle/error →
// V2 session.execution.succeeded|failed|interrupted)
// ---------------------------------------------------------------------------

interface EventLoopHandle {
  readonly stop: () => void
}

function startEventLoop(client: OpenCodeClient): EventLoopHandle {
  const controller = new AbortController()
  let stopped = false

  const handleEvent = (event: OpenCodeEvent): void => {
    switch (event.type) {
      case "session.execution.succeeded": {
        const sessionId = extractSessionIdFromEvent(event)
        const task = sessionId ? findTaskBySessionId(sessionId) : undefined
        if (task && task.status === "running") {
          task.status = "completed"
          task.completedAt = Date.now()
          recordActivity("task-completed", task.id)
          archiveBackgroundTask(task)
        }
        return
      }
      case "session.execution.failed": {
        const sessionId = extractSessionIdFromEvent(event)
        const task = sessionId ? findTaskBySessionId(sessionId) : undefined
        if (task && task.status === "running") {
          task.status = "error"
          task.completedAt = Date.now()
          recordActivity("task-failed", task.id)
          archiveBackgroundTask(task)
        }
        return
      }
      case "session.execution.interrupted": {
        const sessionId = extractSessionIdFromEvent(event)
        const task = sessionId ? findTaskBySessionId(sessionId) : undefined
        if (task && task.status === "running") {
          task.status = "interrupt"
          task.completedAt = Date.now()
          recordActivity("task-interrupted", task.id)
          archiveBackgroundTask(task)
        }
        return
      }
      default:
        return
    }
  }

  void (async () => {
    try {
      for await (const event of subscribeEvents(client, { signal: controller.signal })) {
        if (stopped) break
        handleEvent(event)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        recordActivity("event-loop-error", String(error))
      }
    }
  })()

  return {
    stop: () => {
      stopped = true
      controller.abort()
    },
  }
}

// ---------------------------------------------------------------------------
// Input schemas (zod — shared by tools and the `omo.orch` RPC)
// ---------------------------------------------------------------------------

const backgroundTaskInputSchema = z.object({
  description: z.string().describe("Short task description (shown in status)"),
  prompt: z.string().describe("Full detailed prompt for the agent"),
  agent: z.string().describe("Agent type to use (any registered agent)"),
})

const backgroundOutputInputSchema = z.object({
  task_id: z
    .string()
    .describe("background task ID (`bg_...`) from launch/completion; not a session ID (`ses_...`)."),
})

const backgroundCancelInputSchema = z.object({
  taskId: z.string().optional().describe("Task ID to cancel (required if all=false)"),
  all: z.boolean().optional().describe("Cancel all running background tasks (default: false)"),
})

const todoWriteInputSchema = z.object({
  sessionID: z.string().describe("Session ID to persist todos into"),
  todos: z
    .array(
      z.object({
        id: z.string().optional(),
        content: z.string(),
        status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
        priority: z.enum(["low", "medium", "high"]).optional(),
      }),
    )
    .describe("Todo list to persist"),
})

const todoReadInputSchema = z.object({
  sessionID: z.string().describe("Session ID to read todos from"),
})

// Tool descriptions (parity with V1 `tools/background-task/constants.ts`)
const BACKGROUND_TASK_DESCRIPTION = `Run agent task in background. Returns a background task ID (\`bg_...\`) immediately and notifies on completion.

Do NOT poll for results. The system delivers a <system-reminder> when the task finishes.

Prompts MUST be in English.`

const BACKGROUND_OUTPUT_DESCRIPTION = `Get output from background task. Use full_session=true to fetch session messages with filters. System notifies on completion, so block=true rarely needed.

IMPORTANT: ONLY call this tool AFTER receiving a <system-reminder> notification for the task. Do NOT call immediately after launching a background task - wait for the notification first.`

const BACKGROUND_CANCEL_DESCRIPTION = `Cancel running background task(s). Use all=true to cancel ALL before final answer.`

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerOrchestration(ctx: PluginContext): Promise<() => Promise<void>> {
  const directory = ctx.location.directory

  // Resolve the hosting server's client via service discovery (task-11
  // `discoverService`/`createClientFromEndpoint`). Falls back to undefined when
  // no discoverable server; tools then fail closed with a clear message.
  const endpoint = await discoverService()
  const client = endpoint ? createClientFromEndpoint(endpoint) : undefined
  const eventLoop = client ? startEventLoop(client) : undefined

  if (client) {
    recordActivity("client-resolved", client ? "connected" : "none")
  } else {
    recordActivity("client-resolved", "none")
  }

  // 1. Tool registration (V1 background-* tools → V2 `ctx.tool.transform`).
  await ctx.tool.transform((editor) => {
    editor.add({
      name: "background_task",
      description: BACKGROUND_TASK_DESCRIPTION,
      input: backgroundTaskInputSchema,
      execute: async (input) => {
        if (!client) return { content: "[ERROR] no discoverable opencode client" }
        if (!input.agent || input.agent.trim() === "") {
          return { content: "[ERROR] Agent parameter is required." }
        }
        const task = await launchBackgroundTask(
          client,
          {
            description: input.description,
            prompt: input.prompt,
            agent: input.agent.trim(),
            parentSessionId: "", // tool context has no session id in the V2 execute contract
          },
          directory,
        )
        return { content: formatTaskLaunchResult(task) }
      },
    })

    editor.add({
      name: "background_output",
      description: BACKGROUND_OUTPUT_DESCRIPTION,
      input: backgroundOutputInputSchema,
      execute: async (input) => {
        if (!client) return { content: "[ERROR] no discoverable opencode client" }
        return { content: await collectBackgroundOutput(client, input.task_id) }
      },
    })

    editor.add({
      name: "background_cancel",
      description: BACKGROUND_CANCEL_DESCRIPTION,
      input: backgroundCancelInputSchema,
      execute: async (input) => {
        if (!client) return { content: "[ERROR] no discoverable opencode client" }
        if (input.all === true) {
          return { content: await cancelAllBackgroundTasks(client, "") }
        }
        const taskId = input.taskId
        if (!taskId) {
          return { content: "[ERROR] Invalid arguments: Either provide a taskId or set all=true." }
        }
        return { content: await cancelBackgroundTask(client, taskId) }
      },
    })
  })

  // 2. Diagnostic RPC (id "omo.orch") — runtime-proof surface.
  const rpc = await ctx.rpc.register(
    {
      id: "omo.orch",
      methods: {
        spawn: {
          input: backgroundTaskInputSchema,
          output: z.object({
            ok: z.boolean(),
            taskId: z.string().optional(),
            sessionId: z.string().optional(),
            status: z.string().optional(),
            error: z.string().optional(),
          }),
        },
        collect: {
          input: backgroundOutputInputSchema,
          output: z.object({ ok: z.boolean(), output: z.string().optional(), error: z.string().optional() }),
        },
        cancel: {
          input: backgroundCancelInputSchema,
          output: z.object({ ok: z.boolean(), output: z.string().optional(), error: z.string().optional() }),
        },
        list: {
          input: z.object({}),
          output: z.object({
            tasks: z.array(
              z.object({
                id: z.string(),
                status: z.string(),
                sessionId: z.string().optional(),
                description: z.string(),
                agent: z.string(),
              }),
            ),
          }),
        },
        todoWrite: {
          input: todoWriteInputSchema,
          output: z.object({ ok: z.boolean(), count: z.number(), error: z.string().optional() }),
        },
        todoRead: {
          input: todoReadInputSchema,
          output: z.object({
            ok: z.boolean(),
            todos: z.array(
              z.object({
                id: z.string().optional(),
                content: z.string(),
                status: z.string(),
                priority: z.string().optional(),
              }),
            ),
            error: z.string().optional(),
          }),
        },
        activity: {
          input: z.object({}),
          output: z.object({ activity: z.array(z.object({ at: z.string(), kind: z.string(), detail: z.string() })) }),
        },
      },
      events: {},
    },
    {
      spawn: async (input) => {
        if (!client) return { ok: false, error: "no discoverable opencode client" }
        const task = await launchBackgroundTask(
          client,
          {
            description: input.description,
            prompt: input.prompt,
            agent: input.agent.trim(),
            parentSessionId: "",
          },
          directory,
        )
        return {
          ok: true,
          taskId: task.id,
          status: task.status,
          ...(task.sessionId ? { sessionId: task.sessionId } : {}),
          ...(task.error ? { error: task.error } : {}),
        }
      },
      collect: async (input) => {
        if (!client) return { ok: false, error: "no discoverable opencode client" }
        try {
          const output = await collectBackgroundOutput(client, input.task_id)
          return { ok: true, output }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      cancel: async (input) => {
        if (!client) return { ok: false, error: "no discoverable opencode client" }
        try {
          const output =
            input.all === true
              ? await cancelAllBackgroundTasks(client, "")
              : input.taskId
                ? await cancelBackgroundTask(client, input.taskId)
                : "[ERROR] Invalid arguments: Either provide a taskId or set all=true."
          return { ok: true, output }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      list: async () => {
        const registry = getRegistry()
        const tasks = [...registry.active.values(), ...registry.completed.values()].map((task) => ({
          id: task.id,
          status: task.status,
          description: task.description,
          agent: task.agent,
          ...(task.sessionId ? { sessionId: task.sessionId } : {}),
        }))
        return { tasks }
      },
      todoWrite: async (input) => {
        if (!client) return { ok: false, count: 0, error: "no discoverable opencode client" }
        try {
          await writeTodos(client, input.sessionID, input.todos)
          return { ok: true, count: input.todos.length }
        } catch (error) {
          return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) }
        }
      },
      todoRead: async (input) => {
        if (!client) return { ok: false, todos: [], error: "no discoverable opencode client" }
        try {
          const todos = await readTodos(client, input.sessionID)
          return {
            ok: true,
            todos: todos.map((todo) => ({
              content: todo.content,
              status: todo.status,
              ...(todo.id ? { id: todo.id } : {}),
              ...(todo.priority ? { priority: todo.priority } : {}),
            })),
          }
        } catch (error) {
          return { ok: false, todos: [], error: error instanceof Error ? error.message : String(error) }
        }
      },
      activity: async () => ({ activity: activityLog.slice() }),
    },
  )

  return async () => {
    eventLoop?.stop()
    await rpc.dispose()
  }
}

// Re-export the registry accessors + id predicates for unit tests (parity with
// V1 `task-registry.ts` and `types.ts`).
export {
  archiveBackgroundTask,
  cancelAllBackgroundTasks,
  cancelBackgroundTask,
  collectBackgroundOutput,
  forgetBackgroundTask,
  getRegisteredBackgroundTask,
  isBackgroundTaskId,
  isSessionId,
  launchBackgroundTask,
  listDescendantTasks,
  newTaskId,
  readTodos,
  rememberBackgroundTask,
  writeTodos,
}
