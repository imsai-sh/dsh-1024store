import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Isolated before the module under test resolves anything: routes read
// preferences and profiles under DSH_HOME, and the suite must never depend
// on (or touch) the developer's real ~/.dsh state.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh1024-routes-home-'))
import {
  installedPluginIds,
  isTrustedSameOrigin,
  mountMarketRoutes,
  parseDirectInstallCommand,
  readProfilePnpmStoreDir,
} from '../lib/routes.js'

const baseConfig = {
  profile: 'market-test',
  registryUrl: 'https://deepseek1024.com/api/v1/registry',
  updateUrl: 'https://deepseek1024.com/api/v1/self/update',
  sidebarEntry: true,
}

function routeHarness(embedUrl) {
  const routes = new Map()
  const dispose = mountMarketRoutes({
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }, { ...baseConfig, embedUrl })
  return { routes, dispose }
}

test('the shell exposes its validated embed URL without credentials', async () => {
  const { routes, dispose } = routeHarness('https://deepseek1024.com/embed/store?bridge=dsh1024-v1')
  let status = 0
  let body = ''
  await routes.get('/dsh1024/embed-config').handler(
    { method: 'GET' },
    {
      writeHead(value) { status = value },
      end(value = '') { body = String(value) },
    },
  )
  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(body), {
    url: 'https://deepseek1024.com/embed/store?bridge=dsh1024-v1',
    origin: 'https://deepseek1024.com',
    sidebarEntry: true,
  })
  dispose()
  assert.equal(routes.size, 0)
})

test('the shell serves its packaged sidebar icon locally with immutable caching', async () => {
  const { routes, dispose } = routeHarness('https://deepseek1024.com/embed/store?bridge=dsh1024-v1')
  let status = 0
  let headers = {}
  let body = null
  await routes.get('/dsh1024/icon').handler(
    { method: 'GET' },
    {
      writeHead(value, valueHeaders = {}) { status = value; headers = valueHeaders },
      end(value = '') { body = value },
    },
  )
  assert.equal(status, 200)
  assert.equal(headers['content-type'], 'image/png')
  assert.match(headers['cache-control'], /immutable/)
  assert.equal(Buffer.isBuffer(body), true)
  assert.equal(body.subarray(1, 4).toString(), 'PNG')
  dispose()
})

test('loopback HTTP is accepted for local preview but remote HTTP is rejected', () => {
  const { dispose } = routeHarness('http://127.0.0.1:14568/embed/store?bridge=dsh1024-v1')
  dispose()
  assert.throws(
    () => routeHarness('http://store.example/embed/store'),
    /embed URL must use HTTPS/,
  )
  assert.throws(
    () => routeHarness('https://user:secret@store.example/embed/store'),
    /cannot contain credentials/,
  )
})

test('same-origin mutations work on private LAN addresses without trusting public hostnames', () => {
  assert.equal(isTrustedSameOrigin('http://127.0.0.1:14567', '127.0.0.1:14567'), true)
  assert.equal(isTrustedSameOrigin('http://192.168.1.42:14567', '192.168.1.42:14567'), true)
  assert.equal(isTrustedSameOrigin('http://172.20.0.3:14567', '172.20.0.3:14567'), true)
  assert.equal(isTrustedSameOrigin('http://harness.local:14567', 'harness.local:14567'), true)
  assert.equal(isTrustedSameOrigin('http://public.example:14567', 'public.example:14567'), false)
  assert.equal(isTrustedSameOrigin('http://192.168.1.42:14567', '127.0.0.1:14567'), false)
  assert.equal(isTrustedSameOrigin('https://evil.example', '192.168.1.42:14567'), false)
})

test('installed dependencies map to catalog ids without exposing their specs', () => {
  const plugins = [
    {
      id: 'owner/mono', name: 'mono-root', owner: 'owner',
      url: 'https://github.com/owner/mono', category: 'tools', description: { en: 'root' },
      install: 'dsh plugin add github:owner/mono', added: '2026-01-01',
    },
    {
      id: 'owner/mono/packages/child', name: 'child', owner: 'owner',
      url: 'https://github.com/owner/mono', category: 'tools', description: { en: 'child' },
      install: 'dsh plugin add github:owner/mono#path:packages/child', added: '2026-01-01',
    },
    {
      id: 'owner/npm-plugin', name: 'npm-plugin', owner: 'owner',
      url: 'https://github.com/owner/npm-plugin', category: 'tools', description: { en: 'npm' },
      install: 'dsh plugin add published-plugin', target: 'published-plugin', added: '2026-01-01',
    },
  ]
  const installed = {
    child: 'github:owner/mono#path:packages/child&commit=abc123',
    'published-plugin': '^1.2.3',
  }

  assert.deepEqual(installedPluginIds(installed, plugins), [
    'owner/mono/packages/child',
    'owner/npm-plugin',
  ])
})

test('a page-supplied install command must be a plain official dsh plugin command', () => {
  // The embedded page hands over the full command it displays; everything
  // after `dsh` is forwarded to the official CLI verbatim. The gate pins the
  // shape — `dsh plugin …` out of inert tokens — so no shell metacharacter,
  // quoting, or non-plugin subcommand can ride along.
  assert.deepEqual(
    parseDirectInstallCommand('dsh plugin --profile web add @scope/dsh-plugin'),
    ['plugin', '--profile', 'web', 'add', '@scope/dsh-plugin'],
  )
  assert.deepEqual(
    parseDirectInstallCommand('  dsh plugin --profile web add dsh1024@latest  '),
    ['plugin', '--profile', 'web', 'add', 'dsh1024@latest'],
  )
  for (const command of [
    'dsh telemetry disable',
    'dsh1024 plugin --profile web add x',
    'rm -rf /',
    'dsh plugin add "quoted target"',
    'dsh plugin add pkg; rm -rf /',
    'dsh plugin add pkg && curl evil',
    'dsh plugin add pkg | tee /tmp/x',
    'dsh plugin add `whoami`',
    'dsh plugin add $(whoami)',
    'dsh plugin add pkg%PATH%',
    'dsh plugin',
    'dsh plugin add',
    '', 42, null, undefined,
  ]) {
    assert.equal(parseDirectInstallCommand(command), null, String(command))
  }
})

test('a source-installed plugin stays recognized after its entry goes npm-only', () => {
  // The user installed from GitHub before the store switched to npm-only
  // installs; the registry entry now advertises the npm target, but the
  // manifest spec still points at the repository. Recognition must survive
  // through the URL scan, or the store shows an installed plugin as absent.
  const plugins = [{
    id: 'owner/legacy', name: 'legacy', owner: 'owner',
    url: 'https://github.com/owner/legacy', category: 'tools', description: { en: 'legacy' },
    install: 'dsh plugin add published-legacy', target: 'published-legacy', added: '2026-01-01',
  }]
  const installed = { legacy: 'github:owner/legacy&commit=abc123' }

  assert.deepEqual(installedPluginIds(installed, plugins), ['owner/legacy'])
})

test('plugin installs reuse the pnpm store already linked to the profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'dsh1024-store-dir-'))
  const modules = join(profile, 'node_modules')
  await mkdir(modules)
  await writeFile(join(modules, '.modules.yaml'), JSON.stringify({
    storeDir: '/private/tmp/.pnpm-store/v10',
  }))
  assert.equal(readProfilePnpmStoreDir(profile), '/private/tmp/.pnpm-store/v10')

  await writeFile(join(modules, '.modules.yaml'), "storeDir: '/tmp/yaml-pnpm-store/v10'\n")
  assert.equal(readProfilePnpmStoreDir(profile), '/tmp/yaml-pnpm-store/v10')

  await writeFile(join(modules, '.modules.yaml'), JSON.stringify({ storeDir: '../unsafe' }))
  assert.equal(readProfilePnpmStoreDir(profile), undefined)
})
