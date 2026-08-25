// Just enough of Node's shape for the test-only helpers in this directory.
// Pulling in all of @types/node would put Node globals in scope for Worker
// code, where they do not exist; both apps list this file in their worker
// tsconfig include instead.
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string
}

declare module 'node:sqlite' {
  interface StatementSync {
    all(...params: unknown[]): Array<Record<string, unknown>>
    get(...params: unknown[]): Record<string, unknown> | undefined
    run(...params: unknown[]): { changes: number | bigint }
  }

  export class DatabaseSync {
    constructor(path: string)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}

interface ImportMeta {
  readonly url: string
}
