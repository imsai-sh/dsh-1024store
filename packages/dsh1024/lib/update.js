/** Automatic update checks for the 1024 Store plugin itself. */
import { readFileSync } from 'node:fs';
export const DEFAULT_UPDATE_URL = 'https://deepseek1024.com/api/v1/self/update';
export const DEFAULT_UPDATE_FALLBACK_URL = 'https://registry.npmjs.org/dsh1024/latest';
// Pre-split npm releases baked in the old awesome-deepseek-harness-plugins URL for
// this leg; it 404s for them since the package moved here. Accepted: the first two
// legs above still serve those clients, so this is degradation, not breakage.
export const DEFAULT_UPDATE_LAST_RESORT_URL = 'https://api.github.com/repos/imsai-sh/dsh-1024store/contents/packages/dsh1024/package.json?ref=main';
export const DEFAULT_RELEASE_URL = 'https://deepseek1024.com/plugins/imsai-sh/awesome-deepseek-harness-plugins/packages/dsh1024';
const FETCH_TIMEOUT_MS = 8_000;
const localManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const CURRENT_VERSION = localManifest.version;
function parseVersion(value) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
    if (match === null)
        return null;
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4]?.split('.') ?? [],
    };
}
/** Compare two semantic versions. Positive means left is newer. */
export function compareVersions(leftValue, rightValue) {
    const left = parseVersion(leftValue);
    const right = parseVersion(rightValue);
    if (left === null || right === null)
        throw new Error('update API returned an invalid semantic version');
    for (let index = 0; index < left.core.length; index += 1) {
        const difference = (left.core[index] ?? 0) - (right.core[index] ?? 0);
        if (difference !== 0)
            return difference;
    }
    if (left.prerelease.length === 0 && right.prerelease.length > 0)
        return 1;
    if (left.prerelease.length > 0 && right.prerelease.length === 0)
        return -1;
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = left.prerelease[index];
        const rightPart = right.prerelease[index];
        if (leftPart === undefined)
            return -1;
        if (rightPart === undefined)
            return 1;
        if (leftPart === rightPart)
            continue;
        const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
        const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
        if (leftNumber !== null && rightNumber !== null)
            return leftNumber - rightNumber;
        if (leftNumber !== null)
            return -1;
        if (rightNumber !== null)
            return 1;
        return leftPart.localeCompare(rightPart);
    }
    return 0;
}
function validateManifest(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('update API response must be an object');
    }
    const manifest = value;
    if (typeof manifest.version !== 'string' || parseVersion(manifest.version) === null) {
        throw new Error('update API version is invalid');
    }
    if (manifest.releaseUrl !== undefined && typeof manifest.releaseUrl !== 'string') {
        throw new Error('update API release URL is invalid');
    }
    return { version: manifest.version, releaseUrl: manifest.releaseUrl };
}
async function fetchManifest(url, fetcher) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:')
        throw new Error('update API URL must use HTTPS');
    const response = await fetcher(endpoint, {
        headers: { accept: 'application/vnd.github.raw+json, application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok)
        throw new Error(`update API HTTP ${response.status}`);
    return validateManifest(await response.json());
}
/**
 * Query the npm registry for the published version and fall back to the repository API.
 * Failures are returned as state so an unavailable checker never blocks the market.
 */
export async function checkForUpdate(updateUrl = DEFAULT_UPDATE_URL, fallbackUrl = DEFAULT_UPDATE_FALLBACK_URL, fetcher = fetch, lastResortUrl = DEFAULT_UPDATE_LAST_RESORT_URL) {
    const errors = [];
    for (const url of new Set([updateUrl, fallbackUrl, lastResortUrl])) {
        try {
            const manifest = await fetchManifest(url, fetcher);
            return {
                checked: true,
                currentVersion: CURRENT_VERSION,
                latestVersion: manifest.version,
                updateAvailable: compareVersions(manifest.version, CURRENT_VERSION) > 0,
                releaseUrl: manifest.releaseUrl ?? DEFAULT_RELEASE_URL,
            };
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    return {
        checked: false,
        currentVersion: CURRENT_VERSION,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: DEFAULT_RELEASE_URL,
        error: errors.join('; '),
    };
}
