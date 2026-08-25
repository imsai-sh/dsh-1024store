/** Plugin-owned cache for the embedded catalog's first visible page. */
import { readJson, storePaths, writeJsonAtomic } from './shared/files.js';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function publicPlugin(value) {
    const plugin = record(value);
    const description = record(plugin?.description);
    return plugin !== null
        && typeof plugin.id === 'string' && plugin.id.length <= 201
        && typeof plugin.name === 'string' && plugin.name.length <= 300
        && typeof plugin.owner === 'string' && plugin.owner.length <= 100
        && typeof plugin.url === 'string' && plugin.url.startsWith('https://github.com/')
        && typeof plugin.category === 'string' && plugin.category.length <= 100
        && description !== null && typeof description.en === 'string' && typeof description.zh === 'string';
}
function publicCategory(value) {
    const category = record(value);
    return category !== null && typeof category.id === 'string'
        && typeof category.en === 'string' && typeof category.zh === 'string'
        && typeof category.count === 'number' && Number.isSafeInteger(category.count);
}
/** Validate the only v2 page shape the plugin persists and returns to the iframe. */
export function isCatalogPage(value) {
    const page = record(value);
    return page !== null && page.page === 1 && page.limit === 100
        && typeof page.total === 'number' && Number.isSafeInteger(page.total) && page.total >= 0
        && typeof page.totalPages === 'number' && Number.isSafeInteger(page.totalPages) && page.totalPages >= 0
        && typeof page.catalogTotal === 'number' && Number.isSafeInteger(page.catalogTotal) && page.catalogTotal >= 0
        && typeof page.generatedAt === 'string' && page.generatedAt.length <= 100
        && Array.isArray(page.plugins) && page.plugins.length <= 100 && page.plugins.every(publicPlugin)
        && Array.isArray(page.categories) && page.categories.length <= 100 && page.categories.every(publicCategory);
}
/** Read a validated last-good snapshot. Expired or malformed data is ignored. */
export async function readCatalogPageCache(dshHome) {
    try {
        const cached = await readJson(storePaths(dshHome).catalogPageCache, null);
        if (cached === null || cached.version !== 1 || typeof cached.fetchedAt !== 'number'
            || !Number.isFinite(cached.fetchedAt) || cached.fetchedAt > Date.now() + 5 * 60 * 1000
            || Date.now() - cached.fetchedAt > CACHE_MAX_AGE_MS || !isCatalogPage(cached.page))
            return null;
        return cached.page;
    }
    catch {
        return null;
    }
}
/** Atomically replace the snapshot after a successful production API response. */
export async function writeCatalogPageCache(dshHome, page) {
    if (!isCatalogPage(page))
        throw new Error('catalog page cache payload is invalid');
    await writeJsonAtomic(storePaths(dshHome).catalogPageCache, {
        version: 1,
        fetchedAt: Date.now(),
        page,
    });
}
