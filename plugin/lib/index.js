/** 1024 Store market host plugin. */
import { DEFAULT_REGISTRY_URL } from './registry.js';
import { mountMarketRoutes } from './routes.js';
import { DEFAULT_UPDATE_URL } from './update.js';
export const name = 'dsh1024';
export const DEFAULT_EMBED_URL = 'https://deepseek1024.com/embed/store?bridge=dsh1024-v1';
function argvProfile() {
    const index = process.argv.indexOf('--profile');
    const candidate = index >= 0 ? process.argv[index + 1] : undefined;
    return candidate !== undefined && !candidate.startsWith('-') ? candidate : undefined;
}
/**
 * Mount the market routes after the web server service becomes available.
 * @param ctx - Cordis host context.
 * @param config - optional profile and registry overrides.
 */
export function apply(ctx, config = {}) {
    const resolved = {
        profile: config.profile ?? argvProfile() ?? 'web',
        registryUrl: config.registryUrl ?? DEFAULT_REGISTRY_URL,
        updateUrl: config.updateUrl ?? DEFAULT_UPDATE_URL,
        embedUrl: config.embedUrl ?? DEFAULT_EMBED_URL,
        sidebarEntry: config.sidebarEntry ?? true,
    };
    ctx.inject(['webServer'], hostContext => {
        const host = hostContext;
        host.effect(() => mountMarketRoutes(host.webServer, resolved), 'dsh1024: http routes');
    });
}
