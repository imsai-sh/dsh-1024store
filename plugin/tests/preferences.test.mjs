import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { mountMarketRoutes } from '../lib/routes.js'
import { apply } from '../lib/index.js'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh1024-preferences-home-'))

const config = {
  profile: 'web', registryUrl: 'https://deepseek1024.com/api/v1/registry',
  updateUrl: 'https://deepseek1024.com/api/v1/self/update',
  embedUrl: 'https://deepseek1024.com/embed/store?bridge=dsh1024-v1', sidebarEntry: true,
}
const sameOrigin = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }

function harness(authenticate) {
  const routes = new Map()
  const webServer = { register(route) {
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  } }
  const dispose = mountMarketRoutes(webServer, config, authenticate)
  return { routes, webServer, dispose }
}

async function request(routes, { path = '/dsh1024/preferences', method = 'POST', headers = sameOrigin, body = { sidebarEntry: false } } = {}) {
  const req = Readable.from([JSON.stringify(body)])
  Object.assign(req, { method, headers, url: path })
  let status, text = '', responseHeaders
  await routes.get(path).handler(req, {
    writeHead(code, value) { status = code; responseHeaders = value },
    end(value = '') { text = String(value) },
  })
  return { status, body: text ? JSON.parse(text) : null, headers: responseHeaders }
}

test('Web and authenticated Desktop preference writes persist both directions and survive remount', async () => {
  let authenticated = 0
  const auth = req => { authenticated++; return req.headers.cookie === 'test-host-cookie' }
  let app = harness(auth)
  for (const headers of [sameOrigin, { host: '127.0.0.1:3080', cookie: 'test-host-cookie' }]) {
    for (const value of [false, true]) {
      assert.deepEqual(await request(app.routes, { headers, body: { sidebarEntry: value } }), {
        status: 200, body: { ok: true, sidebarEntry: value }, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
      assert.equal(JSON.parse(readFileSync(join(process.env.DSH_HOME, '.dsh-1024store/preferences.json'), 'utf8')).sidebarEntry, value)
      app.dispose()
      app = harness(auth)
      assert.equal((await request(app.routes, { method: 'GET' })).body.sidebarEntry, value)
      assert.equal((await request(app.routes, { method: 'GET', path: '/dsh1024/embed-config' })).body.sidebarEntry, value)
    }
  }
  assert.equal(authenticated, 2, 'ordinary same-origin writes retain their existing contract')
  app.dispose()
})

test('Origin-less preferences fail closed without explicit Host authentication', async () => {
  for (const authenticate of [undefined, () => false, () => undefined]) {
    const { routes, dispose } = harness(authenticate)
    for (const cookie of [undefined, 'forged-cookie']) {
      const result = await request(routes, { headers: { host: '127.0.0.1:3080', cookie } })
      assert.equal(result.status, 403)
      assert.deepEqual(result.body, { error: 'untrusted origin' })
    }
    dispose()
  }
})

test('explicit untrusted origins and wrong methods never reach the authentication fallback', async () => {
  const { routes, dispose } = harness(() => { throw new Error('must not authenticate this request') })
  for (const origin of ['https://evil.example', 'http://localhost:3080', 'null', '']) {
    assert.equal((await request(routes, { headers: { host: '127.0.0.1:3080', origin } })).status, 403)
  }
  for (const method of ['OPTIONS', 'PUT', 'DELETE']) {
    assert.equal((await request(routes, { method, headers: {} })).status, 405)
  }
  dispose()
})

test('Desktop authentication does not relax other mutation routes or preference validation', async () => {
  const { routes, dispose } = harness(() => true)
  for (const path of ['/dsh1024/install', '/dsh1024/uninstall', '/dsh1024/self-update', '/dsh1024/catalog-page-cache']) {
    assert.equal((await request(routes, { path, headers: { host: '127.0.0.1:3080' } })).status, 403, path)
  }
  for (const sidebarEntry of [null, 'false', 0]) {
    assert.equal((await request(routes, { headers: {}, body: { sidebarEntry } })).status, 400)
  }
  dispose()
})

test('plugin resolves the active Connection for each preference request and fails closed on older Hosts', async () => {
  const routes = new Map()
  let connection
  let disposed
  const host = {
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    get(name) { assert.equal(name, 'connection'); return connection },
    effect(create) { disposed = create() },
  }
  apply({ inject(deps, callback) { assert.deepEqual(deps, ['webServer']); callback(host) } }, config)
  for (connection of [undefined, {}, { requestRejection: () => 401 }, { requestRejection: () => 403 }]) {
    assert.equal((await request(routes, { headers: { host: '127.0.0.1:3080' } })).status, 403)
  }
  connection = { requestRejection(req) { assert.equal(this, connection); assert.equal(req.headers.cookie, 'test-host-cookie'); return undefined } }
  assert.equal((await request(routes, { headers: { host: '127.0.0.1:3080', cookie: 'test-host-cookie' } })).status, 200)
  connection = undefined
  assert.equal((await request(routes, { headers: { host: '127.0.0.1:3080', cookie: 'test-host-cookie' } })).status, 403)
  assert.equal((await request(routes)).status, 200, 'ordinary Web use remains available without Connection')
  disposed()
})
