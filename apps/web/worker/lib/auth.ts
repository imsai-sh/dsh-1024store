export const SESSION_COOKIE = 'dsh_session'
export const OAUTH_STATE_COOKIE = 'dsh_oauth_state'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const API_KEY_PREFIX = 'dsh_live_'
export const API_KEY_RANDOM_BYTES = 20
export const MAX_ACTIVE_KEYS_PER_USER = 5
export const MAX_API_KEY_NAME_LENGTH = 100

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_USER_AGENT = 'dsh-1024store'

export interface ApiUser {
  id: number
  githubId: number
  githubLogin: string
  githubName: string | null
  avatarUrl: string | null
}

export interface ApiKeySummary {
  id: number
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

export interface GitHubProfile {
  id: number
  login: string
  name: string | null
  avatarUrl: string | null
}

export class GitHubOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubOAuthError'
  }
}

export class ApiKeyLimitError extends Error {
  constructor() {
    super('Active API key limit reached.')
    this.name = 'ApiKeyLimitError'
  }
}

export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return [...buffer].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

/** Constant-time string comparison so tokens cannot be probed byte by byte. */
export function timingSafeEqualStrings(expected: string, presented: string): boolean {
  const encoder = new TextEncoder()
  const expectedBytes = encoder.encode(expected)
  const presentedBytes = encoder.encode(presented)
  let difference = expectedBytes.length ^ presentedBytes.length
  const length = Math.max(expectedBytes.length, presentedBytes.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (expectedBytes[index] ?? 0) ^ (presentedBytes[index] ?? 0)
  }
  return difference === 0
}

/**
 * Only same-site absolute paths survive; anything else falls back to the root.
 * Control characters are rejected so the value can never smuggle CR/LF into a
 * Location header, and `//evil.example` is rejected before it can be read as a
 * protocol-relative URL.
 */
export function sanitizeReturnTo(value: string | undefined): string {
  if (!value || value.length > 512) return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  if ([...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return '/'
  return value
}

export function buildGitHubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeGitHubCode(
  fetcher: typeof fetch,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetcher(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': GITHUB_USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!response.ok) {
    throw new GitHubOAuthError(`GitHub token exchange failed with HTTP ${response.status}.`)
  }
  const payload = (await response.json()) as { access_token?: unknown; error?: unknown }
  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new GitHubOAuthError(
      typeof payload.error === 'string' ? `GitHub rejected the code: ${payload.error}.` : 'GitHub returned no access token.',
    )
  }
  return payload.access_token
}

export async function fetchGitHubProfile(fetcher: typeof fetch, accessToken: string): Promise<GitHubProfile> {
  const response = await fetcher(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': GITHUB_USER_AGENT,
    },
  })
  if (!response.ok) {
    throw new GitHubOAuthError(`GitHub profile request failed with HTTP ${response.status}.`)
  }
  const payload = (await response.json()) as {
    id?: unknown
    login?: unknown
    name?: unknown
    avatar_url?: unknown
  }
  if (typeof payload.id !== 'number' || typeof payload.login !== 'string' || payload.login.length === 0) {
    throw new GitHubOAuthError('GitHub profile response is malformed.')
  }
  return {
    id: payload.id,
    login: payload.login,
    name: typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : null,
    avatarUrl: typeof payload.avatar_url === 'string' && payload.avatar_url.length > 0 ? payload.avatar_url : null,
  }
}

interface ApiUserRow {
  id: number
  github_id: number
  github_login: string
  github_name: string | null
  avatar_url: string | null
}

function toApiUser(row: ApiUserRow): ApiUser {
  return {
    id: row.id,
    githubId: row.github_id,
    githubLogin: row.github_login,
    githubName: row.github_name,
    avatarUrl: row.avatar_url,
  }
}

export async function upsertGitHubUser(
  db: D1Database,
  profile: GitHubProfile,
  now: string,
): Promise<ApiUser> {
  const row = await db.prepare(
    `INSERT INTO api_users (github_id, github_login, github_name, avatar_url, created_at, updated_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(github_id) DO UPDATE SET
       github_login = excluded.github_login,
       github_name = excluded.github_name,
       avatar_url = excluded.avatar_url,
       updated_at = excluded.updated_at,
       last_login_at = excluded.last_login_at
     RETURNING id, github_id, github_login, github_name, avatar_url`,
  ).bind(profile.id, profile.login, profile.name, profile.avatarUrl, now, now, now)
    .first<ApiUserRow>()
  if (!row) throw new Error('GitHub user upsert returned no row.')
  return toApiUser(row)
}

export async function createSession(
  db: D1Database,
  userId: number,
  nowMs: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomHex(32)
  const expiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString()
  await db.prepare(
    `INSERT INTO api_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
  ).bind(await sha256Hex(token), userId, new Date(nowMs).toISOString(), expiresAt).run()
  return { token, expiresAt }
}

export async function getSessionUser(
  db: D1Database,
  token: string,
  nowMs: number,
): Promise<ApiUser | null> {
  const row = await db.prepare(
    `SELECT u.id, u.github_id, u.github_login, u.github_name, u.avatar_url
     FROM api_sessions s
     JOIN api_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256Hex(token), new Date(nowMs).toISOString()).first<ApiUserRow>()
  return row ? toApiUser(row) : null
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM api_sessions WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .run()
}

interface ApiKeyRow {
  id: number
  name: string
  key_prefix: string
  created_at: string
  last_used_at: string | null
}

function toApiKeySummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

export async function listApiKeys(db: D1Database, userId: number): Promise<ApiKeySummary[]> {
  const result = await db.prepare(
    `SELECT id, name, key_prefix, created_at, last_used_at
     FROM api_keys
     WHERE user_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC, id DESC`,
  ).bind(userId).all<ApiKeyRow>()
  return result.results.map(toApiKeySummary)
}

export async function createApiKey(
  db: D1Database,
  userId: number,
  name: string,
  now: string,
): Promise<ApiKeySummary & { key: string }> {
  const active = await db.prepare(
    'SELECT COUNT(*) AS key_count FROM api_keys WHERE user_id = ? AND revoked_at IS NULL',
  ).bind(userId).first<{ key_count: number | string }>()
  if (Number(active?.key_count ?? 0) >= MAX_ACTIVE_KEYS_PER_USER) {
    throw new ApiKeyLimitError()
  }

  const key = `${API_KEY_PREFIX}${randomHex(API_KEY_RANDOM_BYTES)}`
  const keyPrefix = key.slice(0, API_KEY_PREFIX.length + 6)
  const row = await db.prepare(
    `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, created_at)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, name, key_prefix, created_at, last_used_at`,
  ).bind(userId, await sha256Hex(key), keyPrefix, name, now).first<ApiKeyRow>()
  if (!row) throw new Error('API key insert returned no row.')
  return { ...toApiKeySummary(row), key }
}

export async function revokeApiKey(
  db: D1Database,
  userId: number,
  keyId: number,
  now: string,
): Promise<boolean> {
  const result = await db.prepare(
    'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  ).bind(now, keyId, userId).run()
  return (result.meta.changes ?? 0) > 0
}

export async function authenticateApiKey(
  db: D1Database,
  key: string,
  nowMs: number,
): Promise<{ keyId: number; userId: number } | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null
  const row = await db.prepare(
    'SELECT id, user_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
  ).bind(await sha256Hex(key)).first<{ id: number; user_id: number }>()
  if (!row) return null
  await db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    .bind(new Date(nowMs).toISOString(), row.id)
    .run()
  return { keyId: row.id, userId: row.user_id }
}

/** Weekly maintenance: expired sessions and rate-limit counters older than two days. */
export async function cleanupExpiredAuthRows(db: D1Database, nowMs: number): Promise<void> {
  const nowIso = new Date(nowMs).toISOString()
  await db.batch([
    db.prepare('DELETE FROM api_sessions WHERE expires_at <= ?').bind(nowIso),
    db.prepare('DELETE FROM api_request_counters WHERE bucket_start < ?')
      .bind(nowMs - 2 * 24 * 60 * 60 * 1000),
  ])
}
