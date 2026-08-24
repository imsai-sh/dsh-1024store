#!/usr/bin/env node
// Derive the STAGING-worker deploy config from the vite-plugin build output.
//
// Staging is a pre-release twin of production: it deploys the exact same bundle
// and binds the SAME production D1 database, KV namespace, and AI binding (their
// ids are already declared publicly in apps/web/wrangler.jsonc). Only two things
// differ from production, and both exist to keep the production Worker untouched:
//
//   - name:    STAGING_WORKER_NAME (default dsh-1024store) — never `dsh-store`.
//              Renaming is what isolates the deploy; the production Worker, its
//              custom domains, and its Durable Object namespace are not touched.
//   - routes:  removed. The `routes` array is the authoritative custom-domain
//              binding list of the production Worker; deploying it from a second
//              Worker would fight over deepseek1024.com. Staging serves from its
//              workers.dev subdomain instead.
//
// The Durable Object (LiveStats) is necessarily per-Worker, so staging gets its
// own live-stats instance — view counters on staging are separate by design.
// The `secrets.required` deploy gate is dropped so the first deploy succeeds
// before any secret exists; copy the production secret values onto the staging
// Worker afterwards so both behave identically (see docs/deployment.md).
//
// Usage (after `npm run build --workspace @dsh-1024store/web`):
//   node apps/web/scripts/make-staging-deploy-config.mjs
//   npx wrangler deploy --config apps/web/dist/dsh_store/wrangler.staging.json
import { readFileSync, writeFileSync } from 'node:fs'

const builtConfigUrl = new URL('../dist/dsh_store/wrangler.json', import.meta.url)
const outputUrl = new URL('../dist/dsh_store/wrangler.staging.json', import.meta.url)

const stagingWorkerName = process.env.STAGING_WORKER_NAME ?? 'dsh-1024store'
if (stagingWorkerName === 'dsh-store') {
  console.error('make-staging-deploy-config: STAGING_WORKER_NAME must not be the production worker name `dsh-store`.')
  process.exit(1)
}

const config = JSON.parse(readFileSync(builtConfigUrl, 'utf8'))
if (!config.d1_databases?.[0] || config.d1_databases[0].binding !== 'CATALOG_DB') {
  throw new Error('built config lost the CATALOG_DB binding')
}

config.name = stagingWorkerName
config.topLevelName = stagingWorkerName
delete config.routes
config.workers_dev = true
delete config.secrets

writeFileSync(outputUrl, `${JSON.stringify(config, null, 2)}\n`)
console.log(`Wrote ${outputUrl.pathname}: worker ${config.name}, production D1/KV bindings kept, routes removed`)
