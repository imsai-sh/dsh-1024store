import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectInstallation, readInstalledPluginId } from '../cli/profile.js'
import { SELF_PLUGIN_ID } from '../cli/constants.js'

const emptyState = {
  exists: false,
  dependencies: {},
  bundles: [],
  installedVersions: {},
}

test('verifies a newly installed GitHub dependency and resolves its version', () => {
  const after = {
    exists: true,
    dependencies: { '@example/plugin': 'github:Owner/Repo#v1' },
    bundles: ['@example/plugin'],
    installedVersions: { '@example/plugin': '1.2.3' },
  }
  assert.deepEqual(inspectInstallation(emptyState, after, 'owner/repo'), {
    beforePresent: false,
    afterPresent: true,
    packageNames: ['@example/plugin'],
    beforeVersion: null,
    afterVersion: '1.2.3',
  })
})

test('uses a local receipt to verify normalized dependency specs', () => {
  const before = {
    exists: true,
    dependencies: { plugin: 'git+ssh://git@host.invalid/resolved' },
    bundles: ['plugin'],
    installedVersions: { plugin: '2.0.0' },
  }
  const receipt = { packageNames: ['plugin'] }
  const result = inspectInstallation(before, before, 'owner/repo', receipt)
  assert.equal(result.beforePresent, true)
  assert.equal(result.afterPresent, true)
  assert.deepEqual(result.packageNames, ['plugin'])
})

test('verifies an npm semver dependency through known package names', () => {
  const after = {
    exists: true,
    dependencies: { dsh1024: '^0.3.0' },
    bundles: [],
    installedVersions: { dsh1024: '0.3.1' },
  }
  assert.deepEqual(inspectInstallation(emptyState, after, SELF_PLUGIN_ID, null, ['dsh1024']), {
    beforePresent: false,
    afterPresent: true,
    packageNames: ['dsh1024'],
    beforeVersion: null,
    afterVersion: '0.3.1',
  })
})

test('reports a pre-existing known package as present before for reinstall detection', () => {
  const state = {
    exists: true,
    dependencies: { dsh1024: '^0.3.0' },
    bundles: [],
    installedVersions: { dsh1024: '0.3.1' },
  }
  const result = inspectInstallation(state, state, SELF_PLUGIN_ID, null, ['dsh1024'])
  assert.equal(result.beforePresent, true)
  assert.equal(result.afterPresent, true)
  assert.equal(result.beforeVersion, '0.3.1')
  assert.equal(result.afterVersion, '0.3.1')
})

test('without known package names an npm semver dependency stays unverifiable', () => {
  const after = {
    exists: true,
    dependencies: { dsh1024: '^0.3.0' },
    bundles: [],
    installedVersions: { dsh1024: '0.3.1' },
  }
  assert.equal(inspectInstallation(emptyState, after, SELF_PLUGIN_ID).afterPresent, false)
})

test('does not accept an exit-zero command without observable profile state', () => {
  assert.equal(inspectInstallation(emptyState, emptyState, 'owner/repo').afterPresent, false)
})

test('bounds uploaded before and after versions to the API limit', () => {
  const longVersion = `1.0.0-${'x'.repeat(180)}`
  const state = {
    exists: true,
    dependencies: { plugin: `github:owner/repo#${'branch'.repeat(40)}` },
    bundles: ['plugin'],
    installedVersions: { plugin: longVersion },
  }
  const result = inspectInstallation(state, state, 'owner/repo')
  assert.equal(result.beforeVersion.length, 128)
  assert.equal(result.afterVersion.length, 128)
  assert.equal(result.afterVersion, longVersion.slice(0, 128))
})

test('dependency matching is bounded, so a shorter id cannot claim a longer one', () => {
  const state = (dependencies) => ({
    exists: true,
    profileDirectory: '/profiles/web',
    dependencies,
    bundles: [],
    installedVersions: {},
  })

  // `nest/plug` used to match `github:nest/plugin-x` through a bare substring test.
  const wrong = inspectInstallation(state({}), state({ 'plugin-x': 'github:nest/plugin-x' }), 'nest/plug')
  assert.equal(wrong.afterPresent, false)

  for (const spec of [
    'github:nest/plug',
    'github:nest/plug#v1.2.0',
    'github:nest/plug.git',
    'https://github.com/nest/plug.git',
    'git+ssh://git@github.com/nest/plug.git',
  ]) {
    const right = inspectInstallation(state({}), state({ plug: spec }), 'nest/plug')
    assert.equal(right.afterPresent, true, spec)
  }

  // A regex-special id must be matched literally, never as a pattern.
  const literal = inspectInstallation(state({}), state({ p: 'github:owner/a.b' }), 'owner/a.b')
  assert.equal(literal.afterPresent, true)
  const notAWildcard = inspectInstallation(state({}), state({ p: 'github:owner/axb' }), 'owner/a.b')
  assert.equal(notAWildcard.afterPresent, false)
})

test('the installed-manifest reader refuses traversal segments', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh1024-profile-'))
  const profileDirectory = join(dshHome, 'profiles', 'web')
  mkdirSync(join(profileDirectory, 'node_modules', 'real-plugin'), { recursive: true })
  writeFileSync(
    join(profileDirectory, 'node_modules', 'real-plugin', 'package.json'),
    JSON.stringify({ name: 'real-plugin', version: '1.0.0', repository: 'github:Owner/Plugin' }),
  )
  writeFileSync(join(dshHome, 'package.json'), JSON.stringify({ name: 'outside', repository: 'github:evil/outside' }))

  assert.equal(await readInstalledPluginId(dshHome, 'web', 'real-plugin'), 'owner/plugin')
  for (const name of ['../../..', '../../package.json', './real-plugin', '..', '.']) {
    assert.equal(await readInstalledPluginId(dshHome, 'web', name), null, name)
  }
})

test('monorepo siblings never claim each other installs', () => {
  const state = (dependencies) => ({
    exists: true,
    profileDirectory: '/profiles/web',
    dependencies,
    bundles: [],
    installedVersions: {},
  })
  const foo = 'github:owner/mono#path:packages/foo'
  const bar = 'github:owner/mono#path:packages/bar'

  // Installing `foo` must not read as a reinstall just because `bar` is present.
  const fresh = inspectInstallation(state({ bar }), state({ bar, foo }), 'owner/mono/packages/foo')
  assert.equal(fresh.beforePresent, false)
  assert.equal(fresh.afterPresent, true)

  // ...and `bar` keeps its own identity in the same profile.
  const sibling = inspectInstallation(state({ foo }), state({ foo, bar }), 'owner/mono/packages/bar')
  assert.equal(sibling.beforePresent, false)
  assert.equal(sibling.afterPresent, true)

  // A repository-root plugin is not satisfied by a subdirectory install.
  const root = inspectInstallation(state({}), state({ foo }), 'owner/mono')
  assert.equal(root.afterPresent, false)

  // ...and a subdirectory plugin is not satisfied by the repository root.
  const rootSpec = inspectInstallation(state({}), state({ p: 'github:owner/mono' }), 'owner/mono/packages/foo')
  assert.equal(rootSpec.afterPresent, false)

  // A ref alongside the path still matches.
  const withRef = inspectInstallation(
    state({}),
    state({ foo: 'github:owner/mono#v1.2.0&path:packages/foo' }),
    'owner/mono/packages/foo',
  )
  assert.equal(withRef.afterPresent, true)
})
