/**
 * Browsers cannot emit WebSocket control frames, so liveness relies on the
 * application level heartbeat the client sends every 25 seconds. Allow three
 * missed beats before a connection is treated as gone: anything that vanished
 * without a close frame (backgrounded tab, dropped network, killed process)
 * would otherwise be counted forever.
 */
export const HEARTBEAT_TIMEOUT_MS = 90_000

export interface LiveConnectionState {
  visitId: string
  lastSeenAt: number
}

export interface LiveConnection<Socket> {
  socket: Socket
  state: LiveConnectionState
}

export interface LiveConnectionPartition<Socket> {
  online: number
  stale: Socket[]
}

/** Counts distinct visitors that still beat, and reports the sockets to evict. */
export function partitionConnections<Socket>(
  connections: Array<LiveConnection<Socket>>,
  now: number,
): LiveConnectionPartition<Socket> {
  const visitors = new Set<string>()
  const stale: Socket[] = []

  for (const { socket, state } of connections) {
    if (state.visitId && now - state.lastSeenAt <= HEARTBEAT_TIMEOUT_MS) {
      visitors.add(state.visitId)
    } else {
      stale.push(socket)
    }
  }

  return { online: visitors.size, stale }
}
