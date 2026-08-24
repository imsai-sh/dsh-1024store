#!/usr/bin/env node
// Derive a TEST-worker deploy config from the vite-plugin build output.
//
// The production config (apps/web/wrangler.jsonc → dist/dsh_store/wrangler.json)
// must never be deployed by an experiment: its `routes` array is the authoritative
// custom-domain binding list for the production `dsh-store` Worker, and its D1/KV
// ids are live production data. This script rewrites the BUILT config — so the test
// worker ships the exact same bundle the production pipeline produces — into an
// isolated variant:
//
//   - name:        TEST_WORKER_NAME (default dsh-1024store) — never `dsh-store`
//   - routes:      removed; the worker serves from its workers.dev subdomain
//   - D1/KV:       replaced with the TEST resources (TEST_D1_ID / TEST_KV_ID required)
//   - secrets:     the `required` gate is dropped so the first deploy succeeds before
//                  any secret exists; put INSTALL_CLIENT_HASH_SECRET and
//                  CATALOG_SYNC_TOKEN on the worker afterwards to light up
//                  install-events and catalog sync (OAuth login stays off)
//
// Usage (after `npm run build --workspace @dsh-1024store/web`):
//   TEST_D1_ID=... TEST_KV_ID=... node apps/web/scripts/make-test-deploy-config.mjs
//   npx wrangler deploy --config apps/web/dist/dsh_store/wrangler.test.json
import { readFileSync, writeFileSync } from 'node:fs'

const builtConfigUrl = new URL('../dist/dsh_store/wrangler.json', import.meta.url)
const outputUrl = new URL('../dist/dsh_store/wrangler.test.json', import.meta.url)

const testWorkerName = process.env.TEST_WORKER_NAME ?? 'dsh-1024store'
const testD1Id = process.env.TEST_D1_ID
const testKvId = process.env.TEST_KV_ID
if (!testD1Id || !testKvId) {
  console.error('make-test-deploy-config: set TEST_D1_ID and TEST_KV_ID (create them with `wrangler d1 create` / `wrangler kv namespace create`). Refusing to fall back to the production ids.')
  process.exit(1)
}
if (testWorkerName === 'dsh-store') {
  console.error('make-test-deploy-config: TEST_WORKER_NAME must not be the production worker name `dsh-store`.')
  process.exit(1)
}

const config = JSON.parse(readFileSync(builtConfigUrl, 'utf8'))

config.name = testWorkerName
config.topLevelName = testWorkerName
delete config.routes
config.workers_dev = true
delete config.secrets

const d1 = config.d1_databases?.[0]
if (!d1 || d1.binding !== 'CATALOG_DB') throw new Error('built config lost the CATALOG_DB binding')
d1.database_id = testD1Id
d1.database_name = process.env.TEST_D1_NAME ?? 'dsh-1024store-test-catalog'

const kv = config.kv_namespaces?.[0]
if (!kv || kv.binding !== 'CATALOG_CACHE') throw new Error('built config lost the CATALOG_CACHE binding')
kv.id = testKvId

writeFileSync(outputUrl, `${JSON.stringify(config, null, 2)}\n`)
console.log(`Wrote ${outputUrl.pathname}: worker ${config.name}, D1 ${d1.database_id}, KV ${kv.id}, routes removed`)
