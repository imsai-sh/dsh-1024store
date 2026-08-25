import { describe, expect, it } from 'vitest'
import {
  classifyNpmBinding,
  deriveInstallMethods,
  gitVerification,
  NO_ENTRY_DECLARED_VERIFICATION,
  offeredInstallCommand,
  withLegacyNpmCodeAliases,
  type GitInstallCode,
} from '../worker/lib/install-methods'

const GITHUB_ONLY = { packageName: null, binding: 'absent', bundleDeclared: false } as const

describe('install method verdicts', () => {
  it('maps every git outcome to a verification state', () => {
    const expected: Record<GitInstallCode, string> = {
      entry_committed: 'verified',
      prepare_builds_entry: 'verified',
      no_entry_declared: NO_ENTRY_DECLARED_VERIFICATION,
      entry_missing_no_prepare: 'unverified',
      entry_outside_repository: 'unverified',
      manifest_missing: 'unverified',
      entry_unresolved: 'unknown',
      tree_truncated: 'unknown',
      repository_unreachable: 'unknown',
      not_checked: 'unknown',
    }
    for (const [code, verification] of Object.entries(expected)) {
      expect(gitVerification(code as GitInstallCode), code).toBe(verification)
    }
  })

  it('separates the build allowance from the verdict', () => {
    // A committed entry is verified whether or not a prepare script exists, but
    // the allowance flag follows the prepare script alone. The command supplies
    // pnpm's build grant so the first add can run it successfully.
    const [committed] = deriveInstallMethods(
      'owner/repo',
      { code: 'entry_committed', hasPrepare: true, packageName: '@scope/plugin' },
      null,
    )
    expect(committed).toMatchObject({
      verification: 'verified',
      requiresBuildAllowance: true,
      command: 'dsh plugin --profile web add --allow-build=@scope/plugin github:owner/repo',
    })

    const [plain] = deriveInstallMethods('owner/repo', { code: 'entry_committed', hasPrepare: false }, null)
    expect(plain).toMatchObject({ verification: 'verified', requiresBuildAllowance: false })
  })

  it('emits a github method carrying the official command', () => {
    const [method] = deriveInstallMethods(
      'owner/repo/packages/foo',
      { code: 'entry_missing_no_prepare', hasPrepare: false },
      null,
    )
    expect(method).toMatchObject({
      kind: 'github',
      spec: 'github:owner/repo#path:packages/foo',
      command: 'dsh plugin --profile web add github:owner/repo#path:packages/foo',
      verification: 'unverified',
      code: 'entry_missing_no_prepare',
    })
  })

  it('recommends every published DSH npm package before the GitHub source', () => {
    const git = { code: 'entry_missing_no_prepare', hasPrepare: false } as const

    // repository metadata is informational only. Registry presence plus a DSH
    // bundle is enough whether the backlink matches, is missing, or disagrees.
    for (const binding of ['strict', 'name_only', 'mismatch'] as const) {
      const methods = deriveInstallMethods('owner/repo', git, {
        packageName: '@scope/plugin', binding, bundleDeclared: true, version: '1.2.3',
      })
      expect(methods.map((method) => method.kind), binding).toEqual(['npm', 'github'])
      expect(methods[0]).toMatchObject({
        kind: 'npm',
        spec: '@scope/plugin',
        command: 'dsh plugin --profile web add @scope/plugin',
        verification: 'verified',
        code: 'published_package',
        requiresBuildAllowance: false,
        revision: '1.2.3',
      })
    }

    // A registry miss or a package without a DSH bundle is not an npm install
    // method, regardless of its repository metadata.
    for (const binding of ['no_bundle', 'absent', 'unknown'] as const) {
      const methods = deriveInstallMethods('owner/repo', git, {
        packageName: 'plugin', binding, bundleDeclared: false,
      })
      expect(methods.map((method) => method.kind), binding).toEqual(['github'])
    }
    expect(deriveInstallMethods('owner/repo', git, GITHUB_ONLY).map((m) => m.kind)).toEqual(['github'])
  })

  it('offers only the npm method to user-facing surfaces', () => {
    // The github method stays derived and recorded, but nothing offers it:
    // its --allow-build grant quoted a repository-controlled name and one bad
    // value poisoned the whole registry (issue #159).
    const git = { code: 'entry_committed', hasPrepare: true, packageName: '@scope/plugin' } as const
    const published = deriveInstallMethods('owner/repo', git, {
      packageName: '@scope/plugin', binding: 'strict', bundleDeclared: true, version: '1.2.3',
    })
    expect(offeredInstallCommand({ install: published[0]!.command, installMethods: published }))
      .toBe('dsh plugin --profile web add @scope/plugin')

    const sourceOnly = deriveInstallMethods('owner/repo', git, null)
    expect(offeredInstallCommand({ install: sourceOnly[0]!.command, installMethods: sourceOnly }))
      .toBeNull()

    // Pre-verification snapshots carry only the command string.
    expect(offeredInstallCommand({ install: 'dsh plugin --profile web add github:owner/repo' })).toBeNull()
    expect(offeredInstallCommand({ install: 'dsh plugin --profile web add @scope/plugin' }))
      .toBe('dsh plugin --profile web add @scope/plugin')
  })

  it('makes the store package command cross pre-1.0 minor version ranges', () => {
    const methods = deriveInstallMethods(
      'imsai-sh/awesome-deepseek-harness-plugins/packages/dsh1024',
      { code: 'entry_committed', hasPrepare: false },
      {
        packageName: 'dsh1024',
        binding: 'strict',
        bundleDeclared: true,
        version: '0.4.1',
      },
    )

    expect(methods[0]).toMatchObject({
      kind: 'npm',
      spec: 'dsh1024',
      command: 'dsh plugin --profile web add dsh1024@latest',
    })
  })

  it('projects both npm verdict codes for old v1 consumers without duplicating targets', () => {
    const methods = deriveInstallMethods(
      'owner/repo',
      { code: 'entry_committed', hasPrepare: false },
      { packageName: '@scope/plugin', binding: 'strict', bundleDeclared: true, version: '1.2.3' },
    )

    const projected = withLegacyNpmCodeAliases(methods)!
    expect(projected.slice(0, 2).map((method) => method.code)).toEqual([
      'published_package',
      'repository_backlink',
    ])
    expect(projected[1]).toMatchObject({
      kind: 'npm',
      spec: '@scope/plugin',
      revision: '1.2.3',
      verification: 'verified',
      requiresBuildAllowance: false,
    })
    expect(withLegacyNpmCodeAliases(projected)).toEqual(projected)
    expect(methods.map((method) => method.code)).toEqual(['published_package', 'entry_committed'])
  })

  it('regresses the scoped monorepo package that production previously hid', () => {
    const id = 'zhu1090093659/dsh-web-ui/packages/dsh-community-plugins'
    const published = {
      repository: { url: 'https://github.com/zhu1090093659/dsh-web-ui.git' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }
    const npmFacts = classifyNpmBinding(id, published)

    // The package does not publish repository.directory, so the diagnostic
    // backlink remains a mismatch. That must not hide a real DSH npm bundle.
    expect(npmFacts).toEqual({ binding: 'mismatch', bundleDeclared: true })
    const methods = deriveInstallMethods(
      id,
      {
        code: 'prepare_builds_entry',
        hasPrepare: true,
        packageName: '@linxin666/dsh-client-ui-community-plugins',
      },
      {
        packageName: '@linxin666/dsh-client-ui-community-plugins',
        ...npmFacts,
        version: '0.2.3',
      },
    )

    expect(methods).toMatchObject([
      {
        kind: 'npm',
        spec: '@linxin666/dsh-client-ui-community-plugins',
        command: 'dsh plugin --profile web add @linxin666/dsh-client-ui-community-plugins',
        verification: 'verified',
      },
      {
        kind: 'github',
        spec: 'github:zhu1090093659/dsh-web-ui#path:packages/dsh-community-plugins',
        command: 'dsh plugin --profile web add --allow-build=@linxin666/dsh-client-ui-community-plugins github:zhu1090093659/dsh-web-ui#path:packages/dsh-community-plugins',
      },
    ])
  })
})

describe('npm binding classification', () => {
  const bundle = { bundle: { patch: './cordis.patch.yml' } }

  it('binds a repository-level package by its repository url', () => {
    expect(classifyNpmBinding('Owner/Repo', {
      repository: { url: 'git+https://github.com/Owner/Repo.git' }, dsh: bundle,
    })).toEqual({ binding: 'strict', bundleDeclared: true })

    // Every url form npm accepts normalizes to the same owner/repo.
    for (const url of [
      'https://github.com/Owner/Repo',
      'git://github.com/Owner/Repo.git',
      'git+ssh://git@github.com/Owner/Repo.git',
      'github.com/owner/repo',
    ]) {
      expect(classifyNpmBinding('Owner/Repo', { repository: url, dsh: bundle }).binding, url).toBe('strict')
    }
  })

  it('requires the directory to match exactly for a subpackage', () => {
    const id = 'Owner/Repo/packages/foo'
    expect(classifyNpmBinding(id, {
      repository: { url: 'https://github.com/Owner/Repo', directory: 'packages/foo' }, dsh: bundle,
    }).binding).toBe('strict')
    // Tolerate cosmetic prefixes/suffixes but not a different directory: git
    // paths are case-sensitive, and a sibling is a different plugin.
    expect(classifyNpmBinding(id, {
      repository: { url: 'https://github.com/Owner/Repo', directory: './packages/foo/' }, dsh: bundle,
    }).binding).toBe('strict')
    for (const directory of ['packages/bar', 'packages/Foo', '', undefined]) {
      expect(classifyNpmBinding(id, {
        repository: { url: 'https://github.com/Owner/Repo', directory }, dsh: bundle,
      }).binding, String(directory)).toBe('mismatch')
    }
  })

  it('reports weaker bindings honestly', () => {
    expect(classifyNpmBinding('Owner/Repo', { dsh: bundle }).binding).toBe('name_only')
    expect(classifyNpmBinding('Owner/Repo', {
      repository: { url: 'https://github.com/Attacker/Other' }, dsh: bundle,
    }).binding).toBe('mismatch')
    expect(classifyNpmBinding('Owner/Repo', {
      repository: { url: 'https://github.com/Owner/Repo' },
    })).toEqual({ binding: 'no_bundle', bundleDeclared: false })
    expect(classifyNpmBinding('Owner/Repo', null)).toEqual({ binding: 'absent', bundleDeclared: false })
  })
})
