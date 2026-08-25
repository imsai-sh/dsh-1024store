import { afterEach, describe, expect, it } from 'vitest'
import { HEARTBEAT_TIMEOUT_MS, partitionConnections } from '../worker/lib/live-connections'
import { newVisitId, VISIT_ID_PATTERN } from '../worker/lib/visit-id'

const NOW = 1_760_000_000_000

function connection(id: string, visitId: string, lastSeenAt: number) {
  return { socket: id, state: { visitId, lastSeenAt } }
}

describe('live connection accounting', () => {
  it('counts each visitor once regardless of how many tabs they open', () => {
    const result = partitionConnections(
      [
        connection('tab-a', 'visitor-1', NOW),
        connection('tab-b', 'visitor-1', NOW),
        connection('tab-c', 'visitor-1', NOW),
        connection('tab-d', 'visitor-2', NOW),
      ],
      NOW,
    )

    expect(result.online).toBe(2)
    expect(result.stale).toEqual([])
  })

  it('drops connections that stopped sending heartbeats', () => {
    const result = partitionConnections(
      [
        connection('fresh', 'visitor-1', NOW - 1_000),
        connection('zombie', 'visitor-2', NOW - HEARTBEAT_TIMEOUT_MS - 1),
      ],
      NOW,
    )

    expect(result.online).toBe(1)
    expect(result.stale).toEqual(['zombie'])
  })

  it('keeps a visitor online while any of their connections still beats', () => {
    const result = partitionConnections(
      [
        connection('backgrounded', 'visitor-1', NOW - HEARTBEAT_TIMEOUT_MS - 1),
        connection('foreground', 'visitor-1', NOW),
      ],
      NOW,
    )

    expect(result.online).toBe(1)
    expect(result.stale).toEqual(['backgrounded'])
  })

  it('treats a connection that never answered a heartbeat as live until it times out', () => {
    const result = partitionConnections(
      [
        connection('just-connected', 'visitor-1', NOW - HEARTBEAT_TIMEOUT_MS + 1_000),
        connection('never-answered', 'visitor-2', NOW - HEARTBEAT_TIMEOUT_MS - 1_000),
      ],
      NOW,
    )

    expect(result.online).toBe(1)
    expect(result.stale).toEqual(['never-answered'])
  })

  it('ignores connections without a usable visitor identity', () => {
    const result = partitionConnections([connection('anonymous', '', NOW)], NOW)

    expect(result.online).toBe(0)
    expect(result.stale).toEqual(['anonymous'])
  })
})

describe('visit identifier generation', () => {
  // The worker tsconfig types globalThis for the Workers runtime, which does not
  // declare `crypto` on it; the test swaps the global to exercise each fallback.
  const globals = globalThis as unknown as { crypto: Crypto }
  const realCrypto = globals.crypto

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true })
  })

  function withCrypto(value: unknown) {
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true })
  }

  it('uses randomUUID when the page is in a secure context', () => {
    expect(newVisitId()).toMatch(VISIT_ID_PATTERN)
  })

  it('falls back to getRandomValues when randomUUID is missing (plain HTTP)', () => {
    withCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
    const id = newVisitId()
    expect(id).toMatch(VISIT_ID_PATTERN)
    expect(id).toHaveLength(32)
  })

  it('still produces an accepted id when no Web Crypto is available at all', () => {
    withCrypto(undefined)
    const ids = new Set(Array.from({ length: 50 }, () => newVisitId()))
    for (const id of ids) expect(id).toMatch(VISIT_ID_PATTERN)
    expect(ids.size).toBe(50)
  })
})
