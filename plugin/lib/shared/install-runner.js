/**
 * Shared asynchronous install runner used by both the dsh1024 CLI and the
 * in-app 1024 Store plugin. The official CLI invocation is injected by each
 * caller: the CLI passes an `npx --yes @deepseek-ai/dsh` prefix while the
 * plugin reuses the running dsh entry. The runner always spawns asynchronously;
 * it must never use spawnSync, which would freeze the harness event loop.
 */
import { spawn } from 'node:child_process';
const TARGET_RE = /^[A-Za-z0-9@:/._#+-]+$/;
const CAPTURE_LIMIT_BYTES = 64 * 1024;
/** Extract the last meaningful line of one output chunk, capped for status previews. */
function lastOutputLine(text) {
    return text.split('\n').map(line => line.trim()).filter(Boolean).at(-1)?.slice(0, 240) ?? '';
}
function stopChild(child, spawnImpl) {
    if (process.platform === 'win32' && child.pid !== undefined) {
        const killer = spawnImpl('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        killer.once('error', () => { child.kill('SIGKILL'); });
        return;
    }
    child.kill('SIGKILL');
}
/**
 * Run one official `dsh plugin --profile <profile> <action> <target>` mutation.
 * @param options - injected invocation plus the plugin mutation to perform.
 * @returns the exit code with captured output; never rejects.
 */
export function runPluginCommand(options) {
    const { invocation, action, profile, target, extraArgs = [] } = options;
    if (!TARGET_RE.test(target)) {
        return Promise.resolve({ exitCode: 1, timedOut: false, error: null, stdout: '', stderr: 'unsafe plugin target' });
    }
    return runOfficialCommand({
        ...options,
        args: ['plugin', '--profile', profile, action, ...extraArgs, target],
    });
}
/**
 * Run the official CLI with a verbatim argument vector.
 *
 * The dsh1024 CLI is a pure wrapper: it forwards the user's own arguments
 * unchanged, so it cannot use the structured helper above.
 * @param options - injected invocation plus the exact arguments to forward.
 * @returns the exit code with captured output; never rejects.
 */
export function runOfficialCommand(options) {
    const { invocation, onLine, timeoutMs, spawnImpl = spawn } = options;
    const args = [...invocation.prefixArgs, ...options.args];
    return new Promise(resolvePromise => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let child;
        try {
            child = spawnImpl(invocation.file, args, {
                cwd: invocation.cwd,
                env: options.env,
                shell: invocation.useShell ?? false,
                stdio: options.stdio === 'capture' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            });
        }
        catch (error) {
            resolvePromise({
                exitCode: null,
                timedOut: false,
                error: error instanceof Error ? error.message : String(error),
                stdout,
                stderr,
            });
            return;
        }
        const timer = timeoutMs === undefined
            ? null
            : setTimeout(() => {
                timedOut = true;
                stopChild(child, spawnImpl);
            }, timeoutMs);
        const collect = (kind, chunk) => {
            const text = chunk.toString();
            if (kind === 'stdout')
                stdout = (stdout + text).slice(-CAPTURE_LIMIT_BYTES);
            else
                stderr = (stderr + text).slice(-CAPTURE_LIMIT_BYTES);
            const line = lastOutputLine(text);
            if (line !== '' && onLine !== undefined)
                onLine(line);
        };
        child.stdout?.on('data', (chunk) => { collect('stdout', chunk); });
        child.stderr?.on('data', (chunk) => { collect('stderr', chunk); });
        child.once('error', error => {
            if (timer !== null)
                clearTimeout(timer);
            resolvePromise({ exitCode: null, timedOut: false, error: error.message, stdout, stderr });
        });
        child.once('close', code => {
            if (timer !== null)
                clearTimeout(timer);
            resolvePromise({ exitCode: code, timedOut, error: null, stdout, stderr });
        });
    });
}
