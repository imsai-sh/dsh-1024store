/**
 * Shared asynchronous install runner used by both the dsh1024 CLI and the
 * in-app 1024 Store plugin. The official CLI invocation is injected by each
 * caller: the CLI passes an `npx --yes @deepseek-ai/dsh` prefix while the
 * plugin reuses the running dsh entry. The runner always spawns asynchronously;
 * it must never use spawnSync, which would freeze the harness event loop.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

const TARGET_RE = /^[A-Za-z0-9@:/._#+-]+$/
const CAPTURE_LIMIT_BYTES = 64 * 1024

/** How to start the official DSH CLI, minus the plugin subcommand itself. */
export interface InstallInvocation {
  file: string
  prefixArgs: string[]
  cwd?: string
  useShell?: boolean
}

export interface RunPluginCommandOptions {
  /** CLI passes `npx --yes @deepseek-ai/dsh`; the plugin reuses the running dsh entry. */
  invocation: InstallInvocation
  action: 'add' | 'remove'
  profile: string
  target: string
  extraArgs?: string[]
  /** CLI uses `inherit`; the plugin uses `capture` (64KB rolling buffers). */
  stdio: 'inherit' | 'capture'
  /** The plugin passes five minutes; the CLI sets no timeout. */
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  /** Progress callback fed the last meaningful line of each captured chunk. */
  onLine?: (line: string) => void
  /** Test injection point for the child process implementation. */
  spawnImpl?: typeof spawn
}

export interface RunOfficialCommandOptions {
  invocation: InstallInvocation
  /** Argument vector appended to the invocation, verbatim. */
  args: string[]
  stdio: 'inherit' | 'capture'
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  onLine?: (line: string) => void
  spawnImpl?: typeof spawn
}

export interface RunPluginCommandResult {
  /** Exit code of the official CLI; null when it could not run or was killed. */
  exitCode: number | null
  timedOut: boolean
  /** Spawn failure message; null when the process started normally. */
  error: string | null
  stdout: string
  stderr: string
}

/** Extract the last meaningful line of one output chunk, capped for status previews. */
function lastOutputLine(text: string): string {
  return text.split('\n').map(line => line.trim()).filter(Boolean).at(-1)?.slice(0, 240) ?? ''
}

function stopChild(child: ChildProcess, spawnImpl: typeof spawn): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    const killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    killer.once('error', () => { child.kill('SIGKILL') })
    return
  }
  child.kill('SIGKILL')
}

/**
 * Run one official `dsh plugin --profile <profile> <action> <target>` mutation.
 * @param options - injected invocation plus the plugin mutation to perform.
 * @returns the exit code with captured output; never rejects.
 */
export function runPluginCommand(options: RunPluginCommandOptions): Promise<RunPluginCommandResult> {
  const { invocation, action, profile, target, extraArgs = [] } = options
  if (!TARGET_RE.test(target)) {
    return Promise.resolve({ exitCode: 1, timedOut: false, error: null, stdout: '', stderr: 'unsafe plugin target' })
  }
  return runOfficialCommand({
    ...options,
    args: ['plugin', '--profile', profile, action, ...extraArgs, target],
  })
}

/**
 * Run the official CLI with a verbatim argument vector.
 *
 * The dsh1024 CLI is a pure wrapper: it forwards the user's own arguments
 * unchanged, so it cannot use the structured helper above.
 * @param options - injected invocation plus the exact arguments to forward.
 * @returns the exit code with captured output; never rejects.
 */
export function runOfficialCommand(options: RunOfficialCommandOptions): Promise<RunPluginCommandResult> {
  const { invocation, onLine, timeoutMs, spawnImpl = spawn } = options
  const args = [...invocation.prefixArgs, ...options.args]
  return new Promise(resolvePromise => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child: ChildProcess
    try {
      child = spawnImpl(invocation.file, args, {
        cwd: invocation.cwd,
        env: options.env,
        shell: invocation.useShell ?? false,
        stdio: options.stdio === 'capture' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      })
    } catch (error) {
      resolvePromise({
        exitCode: null,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
        stdout,
        stderr,
      })
      return
    }
    const timer = timeoutMs === undefined
      ? null
      : setTimeout(() => {
        timedOut = true
        stopChild(child, spawnImpl)
      }, timeoutMs)
    const collect = (kind: 'stdout' | 'stderr', chunk: Buffer): void => {
      const text = chunk.toString()
      if (kind === 'stdout') stdout = (stdout + text).slice(-CAPTURE_LIMIT_BYTES)
      else stderr = (stderr + text).slice(-CAPTURE_LIMIT_BYTES)
      const line = lastOutputLine(text)
      if (line !== '' && onLine !== undefined) onLine(line)
    }
    child.stdout?.on('data', (chunk: Buffer) => { collect('stdout', chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { collect('stderr', chunk) })
    child.once('error', error => {
      if (timer !== null) clearTimeout(timer)
      resolvePromise({ exitCode: null, timedOut: false, error: error.message, stdout, stderr })
    })
    child.once('close', code => {
      if (timer !== null) clearTimeout(timer)
      resolvePromise({ exitCode: code, timedOut, error: null, stdout, stderr })
    })
  })
}
