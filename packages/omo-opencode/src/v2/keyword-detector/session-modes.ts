import type { KeywordType } from "../../config/schema/keyword-detector"

/**
 * [OMC] v2 per-session mode state.
 *
 * V1 kept this state inside the keyword-detector hook closure (a default-mode
 * set plus an explicit-ultrawork map, both capped at 256 sessions with LRU
 * eviction). The V2 port keeps the same shape so a long-lived session cannot
 * grow the map without bound.
 */

export const MAX_TRACKED_SESSIONS = 256

export interface SessionModeState {
  /** Keyword types armed for this session. */
  readonly modes: Set<KeywordType>
  /** The session was compacted, so the directive has to be restored. */
  needsRestoration: boolean
}

export class SessionModeStore {
  private readonly sessions = new Map<string, SessionModeState>()

  private evictIfNeeded(): void {
    while (this.sessions.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.sessions.keys().next()
      if (oldest.done) return
      this.sessions.delete(oldest.value)
    }
  }

  get(sessionID: string): SessionModeState | undefined {
    const state = this.sessions.get(sessionID)
    if (!state) return undefined
    // Refresh the LRU position.
    this.sessions.delete(sessionID)
    this.sessions.set(sessionID, state)
    return state
  }

  arm(sessionID: string, types: readonly KeywordType[]): void {
    if (types.length === 0) return
    const state = this.sessions.get(sessionID) ?? { modes: new Set<KeywordType>(), needsRestoration: false }
    for (const type of types) state.modes.add(type)
    this.sessions.delete(sessionID)
    this.sessions.set(sessionID, state)
    this.evictIfNeeded()
  }

  markNeedsRestoration(sessionID: string): void {
    const state = this.sessions.get(sessionID)
    if (!state) return
    state.needsRestoration = true
  }

  clear(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  /** Every tracked session with its armed modes, in LRU order. */
  entries(): IterableIterator<[string, SessionModeState]> {
    return this.sessions.entries()
  }

  get size(): number {
    return this.sessions.size
  }
}
