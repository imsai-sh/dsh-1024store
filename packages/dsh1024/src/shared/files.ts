/** Shared filesystem primitives for the 1024 Store state directory (locked, atomic). */

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mkdir, open, readdir, readFile, rename, rmdir, stat, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const LOCK_WAIT_TIMEOUT_MS = 30_000
const EMPTY_LOCK_STALE_MS = 1_000

export interface StorePaths {
  directory: string
  client: string
  pending: string
  receipts: string
  registryCache: string
  catalogPageCache: string
  preferences: string
}

export interface FileLockOptions {
  /** Test hook that runs after the lock directory exists but before this owner commits. */
  beforeOwnerCommit?: () => void | Promise<void>
}

function errno(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.DSH_HOME || join(homedir(), '.dsh'))
}

export function storePaths(dshHome: string): StorePaths {
  const directory = join(dshHome, '.dsh-1024store')
  return {
    directory,
    client: join(directory, 'client.json'),
    pending: join(directory, 'pending.json'),
    receipts: join(directory, 'receipts.json'),
    registryCache: join(directory, 'registry-cache.json'),
    catalogPageCache: join(directory, 'catalog-page-cache.json'),
    preferences: join(directory, 'preferences.json'),
  }
}

export async function readJson<T>(path: string, fallback: T | null = null): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if (errno(error) === 'ENOENT') return fallback
    throw error
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
}

export async function withFileLock<T>(
  path: string,
  callback: () => T | Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const lockDirectory = `${path}.lock`
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS
  let ownerPath: string | undefined
  let lastCreationError: unknown

  while (true) {
    try {
      await mkdir(lockDirectory, { mode: 0o700 })
    } catch (error) {
      if (!isTransientCreationError(error)) throw error
      lastCreationError = error
      // EEXIST means the directory is genuinely there, so it may be a stale lock
      // worth reaping. The Windows race codes mean the create itself was refused
      // and there is nothing to inspect yet — just back off and try again.
      if (errno(error) !== 'EEXIST' || !await removeStaleLock(lockDirectory)) {
        if (Date.now() >= deadline) {
          throw new Error(`timed out waiting for file lock: ${path} (last ${errno(lastCreationError)})`)
        }
        await delay(10 + Math.floor(Math.random() * 20))
      }
      continue
    }

    const candidate = join(lockDirectory, `${randomUUID()}.owner`)
    if (await installOwner(lockDirectory, candidate, options)) {
      ownerPath = candidate
      break
    }
    if (Date.now() >= deadline) throw new Error(`timed out acquiring file lock: ${path}`)
    await delay(10 + Math.floor(Math.random() * 20))
  }

  try {
    return await callback()
  } finally {
    await releaseOwnedLock(lockDirectory, ownerPath as string)
  }
}

async function installOwner(lockDirectory: string, ownerPath: string, options: FileLockOptions): Promise<boolean> {
  const temporaryOwner = `${lockDirectory}.${randomUUID()}.owner.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryOwner, 'wx', 0o600)
    try {
      await handle.writeFile(`${JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`)
    } finally {
      await handle.close()
      handle = undefined
    }
    if (typeof options.beforeOwnerCommit === 'function') await options.beforeOwnerCommit()
    await rename(temporaryOwner, ownerPath)
  } catch (error) {
    await handle?.close().catch(() => {})
    await unlinkIfPresent(temporaryOwner).catch(() => {})
    await releaseOwnedLock(lockDirectory, ownerPath).catch(() => {})
    if (errno(error) === 'ENOENT' || isLockRaceError(error)) return false
    throw error
  }

  try {
    const owners = (await readdir(lockDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.owner'))
    if (owners.length === 1 && join(lockDirectory, owners[0].name) === ownerPath) return true
  } catch (error) {
    // Could not confirm sole ownership; fall through and yield the lock.
    if (errno(error) !== 'ENOENT' && !isLockRaceError(error)) throw error
  }

  await releaseOwnedLock(lockDirectory, ownerPath)
  return false
}

async function removeStaleLock(lockDirectory: string): Promise<boolean> {
  let entries
  try {
    entries = await readdir(lockDirectory, { withFileTypes: true })
  } catch (error) {
    if (errno(error) === 'ENOENT') return true
    if (isLockRaceError(error)) return false
    throw error
  }

  const owners = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.owner'))
  if (owners.length === 0) {
    try {
      const metadata = await stat(lockDirectory)
      if (Date.now() - metadata.mtimeMs < EMPTY_LOCK_STALE_MS) return false
      await rmdir(lockDirectory)
      return true
    } catch (error) {
      if (errno(error) === 'ENOENT') return true
      if (isTransientRemovalError(error)) return false
      throw error
    }
  }

  const ownerPaths = owners.map((entry) => join(lockDirectory, entry.name))
  const staleStates = await Promise.all(ownerPaths.map(ownerIsStale))
  if (staleStates.some((state) => state !== true)) return false

  for (const ownerPath of ownerPaths) {
    try {
      await unlink(ownerPath)
    } catch (error) {
      if (errno(error) === 'ENOENT') return false
      if (isLockRaceError(error)) return false
      throw error
    }
  }

  try {
    await rmdir(lockDirectory)
    return true
  } catch (error) {
    if (errno(error) === 'ENOENT') return true
    if (isTransientRemovalError(error)) return false
    throw error
  }
}

// Windows reports a lock path that is racing another process as EPERM/EBUSY
// from whichever syscall touched it — mkdir, readdir, stat, unlink, rmdir or
// rename alike — where POSIX would report ENOENT or EEXIST. The usual cause is
// a directory still in a pending-delete state because its previous owner just
// released it; open handles and antivirus scans do the same. Every operation on
// a lock therefore has to read these as "busy, look again" rather than as a
// hard failure. A genuine permission problem still surfaces: acquisition
// exhausts its wait and the timeout message carries the underlying code.
function isLockRaceError(error: unknown): boolean {
  const code = errno(error)
  return code === 'EPERM' || code === 'EBUSY'
}

function isTransientRemovalError(error: unknown): boolean {
  const code = errno(error)
  return code === 'ENOTEMPTY' || code === 'EEXIST' || isLockRaceError(error)
}

function isTransientCreationError(error: unknown): boolean {
  return errno(error) === 'EEXIST' || isLockRaceError(error)
}

async function ownerIsStale(ownerPath: string): Promise<boolean | null> {
  let metadata!: Awaited<ReturnType<typeof stat>>
  let owner: { pid?: unknown } | null
  try {
    [metadata, owner] = await Promise.all([
      stat(ownerPath),
      readFile(ownerPath, 'utf8').then((content) => JSON.parse(content) as { pid?: unknown }).catch(() => null),
    ])
  } catch (error) {
    if (errno(error) === 'ENOENT') return null
    // Staleness is indeterminable while the path is contended; treat the lock
    // as live so nobody reaps an owner that may still be running.
    if (isLockRaceError(error)) return null
    throw error
  }

  const pid = owner?.pid
  if (Number.isInteger(pid) && (pid as number) > 0) {
    try {
      process.kill(pid as number, 0)
      return false
    } catch (error) {
      if (errno(error) === 'ESRCH' || errno(error) === 'EINVAL') return true
      return false
    }
  }
  return Date.now() - metadata.mtimeMs >= EMPTY_LOCK_STALE_MS
}

async function releaseOwnedLock(lockDirectory: string, ownerPath: string): Promise<void> {
  try {
    await unlink(ownerPath)
  } catch (error) {
    if (errno(error) === 'ENOENT') return
    // This runs from withFileLock's finally, so throwing would replace the
    // caller's own result with a teardown error. Fall through to the rmdir
    // retries; anything left behind is reaped by the stale-lock path.
    if (!isLockRaceError(error)) throw error
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rmdir(lockDirectory)
      return
    } catch (error) {
      if (errno(error) === 'ENOENT') return
      if (!isTransientRemovalError(error)) throw error
      await delay(20 * (attempt + 1))
    }
  }
}

export async function unlinkIfPresent(path: string): Promise<boolean> {
  try {
    await unlink(path)
    return true
  } catch (error) {
    if (errno(error) === 'ENOENT') return false
    throw error
  }
}
