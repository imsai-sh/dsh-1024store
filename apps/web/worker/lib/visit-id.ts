/**
 * The visit identifier crosses the client/worker boundary: the browser mints it
 * and the Durable Object validates it before accepting the socket. Both halves
 * live here so the format can only ever be changed in one place.
 */
export const VISIT_ID_PATTERN = /^[A-Za-z0-9-]{16,80}$/

/**
 * crypto.randomUUID is secure-context only, so it is absent when the app is
 * served over plain HTTP — a LAN-IP dev build, for instance — and calling it
 * unguarded throws and takes the whole page down. getRandomValues carries no
 * such restriction; the arithmetic form is the last resort. Every branch stays
 * within VISIT_ID_PATTERN.
 */
export function newVisitId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  }
  const chunk = () => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  return `${chunk()}${chunk()}${chunk()}${chunk()}`
}
