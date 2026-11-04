import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as nodePath from "node:path"
import { ultraworkPromptVariants } from "@oh-my-opencode/prompts-core"
import { detectThinkKeyword, looksLikeSlashCommand, stripCodeBlocks } from "./detection"
import { detectUltraworkSource, isNonOmoAgent } from "./modes"
import { isAlreadyHighVariant } from "./think-mode"
import { registerKeywordDetector, type PluginContext } from "./index"

/**
 * [OMC] v2 keyword-detector tests.
 *
 * The hook-level cases drive the REAL prompt/context hook callbacks captured
 * from a fake plugin context (registration path is the production one), which
 * is the strongest proof available without a live model session: detection,
 * gating, arming, disarm, directive append, model override, and post-compaction
 * restoration all execute the shipped code paths. Runtime firing against a live
 * opencode v2 session keeps the same documented limitation as parity-matrix
 * rows 6/26 (PASS\*: registration + unit proof; live firing post-cutover).
 */

// ---------------------------------------------------------------------------
// Fake plugin context
// ---------------------------------------------------------------------------

interface FakeSessionInfo {
  agent?: string
  parentID?: string
  model?: { id: string; providerID: string; variant?: string }
}

interface SwitchModelCall {
  sessionID: string
  model: { id: string; providerID: string; variant?: string }
}

interface ContextEvent {
  sessionID: string
  agent?: string
  model?: { id?: string }
  system: Array<{ type: string; text: string }>
  messages: Array<Record<string, unknown>>
  options: Record<string, unknown>
}

interface PromptEvent {
  sessionID: string
  prompt: { text: string }
}

interface FakeHarness {
  readonly ctx: PluginContext
  prompt(input: PromptEvent): Promise<void>
  context(input: ContextEvent): void
  readonly switchModelCalls: SwitchModelCall[]
  setSession(session: FakeSessionInfo | undefined): void
  readonly configDir: string
}

async function createFakeHarness(): Promise<FakeHarness> {
  const configDir = await mkdtemp(nodePath.join(tmpdir(), "omo-keyword-test-"))
  const promptCallbacks: Array<(input: PromptEvent) => Promise<void> | void> = []
  const contextCallbacks: Array<(input: ContextEvent) => Promise<void> | void> = []
  const switchModelCalls: SwitchModelCall[] = []
  let session: FakeSessionInfo | undefined

  const ctx = {
    location: { directory: configDir },
    session: {
      hook: async (name: "prompt" | "context", callback: (input: never) => Promise<void> | void) => {
        const store = name === "prompt" ? promptCallbacks : contextCallbacks
        store.push(callback as (input: never) => Promise<void> | void)
        return { dispose: async () => {} }
      },
      get: async () => session,
      switchModel: async (input: SwitchModelCall) => {
        switchModelCalls.push(input)
      },
    },
  } as unknown as PluginContext

  await registerKeywordDetector(ctx)

  return {
    ctx,
    configDir,
    switchModelCalls,
    setSession(next: FakeSessionInfo | undefined) {
      session = next
    },
    async prompt(input: PromptEvent) {
      for (const callback of promptCallbacks) await callback(input)
    },
    context(input: ContextEvent) {
      for (const callback of contextCallbacks) callback(input)
    },
  }
}

// ---------------------------------------------------------------------------
// Harness fixtures
// ---------------------------------------------------------------------------

const harnesses: FakeHarness[] = []

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()
    if (harness) await rm(harness.configDir, { recursive: true, force: true })
  }
})

async function createRegisteredHarness(config?: Record<string, unknown>): Promise<FakeHarness> {
  const harness = await createFakeHarness()
  harnesses.push(harness)
  if (config) {
    await writeFile(nodePath.join(harness.configDir, "omo.json"), JSON.stringify(config))
  }
  harness.setSession({ agent: "sisyphus" })
  return harness
}

function promptEvent(text: string, sessionID = "ses_test"): PromptEvent {
  return { sessionID, prompt: { text } }
}

function contextEvent(overrides: Partial<ContextEvent> = {}): ContextEvent {
  return {
    sessionID: "ses_test",
    agent: "sisyphus",
    system: [],
    messages: [],
    options: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Detection primitives
// ---------------------------------------------------------------------------

describe("keyword detection primitives", () => {
  it("#given text with code blocks #when stripping #then keywords inside code are removed", () => {
    expect(stripCodeBlocks("```ts\nconst ultrawork = 1\n```")).not.toContain("ultrawork")
    expect(stripCodeBlocks("use `ulw` inline")).not.toContain("ulw")
    expect(stripCodeBlocks("no code here")).toContain("no code")
  })

  it("#given a slash command #when checking #then it is treated as a command", () => {
    expect(looksLikeSlashCommand("/ulw-plan build")).toBe(true)
    expect(looksLikeSlashCommand("  /commit")).toBe(true)
    expect(looksLikeSlashCommand("ulw do the thing")).toBe(false)
  })

  it("#given agent and model names #when routing #then the ultrawork source matches V1 routing", () => {
    expect(detectUltraworkSource("prometheus")).toBe("planner")
    expect(detectUltraworkSource(undefined, "gpt-5.4")).toBe("gpt")
    expect(detectUltraworkSource(undefined, "gemini-3-pro")).toBe("gemini")
    expect(detectUltraworkSource(undefined, "glm-5.3")).toBe("glm")
    expect(detectUltraworkSource("sisyphus", "claude-opus-4-7")).toBe("default")
  })

  it("#given host built-in agents #when checking #then they are non-OMO", () => {
    expect(isNonOmoAgent("builder")).toBe(true)
    expect(isNonOmoAgent("plan")).toBe(true)
    expect(isNonOmoAgent("general")).toBe(true)
    expect(isNonOmoAgent("sisyphus")).toBe(false)
    expect(isNonOmoAgent(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Ultrawork arm (regression pin for the src/v2/ultrawork.ts behavior)
// ---------------------------------------------------------------------------

describe("ultrawork arm", () => {
  it("#given a keyword message #when the prompt hook runs #then the directive is appended to prompt.text", async () => {
    const harness = await createRegisteredHarness()
    const event = promptEvent("please ultrawork this refactor")
    await harness.prompt(event)
    expect(event.prompt.text).toContain("please ultrawork this refactor")
    expect(event.prompt.text).toContain("\n\n---\n\n")
    expect(event.prompt.text).toContain(ultraworkPromptVariants.default.content)
  })

  it("#given an armed session #when a follow-up message arrives #then the directive is not appended twice", async () => {
    const harness = await createRegisteredHarness()
    await harness.prompt(promptEvent("ulw the repo"))
    const second = promptEvent("keep going")
    await harness.prompt(second)
    expect(second.prompt.text).toBe("keep going")
  })

  it("#given a slash command #when the prompt hook runs #then nothing is injected", async () => {
    const harness = await createRegisteredHarness()
    const event = promptEvent("/ulw-something build")
    await harness.prompt(event)
    expect(event.prompt.text).toBe("/ulw-something build")
  })

  it("#given /stop-continuation #when the prompt hook runs #then the session is disarmed and can re-arm", async () => {
    const harness = await createRegisteredHarness()
    await harness.prompt(promptEvent("ulw start"))
    await harness.prompt(promptEvent("/stop-continuation"))
    const rearm = promptEvent("ultrawork again")
    await harness.prompt(rearm)
    expect(rearm.prompt.text).toContain(ultraworkPromptVariants.default.content)
  })

  it("#given a keyword inside a code block #when the prompt hook runs #then nothing is injected", async () => {
    const harness = await createRegisteredHarness()
    const event = promptEvent("look at ```ts\nconst ultrawork = 1\n``` please")
    await harness.prompt(event)
    expect(event.prompt.text).not.toContain("---")
  })

  it("#given a subagent session #when the prompt hook runs #then no directive is injected", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus", parentID: "ses_parent" })
    const event = promptEvent("ulw as a subagent")
    await harness.prompt(event)
    expect(event.prompt.text).toBe("ulw as a subagent")
  })

  it("#given a non-OMO agent #when the prompt hook runs #then no directive is injected", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "builder" })
    const event = promptEvent("ulw with the host builder")
    await harness.prompt(event)
    expect(event.prompt.text).toBe("ulw with the host builder")
  })

  it("#given disabled_keywords contains ultrawork #when the prompt hook runs #then the arm is gated off", async () => {
    const harness = await createRegisteredHarness({
      keyword_detector: { disabled_keywords: ["ultrawork"] },
    })
    const event = promptEvent("ulw gated")
    await harness.prompt(event)
    expect(event.prompt.text).toBe("ulw gated")
  })

  it("#given an enabled_expansions allowlist without ultrawork #when the prompt hook runs #then the arm is gated off", async () => {
    const harness = await createRegisteredHarness({
      keyword_detector: { enabled_expansions: ["team"] },
    })
    const event = promptEvent("ulw allowlisted out")
    await harness.prompt(event)
    expect(event.prompt.text).toBe("ulw allowlisted out")
  })

  it("#given default_mode.ultrawork #when the first message arrives without a keyword #then ultrawork auto-arms", async () => {
    const harness = await createRegisteredHarness({
      default_mode: { ultrawork: true },
    })
    const event = promptEvent("just a normal message")
    await harness.prompt(event)
    expect(event.prompt.text).toContain(ultraworkPromptVariants.default.content)
  })

  it("#given agents.<id>.ultrawork.model #when the arm fires #then switchModel is awaited with the override", async () => {
    const harness = await createRegisteredHarness({
      agents: { sisyphus: { ultrawork: { model: "anthropic/claude-opus-4-8", variant: "high" } } },
    })
    const event = promptEvent("ulw with an override")
    await harness.prompt(event)
    expect(harness.switchModelCalls).toEqual([
      {
        sessionID: "ses_test",
        model: { id: "claude-opus-4-8", providerID: "anthropic", variant: "high" },
      },
    ])
    // The routed directive follows the override model (gpt/claude -> default here).
    expect(event.prompt.text).toContain(ultraworkPromptVariants.default.content)
  })

  it("#given a gpt override model #when the arm fires #then the gpt directive variant is injected", async () => {
    const harness = await createRegisteredHarness({
      agents: { sisyphus: { ultrawork: { model: "openai/gpt-5.4" } } },
    })
    const event = promptEvent("ulw on gpt")
    await harness.prompt(event)
    expect(event.prompt.text).toContain(ultraworkPromptVariants.gpt.content)
  })
})

// ---------------------------------------------------------------------------
// Think arm (V1 hooks/think-mode parity)
// ---------------------------------------------------------------------------

describe("think arm", () => {
  it("#given think keywords #when detecting #then English and multilingual arms fire", () => {
    expect(detectThinkKeyword("think about this carefully")).toBe(true)
    expect(detectThinkKeyword("ULTRATHINK the design")).toBe(true)
    expect(detectThinkKeyword("이 부분을 제대로 검토해줘")).toBe(true)
    expect(detectThinkKeyword("reflectă la asta")).toBe(true)
  })

  it("#given non-think text #when detecting #then nothing fires", () => {
    expect(detectThinkKeyword("just ship it")).toBe(false)
    expect(detectThinkKeyword("look at ```think``` in code")).toBe(false)
  })

  it("#given model refs #when checking already-high #then high+ variants and -high ids are detected", () => {
    expect(isAlreadyHighVariant("claude-sonnet-4-6", "high")).toBe(true)
    expect(isAlreadyHighVariant("claude-sonnet-4-6", "xhigh")).toBe(true)
    expect(isAlreadyHighVariant("claude-sonnet-4-6", "max")).toBe(true)
    expect(isAlreadyHighVariant("claude-sonnet-4-6-high")).toBe(true)
    expect(isAlreadyHighVariant("gpt-5.4-high")).toBe(true)
    expect(isAlreadyHighVariant("vertex_ai/claude-opus-4-7-high")).toBe(true)
    expect(isAlreadyHighVariant("claude-sonnet-4-6")).toBe(false)
    expect(isAlreadyHighVariant("claude-sonnet-4-6", "low")).toBe(false)
    expect(isAlreadyHighVariant("gpt-5.4", "medium")).toBe(false)
  })

  it("#given a think message on a variantless model #when the prompt hook runs #then switchModel raises the variant to high on the same model", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus", model: { id: "claude-sonnet-4-6", providerID: "anthropic" } })
    await harness.prompt(promptEvent("think hard about the failure"))
    expect(harness.switchModelCalls).toEqual([
      { sessionID: "ses_test", model: { id: "claude-sonnet-4-6", providerID: "anthropic", variant: "high" } },
    ])
  })

  it("#given a dotted model id #when the raise fires #then the same id is preserved (no model switch)", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus", model: { id: "gpt-5.4", providerID: "openai" } })
    await harness.prompt(promptEvent("ultrathink this one"))
    expect(harness.switchModelCalls).toEqual([
      { sessionID: "ses_test", model: { id: "gpt-5.4", providerID: "openai", variant: "high" } },
    ])
  })

  it("#given an already-high session #when a think message arrives #then no switch happens", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus", model: { id: "claude-sonnet-4-6", providerID: "anthropic", variant: "max" } })
    await harness.prompt(promptEvent("think as hard as possible"))
    harness.setSession({ agent: "sisyphus", model: { id: "claude-opus-4-7-high", providerID: "anthropic" } })
    await harness.prompt(promptEvent("think again"))
    expect(harness.switchModelCalls).toHaveLength(0)
  })

  it("#given a low variant session #when a think message arrives #then the variant is raised to high", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus", model: { id: "claude-sonnet-4-6", providerID: "anthropic", variant: "low" } })
    await harness.prompt(promptEvent("think it through"))
    expect(harness.switchModelCalls).toHaveLength(1)
    expect(harness.switchModelCalls[0]?.model.variant).toBe("high")
  })

  it("#given a session without a model #when a think message arrives #then no switch is attempted", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus" })
    await harness.prompt(promptEvent("think without a model"))
    expect(harness.switchModelCalls).toHaveLength(0)
  })

  it("#given a slash command #when the prompt hook runs #then the think arm is gated too", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus", model: { id: "claude-sonnet-4-6", providerID: "anthropic" } })
    await harness.prompt(promptEvent("/think-command run"))
    expect(harness.switchModelCalls).toHaveLength(0)
  })

  it("#given a subagent session #when a think message arrives #then the raise still fires (V1 parity: no agent gating)", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({
      agent: "sisyphus",
      parentID: "ses_parent",
      model: { id: "claude-sonnet-4-6", providerID: "anthropic" },
    })
    await harness.prompt(promptEvent("think in the subagent"))
    expect(harness.switchModelCalls).toHaveLength(1)
  })

  it("#given an ultrawork-armed session #when a later message asks to think #then the raise still fires", async () => {
    const harness = await createRegisteredHarness()
    harness.setSession({ agent: "sisyphus", model: { id: "claude-sonnet-4-6", providerID: "anthropic" } })
    await harness.prompt(promptEvent("ulw start"))
    expect(harness.switchModelCalls).toHaveLength(0)
    await harness.prompt(promptEvent("think more"))
    expect(harness.switchModelCalls).toHaveLength(1)
    expect(harness.switchModelCalls[0]?.model.variant).toBe("high")
  })
})

// ---------------------------------------------------------------------------
// Post-compaction restoration
// ---------------------------------------------------------------------------

describe("ultrawork context restoration", () => {
  it("#given an armed session with no marker in the request #when the context hook runs #then the directive is restored into system", async () => {
    const harness = await createRegisteredHarness()
    await harness.prompt(promptEvent("ulw start"))
    const event = contextEvent()
    harness.context(event)
    expect(event.system).toHaveLength(1)
    expect(event.system[0]?.text).toContain("<ultrawork-mode>active</ultrawork-mode>")
    expect(event.system[0]?.text).toContain(ultraworkPromptVariants.default.content)
  })

  it("#given the directive still present in messages #when the context hook runs #then nothing is re-injected", async () => {
    const harness = await createRegisteredHarness()
    await harness.prompt(promptEvent("ulw start"))
    const event = contextEvent({
      messages: [{ role: "user", content: [{ type: "text", text: ultraworkPromptVariants.default.content }] }],
    })
    harness.context(event)
    expect(event.system).toHaveLength(0)
  })

  it("#given a disarmed session #when the context hook runs #then nothing is injected", async () => {
    const harness = await createRegisteredHarness()
    await harness.prompt(promptEvent("ulw start"))
    await harness.prompt(promptEvent("/stop-continuation"))
    const event = contextEvent()
    harness.context(event)
    expect(event.system).toHaveLength(0)
  })

  it("#given an unarmed session #when the context hook runs #then nothing is injected", async () => {
    const harness = await createRegisteredHarness()
    const event = contextEvent()
    harness.context(event)
    expect(event.system).toHaveLength(0)
  })
})
