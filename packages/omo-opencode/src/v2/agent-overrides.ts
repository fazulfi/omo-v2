import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { AGENT_MODEL_REQUIREMENTS, normalizeReasoning } from "@oh-my-opencode/model-core"
import { isWithinProject } from "@oh-my-opencode/utils"
import type { AgentOverrideConfig } from "../config/schema/agent-overrides"
import type { AgentDefinition, AgentMode, PermissionRule } from "./agents"
import type { OmoConfig } from "./config"

/**
 * [OMC] v2 agent-override application (omo.json `agents.<id>`).
 *
 * Closes the port's biggest parity gap: the `AgentOverridesSchema` config layer
 * was parsed but consumed by nothing except the ultrawork model override. This
 * module applies `agents.<id>` onto the static v2 agent inventory before
 * registration (`src/v2/agents.ts` `registerAgents`).
 *
 * V1 ancestors (deleted in d6096afe2, task 18):
 *   - `agents/builtin-agents/resolve-file-uri.ts` → `resolveFileUriSource`
 *     (file:// decoding, `~/` expansion, allowed-paths gate, warning placeholders)
 *   - `agents/builtin-agents/agent-overrides.ts` → `applyAgentOverride`
 *     (identity fields, prompt replacement/append, append with "\n" separator)
 *
 * Model resolution (V1 `model-resolution-pipeline` reduced to the v2 surface):
 *   1. user override `model` `"provider/model[#variant]"` wins (format-validated),
 *   2. else the first `AGENT_MODEL_REQUIREMENTS[agent]` chain rung whose
 *      provider is available (`ctx.provider.list()` in v2 lists available
 *      providers: enabled OR connected),
 *   3. else unset (the agent inherits the session model).
 *
 * Out of scope (no `Agent.Info` equivalent or unported subsystem): category
 * inheritance, `models`/`fallback_models` chains, tuning fields, the root
 * `disabled_agents` key, and the V1 user/project config merge walk.
 */

// ---------------------------------------------------------------------------
// file:// URI resolution (V1 `resolve-file-uri.ts` parity, sync fs)
// ---------------------------------------------------------------------------

const ALLOWED_HOME_SUBDIRS = [
  join(homedir(), ".config", "opencode"),
  join(homedir(), ".config", "oh-my-openagent"),
  join(homedir(), ".omo"),
  join(homedir(), ".opencode"),
] as const

function isWithinAllowedPaths(filePath: string, projectRoot: string): boolean {
  if (isWithinProject(filePath, projectRoot)) return true
  for (const dir of ALLOWED_HOME_SUBDIRS) {
    if (isWithinProject(filePath, dir)) return true
  }
  return false
}

/**
 * Resolves a `file://` prompt source to file contents. Non-file:// values pass
 * through unchanged. Failures never throw: a `[WARNING: …]` placeholder is
 * returned instead (V1 parity — the agent still boots with a visible notice).
 */
export function resolveFileUriSource(value: string, baseDir: string): string {
  if (!value.startsWith("file://")) return value

  const encoded = value.slice(7)

  let filePath: string
  try {
    const decoded = decodeURIComponent(encoded)
    const expanded = decoded.startsWith("~/") ? decoded.replace(/^~\//, `${homedir()}/`) : decoded
    filePath = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded)
  } catch {
    return `[WARNING: Malformed file URI (invalid percent-encoding): ${value}]`
  }

  if (!isWithinAllowedPaths(filePath, baseDir)) {
    console.error("[OMC] agent-overrides: rejected file URI outside allowed paths", {
      value,
      filePath,
      baseDir,
    })
    return `[WARNING: Path rejected: ${value} (resolved outside project root ${baseDir} and allowed home directories; file:// prompts must reside within the project directory, ~/.config/opencode/, ~/.config/oh-my-openagent/, ~/.omo/, or ~/.opencode/)]`
  }

  if (!existsSync(filePath)) {
    return `[WARNING: Could not resolve file URI: ${value}]`
  }

  try {
    return readFileSync(filePath, "utf8")
  } catch {
    return `[WARNING: Could not read file: ${value}]`
  }
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

export interface ResolvedAgentModel {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

/**
 * Parses `"provider/model[#variant]"`. Returns `undefined` on a malformed spec
 * (no provider segment, empty model, empty variant). The variant is normalized
 * through the OMO reasoning vocabulary (`none` → `off`), unknown tokens pass
 * through (variants are free strings on `Agent.Info.model`).
 */
export function parseAgentModelSpec(spec: string): ResolvedAgentModel | undefined {
  const trimmed = spec.trim()
  if (!trimmed) return undefined

  const hashIndex = trimmed.indexOf("#")
  const modelPart = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex)
  const variantPart = hashIndex === -1 ? undefined : trimmed.slice(hashIndex + 1).trim()

  const parts = modelPart.split("/")
  if (parts.length < 2) return undefined
  const providerID = parts[0]?.trim()
  const modelID = parts.slice(1).join("/").trim()
  if (!providerID || !modelID) return undefined

  if (variantPart === undefined || variantPart === "") {
    return { providerID, modelID }
  }
  const normalized = normalizeReasoning(variantPart)
  return { providerID, modelID, variant: normalized.level ?? normalized.passthrough }
}

/**
 * User override model wins (format-validated only — the v2 surface has no
 * available-models cache to cross-check). Otherwise walk the hardcoded
 * `AGENT_MODEL_REQUIREMENTS` chain and take the first rung with an available
 * provider. `undefined` (inherit the session model) when nothing matches.
 */
export function resolveAgentModel(
  override: AgentOverrideConfig | undefined,
  agentID: string,
  connectedProviders: ReadonlySet<string>,
): ResolvedAgentModel | undefined {
  const overrideSpec = override?.model?.trim()
  if (overrideSpec) {
    const parsed = parseAgentModelSpec(overrideSpec)
    if (parsed) return parsed
    console.error(
      `[OMC] agent-overrides: agents.${agentID}.model "${overrideSpec}" is not "provider/model[#variant]"; ignoring`,
    )
  }

  const requirement = AGENT_MODEL_REQUIREMENTS[agentID]
  if (!requirement) return undefined
  for (const rung of requirement.fallbackChain) {
    const providerID = rung.providers.find((provider) => connectedProviders.has(provider))
    if (providerID === undefined) continue
    const variant = rung.variant ?? requirement.variant
    return { providerID, modelID: rung.model, ...(variant ? { variant } : {}) }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Override application
// ---------------------------------------------------------------------------

function permissionRulesFromTools(tools: Record<string, boolean>): PermissionRule[] {
  return Object.entries(tools).map(([tool, allow]) => ({
    action: tool,
    resource: "*",
    effect: allow ? ("allow" as const) : ("deny" as const),
  }))
}

/**
 * Applies one `agents.<id>` override onto a static agent definition.
 * Returns `undefined` when the override disables the agent.
 */
export function applyAgentOverride(
  def: AgentDefinition,
  override: AgentOverrideConfig | undefined,
  baseDir: string,
): AgentDefinition | undefined {
  if (override?.disable) return undefined
  if (!override) return def

  let next: AgentDefinition = { ...def }
  if (override.displayName !== undefined) next = { ...next, name: override.displayName }
  if (override.description !== undefined) next = { ...next, description: override.description }
  if (override.mode !== undefined) next = { ...next, mode: override.mode as AgentMode }
  if (override.color !== undefined) next = { ...next, color: override.color }

  if (override.prompt !== undefined) {
    next = { ...next, system: resolveFileUriSource(override.prompt, baseDir) }
  }
  if (override.prompt_append !== undefined) {
    next = { ...next, system: `${next.system}\n${resolveFileUriSource(override.prompt_append, baseDir)}` }
  }

  // Appended AFTER the definition's own rules so a `false` (deny) entry wins
  // over an earlier allow for the same action; BASE_PERMISSIONS semantics are
  // untouched (fixed in 60edaf6c5).
  if (override.tools !== undefined) {
    next = {
      ...next,
      permissions: [...(next.permissions ?? []), ...permissionRulesFromTools(override.tools)],
    }
  }

  return next
}

// ---------------------------------------------------------------------------
// Inventory assembly
// ---------------------------------------------------------------------------

export interface RegisteredAgentPlan {
  /** Override-applied definitions, in inventory order; disabled agents removed. */
  readonly agents: readonly AgentDefinition[]
  /** Agent ids skipped because `agents.<id>.disable` is true. */
  readonly disabled: readonly string[]
  /** Configured override keys with no matching v2 agent (schema is catchall). */
  readonly unapplied: readonly string[]
}

export function buildRegisteredAgents(input: {
  readonly inventory: readonly AgentDefinition[]
  readonly config: OmoConfig | null
  readonly connectedProviders: ReadonlySet<string>
  readonly baseDir: string
}): RegisteredAgentPlan {
  const overrides = input.config?.agents as Record<string, AgentOverrideConfig | undefined> | undefined

  const agents: AgentDefinition[] = []
  const disabled: string[] = []
  const known = new Set(input.inventory.map((def) => def.id))

  for (const def of input.inventory) {
    const override = overrides?.[def.id]
    const applied = applyAgentOverride(def, override, input.baseDir)
    if (applied === undefined) {
      disabled.push(def.id)
      continue
    }
    const model = resolveAgentModel(override, def.id, input.connectedProviders)
    agents.push(model ? { ...applied, model } : applied)
  }

  const unapplied = overrides ? Object.keys(overrides).filter((key) => !known.has(key)) : []
  return { agents, disabled, unapplied }
}
