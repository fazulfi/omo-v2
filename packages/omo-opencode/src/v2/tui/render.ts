import { jsx, jsxs } from "@opentui/solid/jsx-runtime"
import type { JSX } from "@opentui/solid/jsx-runtime"

import type { ViewNode } from "../../features/tui-sidebar/element-helpers"

/**
 * [OMC] v2 TUI render bridge (task 15).
 *
 * Ports the V1 `materialize`/`materializeNode` helpers from `src/tui.ts`
 * (which used the imperative `SolidRuntime<Node>` shape — `createElement`,
 * `setProp`, `insert`) onto the declarative V2 slot model. In V2 a slot
 * claim's `render` must return a `JSX.Element` (`@opentui/solid`), so the
 * imperative `ViewNode` tree produced by
 * `features/tui-sidebar/render-view.ts` (`buildViewNodes`) is converted to
 * `@opentui/solid` intrinsic `<box>` / `<text>` elements via the OpenTUI JSX
 * runtime factory (`jsx` / `jsxs`).
 *
 * The OpenTUI reconciler treats the string tags `"box"` and `"text"` as
 * intrinsic renderables — identical to what V1 produced with
 * `solid.createElement("box")` / `solid.createElement("text")`.
 */

function materializeNode(node: ViewNode): JSX.Element {
  if (node.kind === "text") {
    return jsx("text", { ...node.props, children: node.text ?? "" })
  }
  const children = (node.children ?? []).map(materializeNode)
  return jsxs("box", { ...node.props, children })
}

/**
 * Wraps a `ViewNode[]` list (the `buildViewNodes` output) in a single column
 * `<box>` — the same root shape V1 `materialize` produced.
 */
export function materializeNodes(nodes: readonly ViewNode[]): JSX.Element {
  return jsxs("box", {
    flexDirection: "column",
    children: nodes.map(materializeNode),
  })
}
