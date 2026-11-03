import { describe, expect, test } from "bun:test"
import { HYPERPLAN_MODE_PROMPT, TEAM_MODE_PROMPT } from "@oh-my-opencode/prompts-core"
import {
  HYPERPLAN_ULTRAWORK_PATTERN,
  KEYWORD_DETECTORS,
  TEAM_PATTERN,
} from "./constants"
import { detectKeywords, detectKeywordsWithType, looksLikeSlashCommand, removeCodeBlocks } from "./detector"
import { selectApplicableModes } from "./index"
import { SessionModeStore } from "./session-modes"
import { getUltraworkMessage, getUltraworkSource, isNonOmoAgent, isPlannerAgent } from "./ultrawork-router"

describe("keyword detection", () => {
  test("#given the word ultrawork #when detecting #then the ultrawork mode fires", () => {
    const detected = detectKeywordsWithType("please ultrawork this refactor")
    expect(detected.map((entry) => entry.type)).toContain("ultrawork")
  })

  test("#given the shorthand ulw #when detecting #then the ultrawork mode fires", () => {
    const detected = detectKeywordsWithType("ulw the whole repo")
    expect(detected.map((entry) => entry.type)).toContain("ultrawork")
  })

  test("#given a word that merely contains ulw #when detecting #then nothing fires", () => {
    const detected = detectKeywordsWithType("the ulwang value")
    expect(detected).toHaveLength(0)
  })

  test("#given the team mode phrase #when detecting #then the team mode fires", () => {
    expect(TEAM_PATTERN.test("use team mode here")).toBe(true)
    expect(detectKeywordsWithType("use team mode here").map((entry) => entry.type)).toContain("team")
  })

  test("#given the hyperplan keyword #when detecting #then the hyperplan mode fires", () => {
    expect(detectKeywordsWithType("hyperplan this feature").map((entry) => entry.type)).toContain("hyperplan")
  })

  test("#given a cpp header path #when detecting #then hyperplan does not fire", () => {
    // The `hpp` shorthand must not match the .hpp file extension (upstream #4215).
    expect(detectKeywordsWithType("look at src/buffer.hpp please")).toHaveLength(0)
  })

  test("#given the hpp shorthand #when detecting #then the hyperplan mode fires", () => {
    expect(detectKeywordsWithType("hpp this feature").map((entry) => entry.type)).toContain("hyperplan")
  })

  test("#given adjacent hyperplan and ultrawork #when detecting #then the combo mode fires", () => {
    expect(HYPERPLAN_ULTRAWORK_PATTERN.test("hyperplan ultrawork this")).toBe(true)
    expect(HYPERPLAN_ULTRAWORK_PATTERN.test("ultrawork hyperplan this")).toBe(true)
    const types = detectKeywordsWithType("hyperplan ultrawork this").map((entry) => entry.type)
    expect(types).toContain("hyperplan-ultrawork")
  })

  test("#given a keyword inside a code block #when detecting #then nothing fires", () => {
    expect(detectKeywordsWithType("```ts\nconst ultrawork = 1\n```")).toHaveLength(0)
    expect(removeCodeBlocks("```ts\nconst ultrawork = 1\n```")).not.toContain("ultrawork")
  })

  test("#given a slash command #when detecting #then the text is treated as a command", () => {
    expect(looksLikeSlashCommand("/ulw-plan build a thing")).toBe(true)
    expect(looksLikeSlashCommand("  /commit")).toBe(true)
    expect(looksLikeSlashCommand("ulw do the thing")).toBe(false)
  })

  test("#given a disabled keyword #when detecting #then it does not fire", () => {
    expect(detectKeywordsWithType("ultrawork this", undefined, undefined, ["ultrawork"])).toHaveLength(0)
  })

  test("#given ultrawork disabled #when detecting #then the combo mode is disabled too", () => {
    const types = detectKeywordsWithType("hyperplan ultrawork", undefined, undefined, ["ultrawork"]).map(
      (entry) => entry.type,
    )
    expect(types).not.toContain("hyperplan-ultrawork")
  })

  test("#given an allowlist #when detecting #then only the allowed types fire", () => {
    const types = detectKeywordsWithType("ultrawork and team mode", undefined, undefined, undefined, ["team"]).map(
      (entry) => entry.type,
    )
    expect(types).toEqual(["team"])
  })

  test("#given a detection #when reading the messages #then the mode bodies are returned", () => {
    const messages = detectKeywords("team mode please")
    expect(messages).toEqual([TEAM_MODE_PROMPT])
  })
})

describe("ultrawork routing", () => {
  test("#given a planner agent #when routing #then the planner doctrine is selected", () => {
    expect(isPlannerAgent("prometheus")).toBe(true)
    expect(isPlannerAgent("plan")).toBe(true)
    expect(getUltraworkSource("prometheus")).toBe("planner")
    expect(getUltraworkMessage("prometheus")).toContain("planner")
  })

  test("#given a non-OMO agent #when checking #then it is detected", () => {
    expect(isNonOmoAgent("builder")).toBe(true)
    expect(isNonOmoAgent("plan")).toBe(true)
    expect(isNonOmoAgent("sisyphus")).toBe(false)
  })

  test("#given a normal agent #when routing #then the default doctrine is selected", () => {
    expect(getUltraworkSource("sisyphus")).toBe("default")
  })

  test("#given the detector table #when reading it #then it carries exactly four keyword types", () => {
    expect(KEYWORD_DETECTORS.map((detector) => detector.type)).toEqual([
      "ultrawork",
      "team",
      "hyperplan",
      "hyperplan-ultrawork",
    ])
  })
})

describe("mode selection per agent", () => {
  test("#given a non-OMO agent #when selecting modes #then nothing applies", () => {
    expect(selectApplicableModes(["ultrawork", "team"], "builder")).toEqual([])
  })

  test("#given a planner agent #when selecting modes #then the adversarial planning modes are dropped", () => {
    expect(selectApplicableModes(["ultrawork", "hyperplan", "hyperplan-ultrawork"], "prometheus")).toEqual([
      "ultrawork",
    ])
  })

  test("#given a normal agent #when selecting modes #then every armed mode applies", () => {
    expect(selectApplicableModes(["ultrawork", "team"], "sisyphus")).toEqual(["ultrawork", "team"])
  })
})

describe("session mode store", () => {
  test("#given an armed mode #when reading it back #then it is returned", () => {
    const store = new SessionModeStore()
    store.arm("ses_1", ["ultrawork"])
    expect([...(store.get("ses_1")?.modes ?? [])]).toEqual(["ultrawork"])
  })

  test("#given more sessions than the cap #when arming #then the oldest is evicted", () => {
    const store = new SessionModeStore()
    for (let index = 0; index < 260; index += 1) {
      store.arm(`ses_${index}`, ["ultrawork"])
    }
    expect(store.size).toBeLessThanOrEqual(256)
    expect(store.get("ses_0")).toBeUndefined()
    expect(store.get("ses_259")).toBeDefined()
  })

  test("#given a session #when clearing it #then its modes are dropped", () => {
    const store = new SessionModeStore()
    store.arm("ses_1", ["ultrawork"])
    store.clear("ses_1")
    expect(store.get("ses_1")).toBeUndefined()
  })
})
