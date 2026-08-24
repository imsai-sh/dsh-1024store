/** Local HTTP routes for browsing and managing 1024 Store plugins. */
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { installExtraArgs, installTarget, loadRegistry, parseGitHubSource } from './registry.js';
import { runOfficialCommand, runPluginCommand } from './shared/install-runner.js';
import { reportInstallEvent } from './telemetry.js';
import { checkForUpdate } from './update.js';
import { readJson, resolveDshHome, storePaths, writeJsonAtomic } from './shared/files.js';
import { readCatalogPageCache, writeCatalogPageCache } from './catalog-cache.js';
const PROFILE_RE = /^[A-Za-z0-9_-]+$/;
const PACKAGE_RE = /^(?:@[a-z0-9._-]+\/)?[A-Za-z0-9._-]+$/;
/**
 * Token grammar for a page-supplied install command. Mirrors the runner's
 * TARGET_RE character set (plus `=` for `--flag=value` forms): no whitespace,
 * no quotes, and none of cmd.exe's metacharacters, so the vector stays inert
 * even on the Windows shell fallback.
 */
const COMMAND_TOKEN_RE = /^[A-Za-z0-9@:/._#+=-]+$/;
/**
 * Parse the full official command the embedded page asks to run.
 *
 * The store page names the exact command it already shows the user, and this
 * endpoint forwards everything after `dsh` to the official CLI verbatim —
 * the same philosophy as the dsh1024 CLI wrapper. The command template
 * therefore lives on the site and can follow the official CLI's evolution
 * without a plugin release; the local gate only pins the shape: it must be a
 * `dsh plugin …` command made of inert tokens.
 * @returns the argument vector after `dsh`, or null when the shape is wrong.
 */
export function parseDirectInstallCommand(value) {
    if (typeof value !== 'string' || value.length > 1024)
        return null;
    const tokens = value.trim().split(/\s+/);
    if (tokens.length < 4 || tokens[0] !== 'dsh' || tokens[1] !== 'plugin')
        return null;
    if (!tokens.slice(2).every(token => COMMAND_TOKEN_RE.test(token)))
        return null;
    return tokens.slice(1);
}
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const BODY_LIMIT_BYTES = 4 * 1024;
const CATALOG_CACHE_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
const BRAND_ICON = readFileSync(new URL('../client/brand-icon.png', import.meta.url));
function profileDirectory(profile) {
    return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', profile);
}
/** Read the store that pnpm used to link an existing profile's node_modules. */
export function readProfilePnpmStoreDir(directory) {
    try {
        const contents = readFileSync(join(directory, 'node_modules', '.modules.yaml'), 'utf8');
        let candidate;
        try {
            candidate = JSON.parse(contents).storeDir;
        }
        catch {
            const match = /^\s*storeDir:\s*(.+?)\s*$/m.exec(contents);
            candidate = match?.[1]?.replace(/^(["'])(.*)\1$/, '$2');
        }
        return typeof candidate === 'string'
            && candidate !== ''
            && !candidate.includes('\0')
            && isAbsolute(candidate)
            ? candidate
            : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Read non-official dependencies installed into one profile.
 * @param profile - validated profile name.
 * @returns package names mapped to their manifest specs.
 */
export function readInstalled(profile) {
    try {
        const manifest = JSON.parse(readFileSync(join(profileDirectory(profile), 'package.json'), 'utf8'));
        return Object.fromEntries(Object.entries(manifest.dependencies ?? {}).filter(([name]) => !name.startsWith('@deepseek-ai/')));
    }
    catch {
        return {};
    }
}
function installedPackageName(plugin, installed) {
    const target = installTarget(plugin);
    if (!target.startsWith('github:') && installed[target] !== undefined)
        return target;
    const repository = parseGitHubSource(plugin.url);
    if (repository === null)
        return null;
    const wantedPath = plugin.id.split('/').slice(2).join('/').toLowerCase();
    const repositoryNeedle = `github:${repository}`.toLowerCase();
    for (const [name, spec] of Object.entries(installed)) {
        const normalized = spec.toLowerCase();
        if (!normalized.includes(repositoryNeedle))
            continue;
        const match = /[#&]path:\/*([^&]*)/.exec(normalized);
        const installedPath = (match?.[1] ?? '').replace(/\/+$/, '');
        if (installedPath === wantedPath)
            return name;
    }
    return null;
}
/** Map local dependencies to public catalog ids without exposing package specs. */
export function installedPluginIds(installed, plugins) {
    return plugins
        .filter(plugin => installedPackageName(plugin, installed) !== null)
        .map(plugin => plugin.id);
}
function cliInvocation() {
    const entry = process.argv[1];
    if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
        const absoluteEntry = resolve(entry);
        return {
            file: process.execPath,
            prefixArgs: [...process.execArgv, absoluteEntry],
            cwd: dirname(absoluteEntry),
            useShell: false,
        };
    }
    return { file: 'dsh', prefixArgs: [], useShell: process.platform === 'win32' };
}
function failureCode(result) {
    if (result.timedOut)
        return 'TIMED_OUT';
    if (result.exitCode === 127)
        return 'SPAWN_FAILED';
    return 'OFFICIAL_CLI_FAILED';
}
function pluginEventId(plugin) {
    // The full id, so a monorepo subpackage's installs are counted against that
    // plugin rather than folded onto its repository or a sibling.
    return plugin.id.toLowerCase();
}
/** Run one plugin mutation through the shared async runner, tracking progress. */
async function runTrackedPluginCommand(profile, action, target, progress, extraArgs = []) {
    progress.active = true;
    progress.action = action;
    progress.target = target;
    progress.startedAt = Date.now();
    progress.lastLine = '';
    try {
        const pnpmStoreDir = readProfilePnpmStoreDir(profileDirectory(profile));
        const result = await runPluginCommand({
            invocation: cliInvocation(),
            action: action === 'uninstall' ? 'remove' : 'add',
            profile,
            target,
            extraArgs,
            stdio: 'capture',
            timeoutMs: COMMAND_TIMEOUT_MS,
            env: {
                ...process.env,
                CI: 'true',
                ...(pnpmStoreDir === undefined ? {} : {
                    npm_config_store_dir: pnpmStoreDir,
                    PNPM_STORE_DIR: pnpmStoreDir,
                }),
            },
            onLine: line => { progress.lastLine = line; },
        });
        if (result.error !== null) {
            return { exitCode: 127, timedOut: false, stdout: result.stdout, stderr: `${result.stderr}\n${result.error}` };
        }
        return { exitCode: result.exitCode, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr };
    }
    finally {
        progress.active = false;
        progress.action = null;
    }
}
/**
 * Run a page-supplied `dsh plugin …` vector verbatim and report the install
 * anonymously. Mirrors runTrackedPluginCommand's environment and progress
 * handling, but forwards the arguments unchanged instead of assembling them —
 * the command template belongs to the site.
 */
async function runReportedVerbatimCommand(profile, pluginId, args, progress) {
    const startedAt = new Date();
    progress.active = true;
    progress.action = 'install';
    progress.target = args.at(-1) ?? '';
    progress.startedAt = Date.now();
    progress.lastLine = '';
    let result;
    try {
        const pnpmStoreDir = readProfilePnpmStoreDir(profileDirectory(profile));
        const run = await runOfficialCommand({
            invocation: cliInvocation(),
            args,
            stdio: 'capture',
            timeoutMs: COMMAND_TIMEOUT_MS,
            env: {
                ...process.env,
                CI: 'true',
                ...(pnpmStoreDir === undefined ? {} : {
                    npm_config_store_dir: pnpmStoreDir,
                    PNPM_STORE_DIR: pnpmStoreDir,
                }),
            },
            onLine: line => { progress.lastLine = line; },
        });
        result = run.error !== null
            ? { exitCode: 127, timedOut: false, stdout: run.stdout, stderr: `${run.stderr}\n${run.error}` }
            : { exitCode: run.exitCode, timedOut: run.timedOut, stdout: run.stdout, stderr: run.stderr };
    }
    finally {
        progress.active = false;
        progress.action = null;
    }
    const completedAt = new Date();
    const succeeded = result.exitCode === 0 && !result.timedOut;
    void reportInstallEvent({
        pluginId,
        profile,
        operation: 'install',
        status: succeeded ? 'success' : 'failed',
        startedAt,
        completedAt,
        errorCode: succeeded ? null : failureCode(result),
    });
    return result;
}
/** Run one plugin mutation and report its outcome anonymously (fire-and-forget). */
async function runReportedPluginCommand(profile, pluginId, action, target, progress, extraArgs = [], versions = {}) {
    const startedAt = new Date();
    const result = await runTrackedPluginCommand(profile, action, target, progress, extraArgs);
    const completedAt = new Date();
    const succeeded = result.exitCode === 0 && !result.timedOut;
    void reportInstallEvent({
        pluginId,
        profile,
        operation: action === 'uninstall' ? 'remove' : action,
        status: succeeded ? 'success' : 'failed',
        startedAt,
        completedAt,
        errorCode: succeeded ? null : failureCode(result),
        ...versions,
    });
    return result;
}
function sendJson(response, status, value) {
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify(value));
}
function sendBrandIcon(response) {
    response.writeHead(200, {
        'cache-control': 'public, max-age=31536000, immutable',
        'content-length': String(BRAND_ICON.byteLength),
        'content-type': 'image/png',
    });
    response.end(BRAND_ICON);
}
function isPrivateNetworkHostname(hostname) {
    const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (normalized === 'localhost' || normalized.endsWith('.local'))
        return true;
    const family = isIP(normalized);
    if (family === 4) {
        const octets = normalized.split('.').map(Number);
        return octets[0] === 10
            || octets[0] === 127
            || (octets[0] === 169 && octets[1] === 254)
            || (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31)
            || (octets[0] === 192 && octets[1] === 168);
    }
    if (family === 6) {
        return normalized === '::1'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || /^fe[89ab]/.test(normalized);
    }
    return false;
}
export function isTrustedSameOrigin(origin, host) {
    if (origin === undefined || host === undefined)
        return false;
    try {
        const url = new URL(origin);
        return url.host === host && isPrivateNetworkHostname(url.hostname);
    }
    catch {
        return false;
    }
}
function isSameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    return isTrustedSameOrigin(origin, host);
}
async function readJsonBody(request, limit = BODY_LIMIT_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > limit)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function requireMethod(request, response, method) {
    if (request.method === method)
        return true;
    response.writeHead(405, { allow: method });
    response.end();
    return false;
}
function requireTrustedPost(request, response) {
    if (!requireMethod(request, response, 'POST'))
        return false;
    if (isSameOrigin(request))
        return true;
    sendJson(response, 403, { error: 'untrusted origin' });
    return false;
}
/**
 * Register the local market API and return a disposer for every route.
 * @param webServer - DSH web server service.
 * @param config - resolved profile and registry settings.
 * @returns a disposer that unregisters all market routes.
 */
export function mountMarketRoutes(webServer, config) {
    if (!PROFILE_RE.test(config.profile))
        throw new Error(`invalid profile name: ${config.profile}`);
    const registryUrl = new URL(config.registryUrl);
    if (registryUrl.protocol !== 'https:')
        throw new Error('registry API URL must use HTTPS');
    const updateUrl = new URL(config.updateUrl);
    if (updateUrl.protocol !== 'https:')
        throw new Error('update API URL must use HTTPS');
    const embedUrl = new URL(config.embedUrl);
    const loopbackEmbed = embedUrl.protocol === 'http:'
        && new Set(['localhost', '127.0.0.1', '[::1]']).has(embedUrl.hostname);
    if (embedUrl.username !== '' || embedUrl.password !== '') {
        throw new Error('embed URL cannot contain credentials');
    }
    if (embedUrl.protocol !== 'https:' && !loopbackEmbed) {
        throw new Error('embed URL must use HTTPS (loopback HTTP is allowed for development)');
    }
    let mutating = false;
    const dshHome = resolveDshHome();
    // The panel preference outranks the plugin config's default.
    async function resolveSidebarEntry() {
        const stored = await readJson(storePaths(dshHome).preferences, null);
        return typeof stored?.sidebarEntry === 'boolean' ? stored.sidebarEntry : config.sidebarEntry;
    }
    const progress = { active: false, action: null, target: '', startedAt: 0, lastLine: '' };
    const disposers = [
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/icon',
            handler: (request, response) => {
                if (!requireMethod(request, response, 'GET'))
                    return;
                sendBrandIcon(response);
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/embed-config',
            handler: async (request, response) => {
                if (!requireMethod(request, response, 'GET'))
                    return;
                sendJson(response, 200, {
                    url: embedUrl.href,
                    origin: embedUrl.origin,
                    sidebarEntry: await resolveSidebarEntry(),
                });
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/preferences',
            handler: async (request, response) => {
                // Store preferences the user flips from the panel UI, persisted next
                // to the other store state so no config file needs hand-editing. The
                // plugin config supplies the default; the stored preference wins.
                if (request.method === 'GET') {
                    sendJson(response, 200, { sidebarEntry: await resolveSidebarEntry() });
                    return;
                }
                if (!requireTrustedPost(request, response))
                    return;
                try {
                    const body = await readJsonBody(request);
                    if (typeof body.sidebarEntry !== 'boolean') {
                        sendJson(response, 400, { error: 'sidebarEntry must be a boolean' });
                        return;
                    }
                    const path = storePaths(dshHome).preferences;
                    const current = await readJson(path, {}) ?? {};
                    await writeJsonAtomic(path, { ...current, sidebarEntry: body.sidebarEntry });
                    sendJson(response, 200, { ok: true, sidebarEntry: body.sidebarEntry });
                }
                catch (error) {
                    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/registry',
            handler: async (request, response) => {
                if (!requireMethod(request, response, 'GET'))
                    return;
                try {
                    // `?revalidate=1` is the panel asking for the current catalog behind
                    // the copy it already rendered; everything else stays cache-first.
                    const revalidate = /[?&]revalidate=1(?:&|$)/.test(request.url ?? '');
                    const result = await loadRegistry(config.registryUrl, fetch, {
                        revalidate,
                        preferCache: !revalidate,
                        dshHome,
                    });
                    sendJson(response, 200, result);
                }
                catch (error) {
                    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/catalog-page-cache',
            handler: async (request, response) => {
                if (request.method === 'GET') {
                    sendJson(response, 200, { page: await readCatalogPageCache(dshHome) });
                    return;
                }
                if (request.method !== 'POST') {
                    response.writeHead(405, { allow: 'GET, POST' });
                    response.end();
                    return;
                }
                if (!requireTrustedPost(request, response))
                    return;
                try {
                    const body = await readJsonBody(request, CATALOG_CACHE_BODY_LIMIT_BYTES);
                    await writeCatalogPageCache(dshHome, body.page);
                    sendJson(response, 200, { ok: true });
                }
                catch (error) {
                    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/update',
            handler: async (request, response) => {
                if (!requireMethod(request, response, 'GET'))
                    return;
                sendJson(response, 200, await checkForUpdate(config.updateUrl));
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/installed',
            handler: async (request, response) => {
                if (!requireMethod(request, response, 'GET'))
                    return;
                try {
                    const installed = readInstalled(config.profile);
                    const { registry } = await loadRegistry(config.registryUrl, fetch, { dshHome });
                    const pluginIds = installedPluginIds(installed, registry.plugins);
                    const idSet = new Set(pluginIds);
                    const categoryLabels = new Map(registry.categories.map(category => [category.id, category.label]));
                    sendJson(response, 200, {
                        profile: config.profile,
                        installed,
                        pluginIds,
                        plugins: registry.plugins.filter(plugin => idSet.has(plugin.id)).map(plugin => ({
                            id: plugin.id,
                            name: plugin.name,
                            owner: plugin.owner,
                            url: plugin.url,
                            category: plugin.category,
                            categoryLabel: categoryLabels.get(plugin.category) ?? {},
                            description: plugin.description,
                            install: plugin.install,
                            added: plugin.added,
                            stars: plugin.stars ?? null,
                        })),
                    });
                }
                catch (error) {
                    sendJson(response, 503, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/status',
            handler: (request, response) => {
                if (!requireMethod(request, response, 'GET'))
                    return;
                sendJson(response, 200, {
                    ...progress,
                    seconds: progress.active ? Math.round((Date.now() - progress.startedAt) / 1000) : 0,
                    installed: readInstalled(config.profile),
                });
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/self-update',
            handler: async (request, response) => {
                if (!requireTrustedPost(request, response))
                    return;
                if (mutating) {
                    sendJson(response, 409, { error: 'another plugin operation is already running' });
                    return;
                }
                try {
                    const update = await checkForUpdate(config.updateUrl);
                    if (!update.checked || update.latestVersion === null) {
                        sendJson(response, 503, { error: update.error ?? 'update service unavailable', update });
                        return;
                    }
                    if (!update.updateAvailable) {
                        sendJson(response, 200, { ok: true, updated: false, update });
                        return;
                    }
                    mutating = true;
                    try {
                        const result = await runReportedPluginCommand(config.profile, 'imsai-sh/awesome-deepseek-harness-plugins', 'update', `dsh1024@${update.latestVersion}`, progress, [], { beforeVersion: update.currentVersion, afterVersion: update.latestVersion });
                        const ok = result.exitCode === 0 && !result.timedOut;
                        sendJson(response, ok ? 200 : 502, { ok, updated: ok, update, ...result });
                    }
                    finally {
                        mutating = false;
                    }
                }
                catch (error) {
                    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/install',
            handler: async (request, response) => {
                if (!requireTrustedPost(request, response))
                    return;
                if (mutating) {
                    sendJson(response, 409, { error: 'another plugin operation is already running' });
                    return;
                }
                try {
                    const body = await readJsonBody(request);
                    const requestedId = typeof body.id === 'string' ? body.id.toLowerCase() : '';
                    if (body.command !== undefined) {
                        // The embedded store page hands over the full official command it
                        // already shows the user. Page and endpoint read the same
                        // first-party catalog API, so a second registry round-trip adds
                        // nothing but a failure mode (issue #159); forwarding the vector
                        // verbatim also keeps the command template on the site, where it
                        // can follow the official CLI's evolution without a plugin
                        // release. parseDirectInstallCommand pins the shape.
                        const args = parseDirectInstallCommand(body.command);
                        if (args === null) {
                            sendJson(response, 400, { error: 'install command must be a plain official dsh plugin command' });
                            return;
                        }
                        // Telemetry hygiene: the attribution id must look like a catalog
                        // plugin id, or the anonymous event would carry arbitrary text.
                        if (!/^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+$/.test(requestedId) || requestedId.length > 201) {
                            sendJson(response, 400, { error: 'plugin id is invalid' });
                            return;
                        }
                        mutating = true;
                        try {
                            const result = await runReportedVerbatimCommand(config.profile, requestedId, args, progress);
                            const ok = result.exitCode === 0 && !result.timedOut;
                            sendJson(response, ok ? 200 : 502, {
                                ok,
                                ...result,
                                installed: readInstalled(config.profile),
                            });
                        }
                        finally {
                            mutating = false;
                        }
                        return;
                    }
                    // Older embedded pages send only the catalog id; the registry entry
                    // then decides the executed target, as it always has.
                    const { registry } = await loadRegistry(config.registryUrl, fetch, { dshHome });
                    const plugin = registry.plugins.find(entry => entry.id.toLowerCase() === requestedId);
                    if (plugin === undefined) {
                        sendJson(response, 400, { error: 'plugin is not in the 1024 Store registry' });
                        return;
                    }
                    const target = installTarget(plugin);
                    // Browse-only entry: no npm package. The store UI offers no install
                    // for it, so this refusal only fires for a stale or hand-crafted
                    // page.
                    if (target.startsWith('github:')) {
                        sendJson(response, 400, { error: 'this plugin has not published an npm package; source installs are not offered by the store' });
                        return;
                    }
                    mutating = true;
                    try {
                        const result = await runReportedPluginCommand(config.profile, pluginEventId(plugin), 'install', target, progress, installExtraArgs(plugin));
                        const ok = result.exitCode === 0 && !result.timedOut;
                        sendJson(response, ok ? 200 : 502, {
                            ok,
                            ...result,
                            installed: readInstalled(config.profile),
                        });
                    }
                    finally {
                        mutating = false;
                    }
                }
                catch (error) {
                    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
        webServer.register({
            kind: 'exact',
            path: '/dsh1024/uninstall',
            handler: async (request, response) => {
                if (!requireTrustedPost(request, response))
                    return;
                if (mutating) {
                    sendJson(response, 409, { error: 'another plugin operation is already running' });
                    return;
                }
                try {
                    const body = await readJsonBody(request);
                    const installed = readInstalled(config.profile);
                    let name = typeof body.name === 'string' ? body.name : '';
                    const requestedId = typeof body.id === 'string' ? body.id.toLowerCase() : '';
                    if (name === '' && requestedId !== '') {
                        // The page uninstalls by catalog id; the package name never leaves
                        // this process. The id → package-name mapping is what the registry
                        // exists for, so a resolution miss is a real 400, not a fallback.
                        try {
                            const { registry } = await loadRegistry(config.registryUrl, fetch, { preferCache: true, dshHome });
                            const plugin = registry.plugins.find(entry => entry.id.toLowerCase() === requestedId);
                            if (plugin !== undefined)
                                name = installedPackageName(plugin, installed) ?? '';
                        }
                        catch {
                            // Resolution failure falls through to the guard below.
                        }
                        if (name === '') {
                            sendJson(response, 400, { error: 'no installed package matches this plugin id' });
                            return;
                        }
                    }
                    if (!PACKAGE_RE.test(name) || name === 'dsh1024') {
                        sendJson(response, 400, { error: 'plugin cannot be uninstalled here' });
                        return;
                    }
                    const installedSpec = installed[name];
                    if (installedSpec === undefined) {
                        sendJson(response, 400, { error: 'plugin is not installed' });
                        return;
                    }
                    // Telemetry attribution is best-effort, never a gate: the registry
                    // used to be a membership requirement here, which made "uninstall"
                    // depend on a network catalog — the same single point of failure
                    // that broke installs (issue #159). Prefer the plugin whose target
                    // appears in the installed manifest spec; fall back to the display
                    // name; with no match (or no registry at all) the uninstall still
                    // runs, just unreported.
                    let eventId = null;
                    try {
                        const { registry } = await loadRegistry(config.registryUrl, fetch, { preferCache: true, dshHome });
                        const cataloged = registry.plugins.find(plugin => installedSpec.toLowerCase().includes(installTarget(plugin).toLowerCase()))
                            ?? registry.plugins.find(plugin => plugin.name === name);
                        if (cataloged !== undefined)
                            eventId = pluginEventId(cataloged);
                    }
                    catch {
                        // Registry unavailable: uninstall proceeds without attribution.
                    }
                    mutating = true;
                    try {
                        const result = eventId === null
                            ? await runTrackedPluginCommand(config.profile, 'uninstall', name, progress)
                            : await runReportedPluginCommand(config.profile, eventId, 'uninstall', name, progress);
                        const ok = result.exitCode === 0 && !result.timedOut;
                        sendJson(response, ok ? 200 : 502, {
                            ok,
                            ...result,
                            // The exact official command that ran, for the page's console.
                            command: `dsh plugin --profile ${config.profile} remove ${name}`,
                            installed: readInstalled(config.profile),
                        });
                    }
                    finally {
                        mutating = false;
                    }
                }
                catch (error) {
                    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
                }
            },
        }),
    ];
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
