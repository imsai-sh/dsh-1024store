import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attributeTarget,
  parseArgs,
  pluginIdFromRepositoryField,
  scanPluginArgs,
  splitPackageSpec,
  UsageError,
} from '../cli/args.js'
import { SELF_PACKAGE_NAME, SELF_PLUGIN_ID } from '../cli/constants.js'

/** Every scan must leave the forwarded vector byte-for-byte identical. */
function scanned(argv) {
  const parsed = parseArgs([...argv])
  assert.deepEqual(parsed.officialArgs, argv, `forwarded vector changed for ${JSON.stringify(argv)}`)
  return parsed
}

test('forwards the official argument vector verbatim', () => {
  const argv = [
    'plugin',
    '--profile',
    'desktop',
    'add',
    'github:Owner/Plugin#v1.2.0',
    '--',
    '--profile',
    '../belongs-to-official-cli',
    '--',
  ]
  const parsed = scanned(argv)

  assert.equal(parsed.command, 'plugin')
  assert.equal(parsed.profile, 'desktop')
  assert.equal(parsed.target, 'github:Owner/Plugin#v1.2.0')
  assert.deepEqual(parsed.attribution, {
    kind: 'plugin',
    pluginId: 'owner/plugin',
    requestedRef: 'v1.2.0',
    knownPackageNames: [],
  })
})

test('never injects a default profile into the forwarded arguments', () => {
  const parsed = scanned(['plugin', 'add', 'github:owner/plugin'])
  assert.equal(parsed.profile, null)
  // Without an explicit profile the official CLI fails; reporting a default
  // would file a phantom failure against a profile nobody named.
  assert.equal(parsed.attribution, null)
})

test('counts every verb that writes dependencies', () => {
  for (const verb of ['add', 'i', 'install']) {
    const parsed = scanned(['plugin', '--profile', 'web', verb, 'github:owner/plugin'])
    assert.equal(parsed.attribution?.pluginId, 'owner/plugin', verb)
  }
})

test('never reports a verb that does not install', () => {
  for (const verb of ['remove', 'rm', 'why', 'update', 'up', 'list', 'ls', 'link', 'unlink']) {
    const parsed = scanned(['plugin', '--profile', 'web', verb, 'github:owner/plugin'])
    assert.equal(parsed.attribution, null, verb)
  }
})

test('reads the profile from the official spellings only', () => {
  assert.equal(scanned(['plugin', '--profile', 'web', 'add', 'github:owner/plugin']).profile, 'web')
  assert.equal(scanned(['plugin', '--profile=desktop', 'add', 'github:owner/plugin']).profile, 'desktop')
  // The official CLI has no -p alias, so -p is just another forwarded flag and
  // its value is a second positional target.
  const shorthand = scanned(['plugin', '-p', 'demo', 'add', 'github:owner/plugin'])
  assert.equal(shorthand.profile, null)
  assert.equal(shorthand.attribution, null)
  // Arguments after the official separator belong to a deeper tool.
  assert.equal(scanned(['plugin', 'add', 'github:owner/plugin', '--', '--profile', 'other']).profile, null)
})

test('never reports an install aimed outside the profile dependencies', () => {
  for (const flag of ['-D', '--save-dev', '-O', '--save-optional', '--save-peer', '-g', '--global']) {
    const parsed = scanned(['plugin', '--profile', 'web', 'add', 'github:owner/plugin', flag])
    assert.equal(parsed.attribution, null, flag)
  }
})

test('never reports when the vector names more than one target', () => {
  const parsed = scanned(['plugin', '--profile', 'web', 'add', 'github:owner/plugin', 'github:owner/other'])
  assert.equal(parsed.attribution, null)
})

test('attributes repository targets and the store package itself', () => {
  assert.deepEqual(attributeTarget('github:Owner/Plugin'), {
    kind: 'plugin',
    pluginId: 'owner/plugin',
    requestedRef: null,
    knownPackageNames: [],
  })
  assert.deepEqual(attributeTarget('Owner/Plugin.git#v1.2.0'), {
    kind: 'plugin',
    pluginId: 'owner/plugin',
    requestedRef: 'v1.2.0',
    knownPackageNames: [],
  })
  for (const spec of [SELF_PACKAGE_NAME, `${SELF_PACKAGE_NAME}@1.0.0`, `${SELF_PACKAGE_NAME}@latest`]) {
    assert.deepEqual(attributeTarget(spec), {
      kind: 'plugin',
      pluginId: SELF_PLUGIN_ID,
      requestedRef: null,
      knownPackageNames: [SELF_PACKAGE_NAME],
    }, spec)
  }
})

test('defers published package names to the post-install manifest lookup', () => {
  assert.deepEqual(attributeTarget('@opendsh/dsh-plugin-setting-mcp'), {
    kind: 'npm',
    packageName: '@opendsh/dsh-plugin-setting-mcp',
  })
  assert.deepEqual(attributeTarget('@opendsh/dsh-plugin-setting-mcp@1.2.3'), {
    kind: 'npm',
    packageName: '@opendsh/dsh-plugin-setting-mcp',
  })
  assert.deepEqual(attributeTarget('some-plugin@^2.0.0'), { kind: 'npm', packageName: 'some-plugin' })
  assert.deepEqual(attributeTarget('some-plugin@next'), { kind: 'npm', packageName: 'some-plugin' })
})

test('splits package specs without mangling scopes', () => {
  assert.deepEqual(splitPackageSpec('@scope/name'), { name: '@scope/name', version: null })
  assert.deepEqual(splitPackageSpec('@scope/name@1.2.3'), { name: '@scope/name', version: '1.2.3' })
  assert.deepEqual(splitPackageSpec('name'), { name: 'name', version: null })
})

test('never attributes a target that is not a package or GitHub repository', () => {
  for (const target of [
    'gitlab:owner/plugin',
    'bitbucket:owner/plugin',
    'gist:0123456789abcdef',
    'jsr:@scope/name',
    'workspace:*',
    'catalog:default',
    'alias@npm:real-package',
    'git://github.com/owner/plugin.git',
    'git+ssh://git@github.com/owner/plugin.git',
    'ssh://git@github.com/owner/plugin.git',
    'git@github.com:owner/plugin.git',
    'owner/plugin#bad ref',
    'UPPER-CASE-PACKAGE',
  ]) {
    assert.equal(attributeTarget(target), null, target)
  }
})

test('never attributes a location, so no path can reach an event', () => {
  const locations = [
    './plugin', '../plugin', './a/b/c', '../../a/b', '.', '..',
    '/absolute/path/plugin', '/opt/example/work/plugin', '/tmp/x',
    '~', '~/plugins/mine', '~/.config/secret',
    'C:\\Users\\someone\\plugin', 'D:/work/plugin', '\\\\server\\share\\plugin',
    'file:./plugin', 'file:../plugin', 'file:/absolute/plugin', 'file:///absolute/plugin',
    'link:./plugin', 'link:../plugin', 'portal:./plugin', 'portal:../plugin',
    'http://example.com/plugin.tgz', 'https://example.com/plugin.tgz',
    'https://github.com/owner/plugin', 'https://github.com/owner/plugin.git',
    'https://registry.npmjs.org/x/-/x-1.0.0.tgz',
    'git+https://github.com/owner/plugin.git', 'git+file:../plugin',
    'git://example.com/plugin.git', 'ssh://user@example.com/plugin.git',
    './node_modules/x', '.\\plugin', '~user/plugin',
    '/', '//', '\\', 'file:', 'link:', 'portal:',
  ]
  for (const target of locations) {
    assert.equal(attributeTarget(target), null, target)
  }
  assert.ok(locations.length >= 40, `expected a broad corpus, saw ${locations.length}`)
})

test('reads a plugin id out of every repository field spelling', () => {
  for (const repository of [
    'github:Owner/Plugin',
    'https://github.com/Owner/Plugin',
    'https://github.com/Owner/Plugin.git',
    'https://github.com/Owner/Plugin/',
    'git+https://github.com/Owner/Plugin.git',
    'git://github.com/Owner/Plugin.git',
    'ssh://git@github.com/Owner/Plugin.git',
    'git@github.com:Owner/Plugin.git',
    { type: 'git', url: 'git+https://github.com/Owner/Plugin.git' },
    'https://www.github.com/Owner/Plugin',
  ]) {
    assert.equal(pluginIdFromRepositoryField(repository), 'owner/plugin', JSON.stringify(repository))
  }
})

test('refuses repository fields that are not GitHub repositories', () => {
  for (const repository of [
    'https://gitlab.com/owner/plugin.git',
    'git@gitlab.com:owner/plugin.git',
    'https://github.example.com/owner/plugin.git',
    'https://github.com/owner',
    'not a url',
    '',
    { type: 'git' },
    { url: 123 },
    null,
    undefined,
    42,
  ]) {
    assert.equal(pluginIdFromRepositoryField(repository), null, JSON.stringify(repository))
  }
})

test('rejects commands the wrapper does not own', () => {
  assert.throws(() => parseArgs(['add', 'owner/plugin']), UsageError)
  assert.throws(() => parseArgs(['store']), UsageError)
  assert.throws(() => parseArgs(['install', 'owner/plugin']), UsageError)
})

test('parses telemetry controls', () => {
  assert.deepEqual(parseArgs(['telemetry']), { command: 'telemetry', action: 'status' })
  assert.deepEqual(parseArgs(['telemetry', 'disable']), { command: 'telemetry', action: 'disable' })
  assert.throws(() => parseArgs(['telemetry', 'upload-everything']), UsageError)
})

test('scanPluginArgs never rewrites what it inspects', () => {
  const argv = ['plugin', '--profile', 'web', 'add', 'github:owner/plugin']
  const copy = [...argv]
  scanPluginArgs(copy)
  assert.deepEqual(copy, argv)
})

test('an option value is never mistaken for a second target', () => {
  // Separated flag values are ordinary usage — our own docs show this form —
  // so they must not cost the install its count.
  const after = scanned(['plugin', '--profile', 'web', 'add', 'github:owner/plugin', '--reporter', 'append-only'])
  assert.equal(after.target, 'github:owner/plugin')
  assert.equal(after.attribution?.pluginId, 'owner/plugin')

  // The value may also come before the target.
  const before = scanned(['plugin', '--profile', 'web', 'add', '--reporter', 'append-only', 'github:owner/plugin'])
  assert.equal(before.target, 'github:owner/plugin')
  assert.equal(before.attribution?.pluginId, 'owner/plugin')

  // The `=` spelling was never affected and stays that way.
  const equals = scanned(['plugin', '--profile', 'web', 'add', 'github:owner/plugin', '--reporter=append-only'])
  assert.equal(equals.attribution?.pluginId, 'owner/plugin')

  // Every whitelisted option behaves the same.
  for (const option of [
    '--registry', '--store-dir', '--virtual-store-dir', '--modules-dir',
    '--filter', '--filter-prod', '--dir', '-C',
    '--workspace-concurrency', '--network-concurrency',
    '--fetch-retries', '--fetch-retry-factor', '--fetch-retry-mintimeout',
    '--fetch-retry-maxtimeout', '--fetch-timeout', '--child-concurrency',
    '--package-import-method', '--resolution-mode', '--save-prefix',
    '--use-node-version', '--node-linker',
  ]) {
    const parsed = scanned(['plugin', '--profile', 'web', 'add', 'github:owner/plugin', option, 'some-value'])
    assert.equal(parsed.attribution?.pluginId, 'owner/plugin', option)
  }
})

test('an unknown flag with a separate value still falls back to not counting', () => {
  // The whitelist only covers options confirmed to take a value; anything else
  // keeps the conservative behaviour rather than risking a wrong attribution.
  const parsed = scanned(['plugin', '--profile', 'web', 'add', 'github:owner/plugin', '--unknown-flag', 'some-value'])
  assert.equal(parsed.attribution, null)

  // A boolean option's neighbour is a real target, and two targets stay uncounted.
  const boolean = scanned(['plugin', '--profile', 'web', 'add', '--strict-peer-dependencies', 'a/b', 'c/d'])
  assert.equal(boolean.attribution, null)
})

test('genuinely multiple targets are still never counted', () => {
  assert.equal(scanned(['plugin', '--profile', 'web', 'add', 'a/b', 'c/d']).attribution, null)
  assert.equal(
    scanned(['plugin', '--profile', 'web', 'add', 'a/b', '--reporter', 'append-only', 'c/d']).attribution,
    null,
  )
})

test('a monorepo subdirectory becomes part of the plugin id', () => {
  const expected = {
    kind: 'plugin',
    pluginId: 'owner/monorepo/packages/foo',
    requestedRef: null,
    knownPackageNames: [],
  }
  // Both spellings the official CLI accepts fold into the same identity.
  assert.deepEqual(attributeTarget('github:Owner/Monorepo#path:packages/foo'), expected)
  assert.deepEqual(attributeTarget('Owner/Monorepo/packages/foo'), expected)
  assert.deepEqual(attributeTarget('github:Owner/Monorepo/packages/foo'), expected)
  // A ref and a path can travel together.
  assert.deepEqual(attributeTarget('github:Owner/Monorepo#v1.2.0&path:packages/foo'), {
    ...expected,
    requestedRef: 'v1.2.0',
  })
  // Declaring it twice is fine when both agree, ambiguous when they disagree.
  assert.deepEqual(attributeTarget('github:Owner/Monorepo/packages/foo#path:packages/foo'), expected)
  assert.equal(attributeTarget('github:Owner/Monorepo/packages/a#path:packages/b'), null)
})

test('a subdirectory can never escape the repository', () => {
  for (const target of [
    'github:owner/repo#path:../etc',
    'github:owner/repo#path:./secret',
    'github:owner/repo#path:a/../..',
    'owner/repo/../..',
    'owner/repo/.',
  ]) {
    assert.equal(attributeTarget(target), null, target)
  }
  // Order inside the fragment does not matter: whichever part is not `path:`
  // is the git ref, exactly as the official spec reads it.
  assert.deepEqual(attributeTarget('github:owner/repo#path:packages/foo&v1'), {
    kind: 'plugin',
    pluginId: 'owner/repo/packages/foo',
    requestedRef: 'v1',
    knownPackageNames: [],
  })
  // Two refs, however, are ambiguous.
  assert.equal(attributeTarget('github:owner/repo#v1&v2'), null)
})

test('a package manifest directory joins the plugin id', () => {
  assert.equal(
    pluginIdFromRepositoryField({ type: 'git', url: 'https://github.com/Owner/Mono.git', directory: 'packages/foo' }),
    'owner/mono/packages/foo',
  )
  assert.equal(
    pluginIdFromRepositoryField({ url: 'git+ssh://git@github.com/Owner/Mono.git', directory: '/packages/foo/' }),
    'owner/mono/packages/foo',
  )
  // A repository-root package keeps the two-segment id.
  assert.equal(pluginIdFromRepositoryField({ url: 'https://github.com/Owner/Mono.git' }), 'owner/mono')
  // A traversal in the manifest is refused outright rather than sanitised.
  for (const directory of ['../evil', 'packages/../..', './x', '..']) {
    assert.equal(
      pluginIdFromRepositoryField({ url: 'https://github.com/Owner/Mono.git', directory }),
      null,
      directory,
    )
  }
})
