import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

class SqliteD1Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SqliteD1Statement(this.database, this.sql, params)
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] }
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params)
    return { success: true, meta: { changes: Number(result.changes) } }
  }
}

export function sqliteD1(database: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return new SqliteD1Statement(database, sql)
    },
    async batch(statements: SqliteD1Statement[]) {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  } as unknown as D1Database
}

/**
 * In-memory database with real migration files applied, in the order given.
 * Tests read the same SQL production runs, so a column renamed in a migration
 * fails the test rather than passing against a hand-written copy of the schema.
 */
export function migratedDatabase(...sqlFileUrls: URL[]): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  for (const url of sqlFileUrls) database.exec(readFileSync(url, 'utf8'))
  return database
}
