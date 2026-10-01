import { afterEach, describe, expect, it } from "bun:test"
import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client"
import {
  archiveBackgroundTask,
  cancelBackgroundTask,
  collectBackgroundOutput,
  forgetBackgroundTask,
  getRegisteredBackgroundTask,
  listDescendantTasks,
  newTaskId,
  rememberBackgroundTask,
  type BackgroundTask,
} from "./orchestration"

/**
 * [OMC] v2 orchestration unit tests (task 13).
 *
 * Covers the deterministic paths that the isolated harness cannot reach
 * without a real model: collect on a `completed` task (assistant text
 * extraction) and cancel on a `running`/`pending` task. The registry
 * roundtrip and id format are also asserted. The runtime harness proof
 * (spawn → `execution.failed` → `error`, todo metadata roundtrip) lives in
 * the task-13 evidence.
 */

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_test0001",
    parentSessionId: "ses_parent",
    description: "test task",
    prompt: "test prompt",
    agent: "build",
    status: "running",
    ...overrides,
  }
}

function assistantMessage(text: string): SessionMessageInfo {
  return {
    id: "msg_test0001",
    type: "assistant",
    agent: "build",
    model: { providerID: "test", modelID: "test" },
    time: { created: 1 },
    content: [{ type: "text", text }],
  } as unknown as SessionMessageInfo
}

function stubClient(messages: SessionMessageInfo[]): OpenCodeClient {
  return {
    message: {
      list: async () => ({ data: messages, cursor: { previous: null, next: null } }),
    },
  } as unknown as OpenCodeClient
}

function stubClientWithInterrupt(): OpenCodeClient {
  return {
    session: {
      interrupt: async () => ({ interrupted: true }),
    },
  } as unknown as OpenCodeClient
}

afterEach(() => {
  for (const id of ["bg_test0001", "bg_test0002", "bg_test0003"]) {
    forgetBackgroundTask(id)
  }
})

describe("orchestration — background task registry", () => {
  it("newTaskId emits bg_ prefixed ids", () => {
    expect(newTaskId()).toMatch(/^bg_[0-9a-f]{8}$/)
  })

  it("remember → get → archive → get roundtrip", () => {
    const task = makeTask({ id: "bg_test0001", sessionId: "ses_child", status: "completed" })
    rememberBackgroundTask(task)
    expect(getRegisteredBackgroundTask("bg_test0001")?.status).toBe("completed")

    archiveBackgroundTask(task)
    expect(getRegisteredBackgroundTask("bg_test0001")?.id).toBe("bg_test0001")

    forgetBackgroundTask("bg_test0001")
    expect(getRegisteredBackgroundTask("bg_test0001")).toBeUndefined()
  })

  it("does not archive non-terminal tasks (V1 parity: forgotten)", () => {
    const running = makeTask({ id: "bg_test0002", sessionId: "ses_running", status: "running" })
    rememberBackgroundTask(running)
    archiveBackgroundTask(running)
    // V1 `archiveBackgroundTask` deletes from active and only re-adds to
    // completed for terminal tasks with a session id → non-terminal is forgotten.
    expect(getRegisteredBackgroundTask("bg_test0002")).toBeUndefined()
  })

  it("lists descendant tasks by parent session", () => {
    const child = makeTask({ id: "bg_test0003", parentSessionId: "ses_parent", status: "running" })
    rememberBackgroundTask(child)
    expect(listDescendantTasks("ses_parent").map((t) => t.id)).toContain("bg_test0003")
  })
})

describe("orchestration — collect output", () => {
  it("returns assistant text for a completed task", async () => {
    const task = makeTask({
      id: "bg_test0001",
      sessionId: "ses_child",
      status: "completed",
      completedAt: Date.now(),
    })
    rememberBackgroundTask(task)
    const client = stubClient([assistantMessage("hello from the child agent")])
    const output = await collectBackgroundOutput(client, "bg_test0001")
    expect(output).toBe("hello from the child agent")
  })

  it("returns Task failed for an error task", async () => {
    const task = makeTask({
      id: "bg_test0002",
      sessionId: "ses_child",
      status: "error",
      error: "provider 400",
      completedAt: Date.now(),
    })
    rememberBackgroundTask(task)
    const output = await collectBackgroundOutput(stubClient([]), "bg_test0002")
    expect(output).toContain("Task failed")
    expect(output).toContain("provider 400")
  })

  it("returns Task not found for an unknown task", async () => {
    const output = await collectBackgroundOutput(stubClient([]), "bg_missing")
    expect(output).toBe("Task not found: bg_missing")
  })
})

describe("orchestration — cancel", () => {
  it("cancels a running task (interrupts the child session)", async () => {
    const task = makeTask({ id: "bg_test0001", sessionId: "ses_child", status: "running" })
    rememberBackgroundTask(task)
    const output = await cancelBackgroundTask(stubClientWithInterrupt(), "bg_test0001")
    expect(output).toContain("Task cancelled successfully")
    expect(getRegisteredBackgroundTask("bg_test0001")?.status).toBe("cancelled")
  })

  it("cancels a pending task without a session", async () => {
    const task = makeTask({ id: "bg_test0002", status: "pending" })
    rememberBackgroundTask(task)
    const output = await cancelBackgroundTask(stubClientWithInterrupt(), "bg_test0002")
    expect(output).toContain("Pending task cancelled successfully")
    // no sessionId → V1 `archiveBackgroundTask` forgets it (not re-added to completed)
    expect(getRegisteredBackgroundTask("bg_test0002")).toBeUndefined()
  })

  it("refuses to cancel a terminal task", async () => {
    const task = makeTask({ id: "bg_test0003", status: "completed" })
    rememberBackgroundTask(task)
    const output = await cancelBackgroundTask(stubClientWithInterrupt(), "bg_test0003")
    expect(output).toContain("Cannot cancel task")
  })
})
