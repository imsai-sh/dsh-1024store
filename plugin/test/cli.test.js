import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main } from '../cli/index.js'
import { CLI_VERSION, EVENT_KEYS, SELF_PLUGIN_ID } from '../cli/constants.js'

function fakeChild({ status = 0, error = null } = {}) {
  const child = new EventEmitter()
  child.pid = 4242
  child.stdout = null
  child.stderr = null
  child.kill = () => {}
  queueMicrotask(() => {
    if (error !== null) child.emit('error', error)
    else child.emit('close', status)
  })
  return child
}

function clock(start = '2026-08-15T01:00:00.000Z') {
  let value = new Date(start).getTime()
  return () => {
    const result = new Date(value)
    value += 1000
    return result
  }
}

function uuidSequence(...values) {
  let index = 0
  return () => values[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function ioCapture() {
  const stdout = []
  const stderr = []
  return {
    io: { stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value) },
    stdout,
    stderr,
  }
}

function installProfile(dshHome, profile = 'web', version = '1.2.3') {
  const directory = join(dshHome, 'profiles', profile)
  const moduleDirectory = join(directory, 'node_modules', '@demo', 'plugin')
  mkdirSync(moduleDirectory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    dependencies: { '@demo/plugin': 'github:owner/repo#v1.2.3' },
    dsh: { profile: { bundles: ['@demo/plugin'] } },
  }))
  writeFileSync(join(moduleDirectory, 'package.json'), JSON.stringify({ name: '@demo/plugin', version }))
}

/** Simulate the official CLI installing a published package into a profile. */
function installNpmPlugin(dshHome, profile, packageName, manifest) {
  const directory = join(dshHome, 'profiles', profile)
  const moduleDirectory = join(directory, 'node_modules', ...packageName.split('/'))
  mkdirSync(moduleDirectory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    dependencies: { [packageName]: `^${manifest.version}` },
    dsh: { profile: { bundles: [packageName] } },
  }))
  writeFileSync(join(moduleDirectory, 'package.json'), JSON.stringify({ name: packageName, ...manifest }))
}

async function makeHome() {
  return mkdtemp(join(tmpdir(), 'dsh1024-cli-'))
}

function installSelfProfile(dshHome, profile = 'web', version = '0.3.1') {
  const directory = join(dshHome, 'profiles', profile)
  const moduleDirectory = join(directory, 'node_modules', 'dsh1024')
  mkdirSync(moduleDirectory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    dependencies: { dsh1024: '^0.3.0' },
  }))
  writeFileSync(join(moduleDirectory, 'package.json'), JSON.stringify({ name: 'dsh1024', version }))
}

test('delegates without a shell, verifies state, receipts locally, and posts the strict event schema', async () => {
  const dshHome = await makeHome()
  const output = ioCapture()
  const requests = []
  let invocation
  const exitCode = await main([
    'plugin',
    '--profile',
    'web',
    'add',
    'github:Owner/Repo#v1.2.3',
    '--ignore-scripts',
    '--',
    '--reporter',
    'append-only',
    'value;still-one-argument',
  ], {
    dshHome,
    arch: 'x64',
    env: {
      DSH_1024STORE_DSH_PACKAGE: '@deepseek-ai/dsh@0.1.0-rc.5',
      DSH_1024STORE_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events',
      CI: '1',
    },
    io: output.io,
    platform: 'linux',
    now: clock(),
    uuid: uuidSequence(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ),
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, 'npx')
  // Byte-for-byte the user's own vector, with only the npx prefix in front.
  assert.deepEqual(invocation.args, [
    '--yes',
    '@deepseek-ai/dsh@0.1.0-rc.5',
    'plugin',
    '--profile',
    'web',
    'add',
    'github:Owner/Repo#v1.2.3',
    '--ignore-scripts',
    '--',
    '--reporter',
    'append-only',
    'value;still-one-argument',
  ])
  assert.equal(invocation.options.shell, false)
  assert.equal(requests.length, 1)

  const event = JSON.parse(requests[0].options.body)
  assert.deepEqual(Object.keys(event), EVENT_KEYS)
  assert.equal(event.clientId, '11111111-1111-4111-8111-111111111111')
  assert.equal(event.eventId, '22222222-2222-4222-8222-222222222222')
  assert.equal(event.pluginId, 'owner/repo')
  assert.equal(event.operation, 'install')
  assert.equal(event.status, 'success')
  assert.equal(event.afterVersion, '1.2.3')
  assert.equal(event.requestedRef, 'v1.2.3')
  assert.equal(event.dshVersion, '0.1.0-rc.5')
  assert.equal(event.sourceChannel, 'dsh-1024store-cli')
  assert.equal(event.isCi, true)
  assert.equal(requests[0].options.headers['user-agent'], `dsh1024/${CLI_VERSION}`)
  assert.equal('packageNames' in event, false)
  assert.equal(requests[0].options.body.includes('--ignore-scripts'), false)
  assert.equal(requests[0].options.body.includes('append-only'), false)
  assert.equal(requests[0].options.body.includes('value;still-one-argument'), false)

  const receipt = JSON.parse(await readFile(join(dshHome, '.dsh-1024store', 'receipts.json'), 'utf8'))
  const installed = Object.values(receipt.plugins)[0]
  assert.deepEqual(installed.packageNames, ['@demo/plugin'])
  assert.equal(installed.packages['@demo/plugin'].version, '1.2.3')
  assert.match(output.stderr[0], /records anonymous plugin install outcomes/)
})

test('uses the npm JavaScript entrypoint on Windows and preserves argument boundaries', async () => {
  const dshHome = await makeHome()
  const nodeExecutable = 'C:\\Program Files\\nodejs\\node.exe'
  const npmExecPath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  let invocation
  const exitCode = await main([
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo',
    '--',
    '--',
    'value&still-one-argument',
    '%PATH%',
  ], {
    dshHome,
    env: { DO_NOT_TRACK: '1', npm_execpath: npmExecPath },
    execPath: nodeExecutable,
    platform: 'win32',
    io: ioCapture().io,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, nodeExecutable)
  assert.deepEqual(invocation.args, [
    npmExecPath,
    'exec',
    '--yes',
    '--',
    '@deepseek-ai/dsh',
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo',
    '--',
    '--',
    'value&still-one-argument',
    '%PATH%',
  ])
  assert.equal(invocation.options.shell, false)
})

test('bounds the reported DSH version to the Worker contract', async () => {
  const dshHome = await makeHome()
  const events = []
  const longVersion = `v${'1'.repeat(99)}`
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: { DSH_1024STORE_DSH_VERSION: longVersion },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(
      '12121212-1212-4121-8121-121212121212',
      '34343434-3434-4343-8343-343434343434',
    ),
    spawn() {
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(events[0].dshVersion, longVersion.slice(0, 64))
})

test('reports reinstall when the plugin already exists', async () => {
  const dshHome = await makeHome()
  installProfile(dshHome)
  const events = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {},
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ),
    spawn() { return fakeChild() },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true }
    },
  })
  assert.equal(exitCode, 0)
  assert.equal(events[0].operation, 'reinstall')
})

test('DO_NOT_TRACK disables identity creation, queueing, and upload', async () => {
  const dshHome = await makeHome()
  let fetchCalls = 0
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: { DO_NOT_TRACK: '1' },
    io: ioCapture().io,
    spawn() {
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl() {
      fetchCalls += 1
      throw new Error('must not upload')
    },
  })
  assert.equal(exitCode, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'client.json')), false)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'pending.json')), false)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'receipts.json')), true)
})

test('legacy DSH_1024STORE_TELEMETRY=0 disables identity creation, queueing, and upload', async () => {
  const dshHome = await makeHome()
  let fetchCalls = 0
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: { DSH_1024STORE_TELEMETRY: '0' },
    io: ioCapture().io,
    spawn() {
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl() {
      fetchCalls += 1
      throw new Error('must not upload')
    },
  })
  assert.equal(exitCode, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'client.json')), false)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'pending.json')), false)
})

test('DSH1024_TELEMETRY=0 disables identity creation, queueing, and upload', async () => {
  const dshHome = await makeHome()
  let fetchCalls = 0
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: { DSH1024_TELEMETRY: '0' },
    io: ioCapture().io,
    spawn() {
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl() {
      fetchCalls += 1
      throw new Error('must not upload')
    },
  })
  assert.equal(exitCode, 0)
  assert.equal(fetchCalls, 0)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'client.json')), false)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'pending.json')), false)
})

test('prefers DSH1024_* over the legacy DSH_1024STORE_* variables', async () => {
  const dshHome = await makeHome()
  const requests = []
  let invocation
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {
      DSH1024_TELEMETRY: '1',
      DSH_1024STORE_TELEMETRY: '0',
      DSH1024_DSH_PACKAGE: '@deepseek-ai/dsh@0.2.0',
      DSH_1024STORE_DSH_PACKAGE: '@deepseek-ai/dsh@0.1.0',
      DSH1024_TELEMETRY_URL: 'http://modern.invalid/api/v1/install-events',
      DSH_1024STORE_TELEMETRY_URL: 'http://legacy.invalid/api/v1/install-events',
    },
    io: ioCapture().io,
    platform: 'linux',
    now: clock(),
    uuid: uuidSequence(
      'abababab-abab-4bab-8bab-abababababab',
      'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
    ),
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })
  assert.equal(exitCode, 0)
  assert.equal(invocation.args[1], '@deepseek-ai/dsh@0.2.0')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://modern.invalid/api/v1/install-events')
  assert.equal(JSON.parse(requests[0].options.body).dshVersion, '0.2.0')
})

test('keeps failed uploads and retries them before the next current event', async () => {
  const dshHome = await makeHome()
  const firstOutput = ioCapture()
  await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {},
    io: firstOutput.io,
    now: clock(),
    uuid: uuidSequence(
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ),
    spawn() {
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl() { throw new Error('offline') },
  })
  let pending = JSON.parse(readFileSync(join(dshHome, '.dsh-1024store', 'pending.json'), 'utf8'))
  assert.equal(pending.events.length, 1)
  assert.match(firstOutput.stderr.at(-1), /queued locally/)

  const delivered = []
  await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {},
    io: ioCapture().io,
    now: clock('2026-08-15T02:00:00.000Z'),
    uuid: uuidSequence('77777777-7777-4777-8777-777777777777'),
    spawn() { return fakeChild() },
    async fetchImpl(_url, options) {
      delivered.push(JSON.parse(options.body))
      return { ok: true }
    },
  })
  assert.deepEqual(delivered.map((event) => event.eventId), [
    '66666666-6666-4666-8666-666666666666',
    '77777777-7777-4777-8777-777777777777',
  ])
  pending = JSON.parse(readFileSync(join(dshHome, '.dsh-1024store', 'pending.json'), 'utf8'))
  assert.deepEqual(pending.events, [])
})

test('preserves official exit code and emits a narrow failed event', async () => {
  const dshHome = await makeHome()
  const events = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {},
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(
      '88888888-8888-4888-8888-888888888888',
      '99999999-9999-4999-8999-999999999999',
    ),
    spawn() { return fakeChild({ status: 7 }) },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true }
    },
  })
  assert.equal(exitCode, 7)
  assert.equal(events[0].status, 'failed')
  assert.equal(events[0].errorCode, 'OFFICIAL_CLI_FAILED')
  assert.equal(JSON.stringify(events[0]).includes('stderr'), false)
  assert.equal(JSON.stringify(events[0]).includes(dshHome), false)
})

test('reports spawn errors without exposing the error message', async () => {
  const dshHome = await makeHome()
  const events = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {},
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    ),
    spawn() { return fakeChild({ error: new Error('sensitive local spawn detail') }) },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true }
    },
  })
  assert.equal(exitCode, 1)
  assert.equal(events[0].errorCode, 'SPAWN_FAILED')
  assert.equal(JSON.stringify(events[0]).includes('sensitive'), false)
})

test('turns an unverifiable exit-zero result into a wrapper failure', async () => {
  const dshHome = await makeHome()
  const events = []
  const output = ioCapture()
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {},
    io: output.io,
    now: clock(),
    uuid: uuidSequence(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ),
    spawn() { return fakeChild() },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true }
    },
  })
  assert.equal(exitCode, 1)
  assert.equal(events[0].errorCode, 'PROFILE_NOT_UPDATED')
  assert.match(output.stderr.join('\n'), /could not verify/)
})

test('installing the store package reports npm-backed metadata for the catalog entry', async () => {
  const dshHome = await makeHome()
  const events = []
  let invocation
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'dsh1024'], {
    dshHome,
    env: {},
    io: ioCapture().io,
    platform: 'linux',
    now: clock(),
    uuid: uuidSequence(
      '10241024-1024-4024-8024-102410241024',
      '20242024-2024-4024-8024-202420242024',
    ),
    spawn(command, args, options) {
      invocation = { command, args, options }
      installSelfProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, 'npx')
  assert.deepEqual(invocation.args, [
    '--yes',
    '@deepseek-ai/dsh',
    'plugin',
    '--profile',
    'web',
    'add',
    'dsh1024',
  ])
  assert.equal(invocation.options.shell, false)
  assert.deepEqual(Object.keys(events[0]), EVENT_KEYS)
  assert.equal(events[0].pluginId, SELF_PLUGIN_ID)
  assert.equal(events[0].requestedRef, null)
  assert.equal(events[0].operation, 'install')
  assert.equal(events[0].status, 'success')
  assert.equal(events[0].afterVersion, '0.3.1')
  assert.equal(events[0].sourceChannel, 'dsh-1024store-cli')

  const receipt = JSON.parse(await readFile(join(dshHome, '.dsh-1024store', 'receipts.json'), 'utf8'))
  const installed = Object.values(receipt.plugins)[0]
  assert.deepEqual(installed.packageNames, ['dsh1024'])
  assert.equal(installed.packages.dsh1024.version, '0.3.1')

  const secondRun = []
  assert.equal(await main(['plugin', '--profile', 'web', 'add', 'dsh1024'], {
    dshHome,
    env: {},
    io: ioCapture().io,
    now: clock('2026-08-15T02:00:00.000Z'),
    uuid: uuidSequence('30243024-3024-4024-8024-302430243024'),
    spawn() { return fakeChild() },
    async fetchImpl(_url, options) {
      secondRun.push(JSON.parse(options.body))
      return { ok: true }
    },
  }), 0)
  assert.equal(secondRun.at(-1).operation, 'reinstall')
  assert.equal(secondRun.at(-1).pluginId, SELF_PLUGIN_ID)
})

test('the store package install uses the npm JavaScript entrypoint on Windows and keeps argument boundaries', async () => {
  const dshHome = await makeHome()
  const nodeExecutable = 'C:\\Program Files\\nodejs\\node.exe'
  const npmExecPath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  let invocation
  const exitCode = await main(['plugin', '--profile', 'desktop', 'add', 'dsh1024', '--', '--ignore-scripts'], {
    dshHome,
    env: { DO_NOT_TRACK: '1', npm_execpath: npmExecPath },
    execPath: nodeExecutable,
    platform: 'win32',
    io: ioCapture().io,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installSelfProfile(dshHome, 'desktop')
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, nodeExecutable)
  assert.deepEqual(invocation.args, [
    npmExecPath,
    'exec',
    '--yes',
    '--',
    '@deepseek-ai/dsh',
    'plugin',
    '--profile',
    'desktop',
    'add',
    'dsh1024',
    '--',
    '--ignore-scripts',
  ])
  assert.equal(invocation.options.shell, false)
})

test('the store package install succeeds when the dependency already exists with an unchanged spec and no receipt', async () => {
  const dshHome = await makeHome()
  installSelfProfile(dshHome)
  const events = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'dsh1024'], {
    dshHome,
    env: {},
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(
      '40244024-4024-4024-8024-402440244024',
      '50245024-5024-4024-8024-502450245024',
    ),
    spawn() { return fakeChild() },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(events[0].status, 'success')
  assert.equal(events[0].errorCode, null)
  assert.equal(events[0].operation, 'reinstall')
  assert.equal(events[0].afterVersion, '0.3.1')
})

test('telemetry controls persist status and reset identity plus queue', async () => {
  const dshHome = await makeHome()
  const storeDirectory = join(dshHome, '.dsh-1024store')
  mkdirSync(storeDirectory, { recursive: true })
  writeFileSync(join(storeDirectory, 'pending.json'), JSON.stringify({ schemaVersion: 1, events: [{}] }))
  const disabled = ioCapture()
  assert.equal(await main(['telemetry', 'disable'], {
    dshHome,
    env: {},
    io: disabled.io,
    now: clock(),
    uuid: uuidSequence('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  }), 0)
  assert.match(disabled.stdout[0], /disabled/)
  assert.equal(existsSync(join(storeDirectory, 'pending.json')), false)
  const originalConfig = JSON.parse(readFileSync(join(storeDirectory, 'client.json'), 'utf8'))
  assert.equal(originalConfig.enabled, false)

  const status = ioCapture()
  await main(['telemetry', 'status'], { dshHome, env: { DO_NOT_TRACK: '1' }, io: status.io })
  assert.match(status.stdout[0], /effective: disabled \(environment override active\)/)

  writeFileSync(join(storeDirectory, 'pending.json'), JSON.stringify({ schemaVersion: 1, events: [{}] }))
  const reset = ioCapture()
  await main(['telemetry', 'reset'], {
    dshHome,
    env: {},
    io: reset.io,
    now: clock(),
    uuid: uuidSequence('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  })
  const rotatedConfig = JSON.parse(readFileSync(join(storeDirectory, 'client.json'), 'utf8'))
  assert.equal(rotatedConfig.clientId, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
  assert.notEqual(rotatedConfig.clientId, originalConfig.clientId)
  assert.equal(rotatedConfig.enabled, false)
  assert.equal(existsSync(join(storeDirectory, 'pending.json')), false)
  assert.match(reset.stdout[0], /preference was preserved/)
})

test('reuses an official dsh already on PATH and passes arguments through unchanged', async () => {
  const dshHome = await makeHome()
  let invocation
  const exitCode = await main([
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo#v1.2.3',
    '--ignore-scripts',
    '--',
    '--reporter',
    'append-only',
  ], {
    dshHome,
    env: { DO_NOT_TRACK: '1', PATH: '/opt/empty:/opt/bin' },
    platform: 'linux',
    io: ioCapture().io,
    canExecute: (candidate) => candidate === '/opt/bin/dsh',
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, '/opt/bin/dsh')
  assert.deepEqual(invocation.args, [
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo#v1.2.3',
    '--ignore-scripts',
    '--',
    '--reporter',
    'append-only',
  ])
  assert.equal(invocation.options.shell, false)
})

test('falls back to npx when PATH has no official dsh', async () => {
  const dshHome = await makeHome()
  let invocation
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: { DO_NOT_TRACK: '1', PATH: '/opt/empty' },
    platform: 'linux',
    io: ioCapture().io,
    canExecute: () => false,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, 'npx')
  assert.deepEqual(invocation.args, [
    '--yes',
    '@deepseek-ai/dsh',
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo',
  ])
})

test('an explicit package override always goes through npx so the version stays pinnable', async () => {
  const dshHome = await makeHome()
  let invocation
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {
      DO_NOT_TRACK: '1',
      PATH: '/opt/bin',
      DSH1024_DSH_PACKAGE: '@deepseek-ai/dsh@0.4.0',
    },
    platform: 'linux',
    io: ioCapture().io,
    canExecute: (candidate) => candidate === '/opt/bin/dsh',
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, 'npx')
  assert.deepEqual(invocation.args.slice(0, 2), ['--yes', '@deepseek-ai/dsh@0.4.0'])
})

test('resolves dsh through PATHEXT on Windows', async () => {
  const dshHome = await makeHome()
  let invocation
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {
      DO_NOT_TRACK: '1',
      PATH: 'C:\\tools;C:\\bin',
      PATHEXT: '.COM;.EXE;.CMD',
    },
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    platform: 'win32',
    io: ioCapture().io,
    canExecute: (candidate) => candidate === 'C:\\bin\\dsh.cmd',
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, 'C:\\bin\\dsh.cmd')
  assert.deepEqual(invocation.args, [
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo',
  ])
})

test('falls back to the npm entrypoint when Windows PATH has no dsh', async () => {
  const dshHome = await makeHome()
  const nodeExecutable = 'C:\\Program Files\\nodejs\\node.exe'
  const npmExecPath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  let invocation
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {
      DO_NOT_TRACK: '1',
      PATH: 'C:\\tools',
      PATHEXT: '.COM;.EXE;.CMD',
      npm_execpath: npmExecPath,
    },
    execPath: nodeExecutable,
    platform: 'win32',
    io: ioCapture().io,
    canExecute: () => false,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(invocation.command, nodeExecutable)
  assert.deepEqual(invocation.args.slice(0, 5), [
    npmExecPath,
    'exec',
    '--yes',
    '--',
    '@deepseek-ai/dsh',
  ])
})

test('telemetry reports a null DSH version when the CLI came from PATH', async () => {
  const dshHome = await makeHome()
  const requests = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo'], {
    dshHome,
    env: {
      PATH: '/opt/bin',
      DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events',
    },
    platform: 'linux',
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: (candidate) => candidate === '/opt/bin/dsh',
    spawn() {
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(requests.length, 1)
  assert.equal(JSON.parse(requests[0].options.body).dshVersion, null)
})

test('forwards an omitted --profile as written instead of injecting a default', async () => {
  const dshHome = await makeHome()
  let invocation
  const exitCode = await main(['plugin', 'add', 'github:owner/repo'], {
    dshHome,
    env: { DO_NOT_TRACK: '1' },
    platform: 'linux',
    io: ioCapture().io,
    canExecute: () => false,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
  })

  assert.equal(exitCode, 0)
  assert.deepEqual(invocation.args, ['--yes', '@deepseek-ai/dsh', 'plugin', 'add', 'github:owner/repo'])
})

test('a local path target is installed but never reported', async () => {
  const dshHome = await makeHome()
  const requests = []
  let invocation
  const exitCode = await main(['plugin', '--profile', 'web', 'add', './work/secret-plugin'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    platform: 'linux',
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  // Forwarded exactly as written...
  assert.deepEqual(invocation.args, [
    '--yes',
    '@deepseek-ai/dsh',
    'plugin',
    '--profile',
    'web',
    'add',
    './work/secret-plugin',
  ])
  // ...but nothing is uploaded and no local state records the path.
  assert.equal(requests.length, 0)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'receipts.json')), false)
  assert.equal(existsSync(join(dshHome, '.dsh-1024store', 'pending.json')), false)
})

test('resolves a published package to its catalog id from the installed manifest', async () => {
  const dshHome = await makeHome()
  const events = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', '@opendsh/dsh-plugin-setting-mcp@1.2.3'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    platform: 'linux',
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() {
      installNpmPlugin(dshHome, 'web', '@opendsh/dsh-plugin-setting-mcp', {
        repository: { type: 'git', url: 'git+https://github.com/OpenDSH/dsh-plugin-setting-mcp.git' },
        version: '1.2.3',
      })
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(events.length, 1)
  assert.equal(events[0].pluginId, 'opendsh/dsh-plugin-setting-mcp')
  assert.equal(events[0].status, 'success')
  assert.equal(events[0].afterVersion, '1.2.3')
  assert.equal(events[0].requestedRef, null)
})

test('accepts a plain string repository field', async () => {
  const dshHome = await makeHome()
  const events = []
  await main(['plugin', '--profile', 'web', 'add', 'some-dsh-plugin'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() {
      installNpmPlugin(dshHome, 'web', 'some-dsh-plugin', {
        repository: 'github:Owner/Plugin',
        version: '0.4.0',
      })
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(events.length, 1)
  assert.equal(events[0].pluginId, 'owner/plugin')
})

test('does not count a published package whose manifest is not a GitHub repository', async () => {
  const dshHome = await makeHome()
  const requests = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'some-dsh-plugin'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() {
      installNpmPlugin(dshHome, 'web', 'some-dsh-plugin', {
        repository: 'https://gitlab.com/owner/plugin.git',
        version: '0.4.0',
      })
      return fakeChild()
    },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(requests.length, 0)
})

test('does not count a published package with no manifest to read', async () => {
  const dshHome = await makeHome()
  const requests = []
  await main(['plugin', '--profile', 'web', 'add', 'never-installed-plugin'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() { return fakeChild() },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.equal(requests.length, 0)
})

test('a failed published-package install is not counted, since the lookup is impossible', async () => {
  const dshHome = await makeHome()
  const requests = []
  const exitCode = await main(['plugin', '--profile', 'web', 'add', 'some-dsh-plugin'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() { return fakeChild({ status: 3 }) },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 3)
  assert.equal(requests.length, 0)
})

test('an omitted profile is forwarded as written and never counted', async () => {
  const dshHome = await makeHome()
  const requests = []
  let invocation
  await main(['plugin', 'add', 'github:owner/repo'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    platform: 'linux',
    canExecute: () => false,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.deepEqual(invocation.args, ['--yes', '@deepseek-ai/dsh', 'plugin', 'add', 'github:owner/repo'])
  assert.equal(requests.length, 0)
})

test('an install aimed outside the profile dependencies is never counted', async () => {
  const dshHome = await makeHome()
  const requests = []
  await main(['plugin', '--profile', 'web', 'add', 'github:owner/repo', '--global'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() {
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(url, options) {
      requests.push({ url, options })
      return { ok: true, status: 202 }
    },
  })

  assert.equal(requests.length, 0)
})

test('preserves the official exit code for an unattributed target', async () => {
  const dshHome = await makeHome()
  const exitCode = await main(['plugin', '--profile', 'web', 'add', './local/plugin'], {
    dshHome,
    env: { DO_NOT_TRACK: '1' },
    platform: 'linux',
    io: ioCapture().io,
    canExecute: () => false,
    spawn() { return fakeChild({ status: 7 }) },
  })

  assert.equal(exitCode, 7)
})

test('no location target can ever produce an event or local state', async () => {
  const locations = [
    './plugin', '../plugin', './a/b/c', '../../a/b',
    '/absolute/path/plugin', '/tmp/secret-plugin', '/var/folders/zz/work',
    '~', '~/plugins/mine', '~/.ssh/config',
    'C:\\Users\\someone\\plugin', 'D:/work/plugin',
    'file:./plugin', 'file:../plugin', 'file:///absolute/plugin',
    'link:./plugin', 'portal:./plugin',
    'https://example.com/plugin.tgz', 'http://example.com/plugin.tgz',
    'https://github.com/owner/plugin.git', 'git+https://github.com/owner/plugin.git',
    'git@github.com:owner/plugin.git', 'ssh://git@github.com/owner/plugin.git',
    'git://github.com/owner/plugin.git',
    'gitlab:owner/plugin', 'bitbucket:owner/plugin', 'gist:0123456789abcdef',
    'jsr:@scope/name', 'workspace:*', 'catalog:default', 'alias@npm:real-package',
    './node_modules/x', '.\\plugin', '~user/plugin', '/', '\\',
    'file:', 'link:', 'portal:', '../../../etc/passwd',
  ]
  assert.ok(locations.length >= 40, `expected a broad corpus, saw ${locations.length}`)

  for (const target of locations) {
    const dshHome = await makeHome()
    const requests = []
    await main(['plugin', '--profile', 'web', 'add', target], {
      dshHome,
      env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
      io: ioCapture().io,
      now: clock(),
      uuid: uuidSequence(),
      canExecute: () => false,
      spawn() {
        installProfile(dshHome)
        return fakeChild()
      },
      async fetchImpl(url, options) {
        requests.push({ url, options })
        return { ok: true, status: 202 }
      },
    })

    assert.equal(requests.length, 0, `reported an event for ${target}`)
    const storeDirectory = join(dshHome, '.dsh-1024store')
    assert.equal(existsSync(join(storeDirectory, 'receipts.json')), false, `wrote a receipt for ${target}`)
    assert.equal(existsSync(join(storeDirectory, 'pending.json')), false, `queued an event for ${target}`)
  }
})

test('a reported event carries an owner/repository id and nothing path-shaped', async () => {
  const dshHome = await makeHome()
  const events = []
  await main(['plugin', '--profile', 'web', 'add', '@opendsh/dsh-plugin-setting-mcp'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() {
      installNpmPlugin(dshHome, 'web', '@opendsh/dsh-plugin-setting-mcp', {
        repository: { type: 'git', url: 'git+https://github.com/OpenDSH/dsh-plugin-setting-mcp.git' },
        version: '2.0.0',
      })
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(events.length, 1)
  const [event] = events
  assert.equal(event.pluginId, 'opendsh/dsh-plugin-setting-mcp')
  // The lookup reads a local manifest; none of it may leak into the event.
  const serialized = JSON.stringify(event)
  for (const forbidden of ['"/', ' /', '~', 'file:', 'link:', 'portal:', 'node_modules', tmpdir()]) {
    assert.ok(!serialized.includes(forbidden), `event leaked ${forbidden}: ${serialized}`)
  }
  assert.match(event.pluginId, /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/)
})

test('a separated option value does not cost the install its count', async () => {
  const dshHome = await makeHome()
  const events = []
  let invocation
  const exitCode = await main([
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo',
    '--reporter',
    'append-only',
  ], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    platform: 'linux',
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn(command, args, options) {
      invocation = { command, args, options }
      installProfile(dshHome)
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  // Still forwarded verbatim...
  assert.deepEqual(invocation.args, [
    '--yes',
    '@deepseek-ai/dsh',
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/repo',
    '--reporter',
    'append-only',
  ])
  // ...and now counted, where it used to be silently dropped.
  assert.equal(events.length, 1)
  assert.equal(events[0].pluginId, 'owner/repo')
  assert.equal(events[0].status, 'success')
})

test('a monorepo subpackage is reported under its own plugin id', async () => {
  const dshHome = await makeHome()
  const events = []
  const exitCode = await main([
    'plugin',
    '--profile',
    'web',
    'add',
    'github:owner/mono#path:packages/foo',
  ], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() {
      const directory = join(dshHome, 'profiles', 'web')
      const moduleDirectory = join(directory, 'node_modules', 'foo-plugin')
      mkdirSync(moduleDirectory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({
        dependencies: {
          'bar-plugin': 'github:owner/mono#path:packages/bar',
          'foo-plugin': 'github:owner/mono#path:packages/foo',
        },
        dsh: { profile: { bundles: ['foo-plugin'] } },
      }))
      writeFileSync(join(moduleDirectory, 'package.json'), JSON.stringify({ name: 'foo-plugin', version: '1.0.0' }))
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(exitCode, 0)
  assert.equal(events.length, 1)
  assert.equal(events[0].pluginId, 'owner/mono/packages/foo')
  // The sibling already in the profile must not turn this into a reinstall.
  assert.equal(events[0].operation, 'install')
  assert.equal(events[0].status, 'success')
})

test('a published subpackage resolves through its manifest directory', async () => {
  const dshHome = await makeHome()
  const events = []
  await main(['plugin', '--profile', 'web', 'add', '@owner/foo-plugin'], {
    dshHome,
    env: { DSH1024_TELEMETRY_URL: 'http://telemetry.invalid/api/v1/install-events' },
    io: ioCapture().io,
    now: clock(),
    uuid: uuidSequence(),
    canExecute: () => false,
    spawn() {
      installNpmPlugin(dshHome, 'web', '@owner/foo-plugin', {
        repository: { type: 'git', url: 'git+https://github.com/Owner/Mono.git', directory: 'packages/foo' },
        version: '1.0.0',
      })
      return fakeChild()
    },
    async fetchImpl(_url, options) {
      events.push(JSON.parse(options.body))
      return { ok: true, status: 202 }
    },
  })

  assert.equal(events.length, 1)
  assert.equal(events[0].pluginId, 'owner/mono/packages/foo')
})
