/**
 * [OMC] v2 think mode — reasoning variant raise.
 *
 * Ports the decision half of the V1 `hooks/think-mode/switcher.ts`: when the
 * user's message carries a think keyword, the session's reasoning variant is
 * raised to `high` unless the model is already at high or above.
 *
 * V1 mapped model ids to `*-high` catalog entries and set a per-message
 * `variant` field; v2 carries the variant on the session's `Model.Ref`
 * (`{ id, providerID, variant? }`), so "already high+" means:
 *
 *   - the current variant is `high`, `xhigh` or `max` (the v2 reasoning
 *     ladder tops out at `max`), or
 *   - the model id itself is a high catalog entry (`…-high`, the exact shape
 *     of every value in the V1 `HIGH_VARIANT_MAP`), after the V1
 *     `normalizeModelID` dots-to-hyphens normalization and provider-prefix
 *     strip.
 */

/** Reasoning variants at or above the `high` tier. */
const HIGH_OR_ABOVE_VARIANTS = new Set(["high", "xhigh", "max"])

/** V1 `normalizeModelID`: dots before digits become hyphens (`gpt-5.4` → `gpt-5-4`). */
function normalizeModelID(modelID: string): string {
  return modelID.replace(/\.(\d+)/g, "-$1")
}

/** Strip a provider/route prefix (`vertex_ai/claude-…`, `aws/anthropic/claude-…`). */
function baseModelID(modelID: string): string {
  const slashIndex = modelID.lastIndexOf("/")
  return slashIndex === -1 ? modelID : modelID.slice(slashIndex + 1)
}

export function isAlreadyHighVariant(modelID: string, variant?: string): boolean {
  if (variant !== undefined && HIGH_OR_ABOVE_VARIANTS.has(variant)) return true
  return baseModelID(normalizeModelID(modelID)).endsWith("-high")
}
