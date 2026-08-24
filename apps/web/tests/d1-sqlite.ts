import type { DatabaseSync } from 'node:sqlite'
import { migratedDatabase } from './d1-runtime'

export { sqliteD1 } from './d1-runtime'

/** In-memory database with the real 0004_api_accounts.sql migration applied. */
export function accountsDatabase(): DatabaseSync {
  return migratedDatabase(new URL('../migrations/0004_api_accounts.sql', import.meta.url))
}
