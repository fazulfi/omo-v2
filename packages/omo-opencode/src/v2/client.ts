/**
 * [OMC] v2 client layer — server connection + HTTP client + event subscription
 * (task 11). Ports the V1 SDK client usage to `@opencode/client` 2.0.20.
 *
 * V1 → V2 mapping (source of truth: docs/v2-api-mapping.md §2.2, gap G6/G7):
 *
 *   createOpencodeClient({ baseUrl })  →  OpenCode.make({ baseUrl, ... })
 *   createOpencode({ signal, port, hostname }) →  Service.discover/ensure/stop
 *       (no direct per-port spawn; V2 owns the local service lifecycle via the
 *        XDG registration file — see gap G6)
 *   client.event (Event stream)        →  client.event.subscribe() → V2Event
 *   OpencodeClient (type)              →  OpenCodeClient
 *   Event / SessionStatusData / …      →  OpenCodeEvent (V2Event) + generated types
 *   V1 SDK bridge subpath              →  direct @opencode/client (gap G7)
 *
 * Event names were cross-checked against the installed 2.0.20 `.d.ts`
 * (`dist/promise/generated/types.d.ts`, `V2Event` union) — see
 * `./client-events.ts` for the full catalog and V1→V2 mapping table.
 */

import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import type {
  AgentGetOutput,
  AgentListOutput,
  OpenCodeClient,
  OpenCodeEvent,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStatus,
} from "@opencode/client"
import type {
  DiscoverOptions,
  Endpoint,
  EnsureOptions,
  StopOptions,
} from "@opencode/client/service"

export type {
  AgentGetOutput,
  AgentListOutput,
  OpenCodeClient,
  OpenCodeEvent,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageUser,
  SessionStatus,
} from "@opencode/client"
export type {
  DiscoverOptions,
  Endpoint,
  EnsureOptions,
  StopOptions,
} from "@opencode/client/service"
export {
  V1_TO_V2_EVENT,
  V2_EVENT_NAMES,
  V2_EVENT_RPC_WILDCARD,
  isV2EventName,
  mapV1EventToV2,
} from "./client-events"
export type { V1EventName, V1ToV2EventEntry, V2EventName } from "./client-events"

const DEFAULT_SERVICE_USERNAME = "opencode"

function basicAuthHeader(username: string, password: string): { authorization: string } {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64")
  return { authorization: `Basic ${token}` }
}

/**
 * Builds an Authorization header from the V1-compatible
 * `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` env vars, or
 * `undefined` when no password is configured. Kept for parity with the V1
 * `getServerBasicAuthHeader()` path (attach-to-URL without a discovered
 * endpoint).
 */
export function basicAuthHeaderFromEnv(): { authorization: string } | undefined {
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!password) {
    return undefined
  }
  const username = process.env.OPENCODE_SERVER_USERNAME ?? DEFAULT_SERVICE_USERNAME
  return basicAuthHeader(username, password)
}

/**
 * Options for {@link createClient} — mirrors `@opencode/client` `ClientOptions`.
 */
export type CreateClientOptions = {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  /**
   * HTTP headers (typically an `Authorization` header). When omitted, a Basic
   * auth header is derived from `OPENCODE_SERVER_PASSWORD` if set.
   */
  readonly headers?: RequestInit["headers"]
}

/**
 * Creates an HTTP client bound to an OpenCode server. Padanan V1
 * `createOpencodeClient({ baseUrl })`.
 */
export function createClient(options: CreateClientOptions): OpenCodeClient {
  const headers = options.headers ?? basicAuthHeaderFromEnv()
  return OpenCode.make({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    headers,
  })
}

/**
 * Creates an HTTP client from a discovered/ensured service {@link Endpoint},
 * wiring the service's Basic auth through `Service.headers`. Padanan V1
 * `createOpencodeClient` + `injectServerAuthIntoClient` for the spawned
 * service path.
 */
export function createClientFromEndpoint(endpoint: Endpoint): OpenCodeClient {
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
  })
}

/**
 * Attaches to an already-running server at an explicit URL (V1 `--attach`).
 * Uses the env Basic auth header when no explicit headers are provided.
 */
export function attachClient(options: CreateClientOptions): OpenCodeClient {
  return createClient(options)
}

/**
 * Options for {@link createServerConnection}.
 */
export type ServerConnectionOptions = {
  /** Attach to an existing server URL instead of discovering/spawning a local service. */
  readonly attach?: string
  /** Pass-through options for {@link Service.discover}/{@link Service.ensure}. */
  readonly ensure?: EnsureOptions
}

/**
 * A live server connection: the HTTP client plus the means to stop the local
 * service it is bound to.
 */
export type ServerConnection = {
  readonly client: OpenCodeClient
  readonly url: string
  /** Set when the connection was ensured/discovered (not an external attach). */
  readonly endpoint?: Endpoint
  readonly cleanup: () => Promise<void>
}

/**
 * Ensures a healthy, compatible local OpenCode service is running (discovering
 * an existing one or spawning `opencode serve --service`), then binds a client
 * to it. Padanan V1 `createOpencode({ signal, port, hostname })` + attach flow
 * (gap G6: V2 has no per-port spawn; lifecycle is `Service.ensure/stop`).
 *
 * @example
 * const conn = await createServerConnection({})
 * const sessions = await conn.client.session.list()
 * // ... when done:
 * await conn.cleanup()
 */
export async function createServerConnection(
  options: ServerConnectionOptions,
): Promise<ServerConnection> {
  if (options.attach !== undefined) {
    const client = attachClient({ baseUrl: options.attach })
    return { client, url: options.attach, cleanup: async () => {} }
  }

  const endpoint = await Service.ensure(options.ensure)
  const client = createClientFromEndpoint(endpoint)
  return {
    client,
    url: endpoint.url,
    endpoint,
    cleanup: async () => {
      await Service.stop()
    },
  }
}

/**
 * Discovers a healthy, compatible local service without starting one.
 * Returns `undefined` when none is running.
 */
export function discoverService(options?: DiscoverOptions): Promise<Endpoint | undefined> {
  return Service.discover(options)
}

/**
 * Stops the registered local service.
 */
export async function stopService(options?: StopOptions): Promise<void> {
  await Service.stop(options)
}

/**
 * Options for {@link subscribeEvents}.
 */
export type SubscribeOptions = {
  readonly signal?: AbortSignal
  /** Reports transport activity, including keepalive frames that carry no event. */
  readonly onActivity?: () => void
}

/**
 * Subscribes to the server's shared event stream. Padanan V1 SDK `Event`
 * stream subscription; yields `OpenCodeEvent` (`V2Event`) values.
 *
 * @example
 * for await (const event of subscribeEvents(client, { signal })) {
 *   if (event.type === "session.idle") { ... }
 * }
 */
export function subscribeEvents(
  client: OpenCodeClient,
  options?: SubscribeOptions,
): AsyncIterable<OpenCodeEvent> {
  return client.event.subscribe(options)
}
