import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { OhMyOpenCodeConfigSchema } from "../config/schema/oh-my-opencode-config"
import type { AgentDefinition } from "./agents"
import {
  applyAgentOverride,
  buildRegisteredAgents,
  parseAgentModelSpec,
  resolveAgentModel,
  resolveFileUriSource,
} from "./agent-overrides"

/**
 * [OMC] v2 agent-override application tests.
 *
 * Covers the three halves of the omo.json `agents.<id>` layer: file:// prompt
 * sources, model resolution (override spec + AGENT_MODEL_REQUIREMENTS chain),
 * and override application onto the static inventory (identity, prompt,
 * tools→permission rules, disable).
 */

const createdDirs: string[] = []

function makeProject(): string {
  const project = mkdtempSync(join(tmpdir(), "omo-v2-agent-overrides-"))
  createdDirs.push(project)
  return project
}

function makeConfig(raw: Record<string, unknown>): ReturnType<typeof OhMyOpenCodeConfigSchema.parse> | null {
  const parsed = OhMyOpenCodeConfigSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

const ORACLE_DEF: AgentDefinition = {
  id: "oracle",
  name: "Oracle",
  description: "base oracle description",
  mode: "subagent",
  system: "base oracle system",
  color: "#FFAA00",
  permissions: [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
  ],
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("agent-overrides — parseAgentModelSpec", () => {
  it("parses provider/model", () => {
    // given / when
    const parsed = parseAgentModelSpec("zai-coding-plan/glm-5.2")
    // then
    expect(parsed).toEqual({ providerID: "zai-coding-plan", modelID: "glm-5.2" })
  })

  it("parses provider/model#variant and normalizes the reasoning vocabulary", () => {
    // given / when
    const parsed = parseAgentModelSpec("anthropic/claude-opus-5-5#max")
    const noneAlias = parseAgentModelSpec("openai/gpt-5.6-sol#none")
    // then
    expect(parsed).toEqual({ providerID: "anthropic", modelID: "claude-opus-5-5", variant: "max" })
    expect(noneAlias?.variant).toBe("off")
  })

  it("keeps a model id containing a slash intact", () => {
    // given / when
    const parsed = parseAgentModelSpec("gateway/nested/model-id")
    // then
    expect(parsed).toEqual({ providerID: "gateway", modelID: "nested/model-id" })
  })

  it("rejects malformed specs", () => {
    // given / when / then
    expect(parseAgentModelSpec("no-slash")).toBeUndefined()
    expect(parseAgentModelSpec("/missing-provider")).toBeUndefined()
    expect(parseAgentModelSpec("missing-model/")).toBeUndefined()
    expect(parseAgentModelSpec("   ")).toBeUndefined()
  })

  it("treats a trailing '#' as no variant", () => {
    // given / when
    const parsed = parseAgentModelSpec("openai/gpt-5.6-sol#")
    // then
    expect(parsed).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol" })
  })
})

describe("agent-overrides — resolveAgentModel", () => {
  it("lets a format-valid user override win regardless of connectivity", () => {
    // given
    const override = { model: "zai-coding-plan/glm-5.2#high" }
    // when
    const resolved = resolveAgentModel(override, "oracle", new Set(["anthropic"]))
    // then
    expect(resolved).toEqual({ providerID: "zai-coding-plan", modelID: "glm-5.2", variant: "high" })
  })

  it("falls through to the chain when the override spec is malformed", () => {
    // given
    const override = { model: "not-a-spec" }
    // when: oracle chain rung 1 = openai/chatgpt-subscription/opencode → gpt-5.6-sol (xhigh)
    const resolved = resolveAgentModel(override, "oracle", new Set(["openai"]))
    // then
    expect(resolved).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol", variant: "xhigh" })
  })

  it("picks the first chain rung with an available provider", () => {
    // given: no anthropic/openai; gemini rung reachable via github-copilot
    const connected = new Set(["github-copilot"])
    // when
    const resolved = resolveAgentModel(undefined, "oracle", connected)
    // then: rung 2 (github-copilot gpt-5.6-sol high) comes before the gemini rung
    expect(resolved).toEqual({ providerID: "github-copilot", modelID: "gpt-5.6-sol", variant: "high" })
  })

  it("resolves the connected provider among a rung's provider list", () => {
    // given: sisyphus rung 1 lists anthropic + github-copilot + opencode
    const connected = new Set(["opencode"])
    // when
    const resolved = resolveAgentModel(undefined, "sisyphus", connected)
    // then
    expect(resolved).toEqual({ providerID: "opencode", modelID: "claude-opus-5-5", variant: "max" })
  })

  it("returns undefined when no rung provider is available", () => {
    // given / when
    const resolved = resolveAgentModel(undefined, "oracle", new Set(["deepseek"]))
    // then: agent inherits the session model
    expect(resolved).toBeUndefined()
  })

  it("returns undefined for an agent without requirements", () => {
    // given / when
    const resolved = resolveAgentModel(undefined, "no-such-agent", new Set(["openai"]))
    // then
    expect(resolved).toBeUndefined()
  })

  it("omits the variant when neither rung nor requirement defines one", () => {
    // given: sisyphus rung 4 = zai-coding-plan/opencode/bailian-coding-plan → glm-5.2 (no variant)
    const connected = new Set(["zai-coding-plan"])
    // when
    const resolved = resolveAgentModel(undefined, "sisyphus", connected)
    // then
    expect(resolved).toEqual({ providerID: "zai-coding-plan", modelID: "glm-5.2" })
  })
})

describe("agent-overrides — resolveFileUriSource", () => {
  it("passes non-file:// values through unchanged", () => {
    // given / when / then
    expect(resolveFileUriSource("plain prompt text", makeProject())).toBe("plain prompt text")
  })

  it("reads an absolute file:// URI inside the project", () => {
    // given
    const project = makeProject()
    writeFileSync(join(project, "prompt.md"), "file prompt body")
    // when
    const source = resolveFileUriSource(`file://${join(project, "prompt.md")}`, project)
    // then
    expect(source).toBe("file prompt body")
  })

  it("resolves a relative file:// URI against the base directory", () => {
    // given
    const project = makeProject()
    writeFileSync(join(project, "append.md"), "appended body")
    // when
    const source = resolveFileUriSource("file://./append.md", project)
    // then
    expect(source).toBe("appended body")
  })

  it("returns a warning placeholder for a missing file", () => {
    // given
    const project = makeProject()
    // when
    const source = resolveFileUriSource("file://./does-not-exist.md", project)
    // then
    expect(source).toContain("[WARNING: Could not resolve file URI")
  })

  it("rejects a file URI resolving outside the project and allowed home dirs", () => {
    // given
    const project = makeProject()
    // when: ~ expansion lands on a home path that is not in the allowlist
    const source = resolveFileUriSource("file://~/.ssh/id_rsa", project)
    // then
    expect(source).toContain("[WARNING: Path rejected")
  })

  it("rejects encoded traversal escaping the project root", () => {
    // given
    const project = makeProject()
    // when
    const source = resolveFileUriSource("file://%2e%2e/secret.txt", project)
    // then: resolves to <parent-of-project>/secret.txt → outside allowed paths
    expect(source).toContain("[WARNING: Path rejected")
  })

  it("reads a file under the allowed ~/.omo home directory", () => {
    // given: the impl expands ~ through os.homedir() (V1 parity); the test
    // preload redirects process.env.HOME but os.homedir() caches at start, so
    // the fixture must be built from homedir() itself.
    const project = makeProject()
    const homeOmo = join(homedir(), ".omo")
    mkdirSync(homeOmo, { recursive: true })
    const homeFile = join(homeOmo, "omo-v2-agent-overrides-fixture.md")
    writeFileSync(homeFile, "home append body")
    try {
      // when
      const source = resolveFileUriSource(`file://~/.omo/omo-v2-agent-overrides-fixture.md`, project)
      // then
      expect(source).toBe("home append body")
    } finally {
      rmSync(homeFile, { force: true })
    }
  })
})

describe("agent-overrides — applyAgentOverride", () => {
  it("returns undefined when the override disables the agent", () => {
    // given / when
    const applied = applyAgentOverride(ORACLE_DEF, { disable: true }, makeProject())
    // then
    expect(applied).toBeUndefined()
  })

  it("returns the definition untouched when there is no override", () => {
    // given / when
    const applied = applyAgentOverride(ORACLE_DEF, undefined, makeProject())
    // then
    expect(applied).toEqual(ORACLE_DEF)
  })

  it("applies identity fields (displayName, description, mode, color)", () => {
    // given
    const override = {
      displayName: "Consultant",
      description: "overridden description",
      mode: "primary",
      color: "#00FF00",
    }
    // when
    const applied = applyAgentOverride(ORACLE_DEF, override, makeProject())
    // then
    expect(applied).toMatchObject({
      name: "Consultant",
      description: "overridden description",
      mode: "primary",
      color: "#00FF00",
      system: ORACLE_DEF.system,
    })
  })

  it("replaces the system prompt with a literal prompt", () => {
    // given
    const override = { prompt: "replacement system" }
    // when
    const applied = applyAgentOverride(ORACLE_DEF, override, makeProject())
    // then
    expect(applied?.system).toBe("replacement system")
  })

  it("loads a file:// prompt and appends prompt_append with a newline", () => {
    // given
    const project = makeProject()
    writeFileSync(join(project, "p.md"), "file system")
    writeFileSync(join(project, "a.md"), "file append")
    const override = { prompt: "file://./p.md", prompt_append: "file://./a.md" }
    // when
    const applied = applyAgentOverride(ORACLE_DEF, override, project)
    // then
    expect(applied?.system).toBe("file system\nfile append")
  })

  it("appends prompt_append to the base prompt when only an append is given", () => {
    // given
    const override = { prompt_append: "extra text" }
    // when
    const applied = applyAgentOverride(ORACLE_DEF, override, makeProject())
    // then
    expect(applied?.system).toBe(`${ORACLE_DEF.system}\nextra text`)
  })

  it("appends tools rules after the definition's own permissions", () => {
    // given
    const override = { tools: { edit: false, bash: true } }
    // when
    const applied = applyAgentOverride(ORACLE_DEF, override, makeProject())
    // then
    expect(applied?.permissions).toEqual([
      ...ORACLE_DEF.permissions!,
      { action: "edit", resource: "*", effect: "deny" },
      { action: "bash", resource: "*", effect: "allow" },
    ])
  })
})

describe("agent-overrides — buildRegisteredAgents", () => {
  const INVENTORY: readonly AgentDefinition[] = [
    ORACLE_DEF,
    { ...ORACLE_DEF, id: "momus", name: "Momus", system: "momus system" },
  ]

  it("returns the full inventory when no config exists", () => {
    // given / when
    const plan = buildRegisteredAgents({
      inventory: INVENTORY,
      config: null,
      connectedProviders: new Set(),
      baseDir: makeProject(),
    })
    // then
    expect(plan.agents.map((agent) => agent.id)).toEqual(["oracle", "momus"])
    expect(plan.disabled).toEqual([])
    expect(plan.unapplied).toEqual([])
  })

  it("drops disabled agents and reports unknown override keys", () => {
    // given
    const config = makeConfig({ agents: { momus: { disable: true }, prometheus: { disable: true } } })
    // when
    const plan = buildRegisteredAgents({
      inventory: INVENTORY,
      config,
      connectedProviders: new Set(),
      baseDir: makeProject(),
    })
    // then
    expect(plan.agents.map((agent) => agent.id)).toEqual(["oracle"])
    expect(plan.disabled).toEqual(["momus"])
    expect(plan.unapplied).toEqual(["prometheus"])
  })

  it("pins the user override model and the chain-resolved model", () => {
    // given
    const config = makeConfig({ agents: { oracle: { model: "zai-coding-plan/glm-5.2#high" } } })
    // when: momus resolves via chain (openai rung first), oracle via override
    const plan = buildRegisteredAgents({
      inventory: INVENTORY,
      config,
      connectedProviders: new Set(["openai"]),
      baseDir: makeProject(),
    })
    // then
    const oracle = plan.agents.find((agent) => agent.id === "oracle")
    const momus = plan.agents.find((agent) => agent.id === "momus")
    expect(oracle?.model).toEqual({ providerID: "zai-coding-plan", modelID: "glm-5.2", variant: "high" })
    expect(momus?.model).toEqual({ providerID: "openai", modelID: "gpt-6-astra", variant: "xhigh" })
  })

  it("leaves models unset when no rung provider is available", () => {
    // given / when
    const plan = buildRegisteredAgents({
      inventory: INVENTORY,
      config: makeConfig({}),
      connectedProviders: new Set(["deepseek"]),
      baseDir: makeProject(),
    })
    // then
    expect(plan.agents.every((agent) => agent.model === undefined)).toBe(true)
  })
})
