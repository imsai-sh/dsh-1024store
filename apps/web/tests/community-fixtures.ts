import type { DatabaseSync } from 'node:sqlite'
import { Hono } from 'hono'
import { migratedDatabase, sqliteD1 } from './d1-runtime'
import { registerCommunityRoutes, type CommunityDependencies } from '../worker/community/routes'

/**
 * The community routes on a bare Hono app.
 *
 * In production they are mounted onto the site's app, which also carries the
 * catalog, SEO, and auth routes. Registering them alone keeps these tests about
 * the community and keeps the site's Worker out of this TypeScript project.
 * `apps/web/tests/app.test.ts` is where the mount itself is covered.
 */
export function communityApp(dependencies: CommunityDependencies) {
  const app = new Hono<{ Bindings: Env }>()
  registerCommunityRoutes(app, dependencies)
  return app
}

/**
 * A database with the real accounts migration and the real community migration
 * applied, plus the two catalog tables the community reads.
 *
 * The community's own schema comes from its migration file, so a column renamed
 * there fails these tests rather than passing against a hand-written copy. The
 * catalog tables are minimal stand-ins: `0005_catalog_plugins.sql` is a data
 * migration that rewrites tables created three migrations earlier, and replaying
 * that whole chain would be testing the catalog rather than the community. Only
 * the columns the community actually queries are declared here.
 */
export function communityDatabase(): DatabaseSync {
  const database = migratedDatabase(
    new URL('../migrations/0004_api_accounts.sql', import.meta.url),
    new URL('../migrations/0007_community.sql', import.meta.url),
    new URL('../migrations/0008_community_moderation.sql', import.meta.url),
  )
  database.exec(`
    CREATE TABLE catalog_repositories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner TEXT NOT NULL,
      repository_name TEXT NOT NULL,
      stars INTEGER,
      from_topic INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE catalog_plugins (
      repository_id INTEGER NOT NULL REFERENCES catalog_repositories(id),
      plugin_id TEXT NOT NULL,
      normalized_plugin_id TEXT NOT NULL UNIQUE,
      from_pr INTEGER NOT NULL DEFAULT 0,
      curated_name TEXT,
      curated_category TEXT,
      ai_category TEXT,
      validation_status TEXT NOT NULL DEFAULT 'pending'
    );
  `)
  return database
}

export interface SeedPluginOptions {
  pluginId: string
  stars?: number | null
  curatedName?: string | null
  category?: string | null
  /** An unpublished plugin exists in the catalog but must never render a card. */
  published?: boolean
}

export function seedPlugin(database: DatabaseSync, options: SeedPluginOptions): void {
  const [owner = '', repository = ''] = options.pluginId.split('/')
  const published = options.published ?? true
  database.prepare(
    'INSERT INTO catalog_repositories (owner, repository_name, stars, from_topic) VALUES (?, ?, ?, 1)',
  ).run(owner, repository, options.stars ?? null)
  const repositoryId = Number(
    (database.prepare('SELECT MAX(id) AS id FROM catalog_repositories').get() as { id: number }).id,
  )
  database.prepare(
    `INSERT INTO catalog_plugins
       (repository_id, plugin_id, normalized_plugin_id, from_pr, curated_name, curated_category, validation_status)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    repositoryId,
    options.pluginId,
    options.pluginId.toLowerCase(),
    options.curatedName ?? null,
    options.category ?? null,
    published ? 'accepted' : 'rejected',
  )
}

export { sqliteD1 }
