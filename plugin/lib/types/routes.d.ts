/** Local HTTP routes for browsing and managing 1024 Store plugins. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RegistryPlugin } from './registry.ts';
export interface WebRoute {
    kind: 'exact';
    path: string;
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;
}
export interface WebServerService {
    register(route: WebRoute): () => void;
}
export interface MarketRouteConfig {
    profile: string;
    registryUrl: string;
    updateUrl: string;
    embedUrl: string;
    sidebarEntry: boolean;
}
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
export declare function parseDirectInstallCommand(value: unknown): string[] | null;
/** Read the store that pnpm used to link an existing profile's node_modules. */
export declare function readProfilePnpmStoreDir(directory: string): string | undefined;
/**
 * Read non-official dependencies installed into one profile.
 * @param profile - validated profile name.
 * @returns package names mapped to their manifest specs.
 */
export declare function readInstalled(profile: string): Record<string, string>;
/** Map local dependencies to public catalog ids without exposing package specs. */
export declare function installedPluginIds(installed: Record<string, string>, plugins: RegistryPlugin[]): string[];
export declare function isTrustedSameOrigin(origin: string | undefined, host: string | undefined): boolean;
/**
 * Register the local market API and return a disposer for every route.
 * @param webServer - DSH web server service.
 * @param config - resolved profile and registry settings.
 * @returns a disposer that unregisters all market routes.
 */
export declare function mountMarketRoutes(webServer: WebServerService, config: MarketRouteConfig): () => void;
