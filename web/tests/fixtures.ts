import { repositoryName } from '../worker/lib/catalog'
import type {
  CatalogPlugin,
  CatalogSnapshotResult,
  RegistryCategory,
  RegistryPlugin,
} from '../worker/types'

export interface TestRegistry {
  updated: string
  count: number
  revision: string
  categories: Record<string, RegistryCategory>
  plugins: RegistryPlugin[]
}

// Mirrors the real catalog: some plugins publish an npm package (the only
// offered install method), others are source-only and therefore browse-only
// on every user-facing surface and absent from the v1 partner listing.
function npmMethods(id: string, packageName: string): RegistryPlugin['installMethods'] {
  return [
    {
      kind: 'npm',
      spec: packageName,
      command: `dsh plugin --profile web add ${packageName}`,
      verification: 'verified',
      code: 'published_package',
      requiresBuildAllowance: false,
      buildPackage: null,
      revision: '1.0.0',
      checkedAt: '2026-08-14T00:00:00Z',
    },
    {
      kind: 'github',
      spec: `github:${id}`,
      command: `dsh plugin --profile web add github:${id}`,
      verification: 'verified',
      code: 'entry_committed',
      requiresBuildAllowance: false,
      buildPackage: null,
      revision: null,
      checkedAt: '2026-08-14T00:00:00Z',
    },
  ]
}

const TEST_REGISTRY_PLUGINS: RegistryPlugin[] = [
  {
    id: 'openma-ai/deepseek-harness-tui',
    name: 'deepseek-harness-tui',
    owner: 'openma-ai',
    url: 'https://github.com/openma-ai/deepseek-harness-tui',
    category: 'ui',
    description: {
      en: 'A Rust/ratatui terminal client that speaks the DSH SDK JSON-RPC protocol directly and runs standalone or as a profile bundle.',
      zh: 'Rust/ratatui 终端客户端，直接使用 DSH SDK JSON-RPC 协议，支持独立运行或作为 profile bundle 加载。',
    },
    install: 'dsh plugin --profile web add @openma/deepseek-harness-tui',
    installMethods: npmMethods('openma-ai/deepseek-harness-tui', '@openma/deepseek-harness-tui'),
    added: '2026-08-14',
  },
  {
    id: 'Jesse-njx/dsh-crosstalk',
    name: 'dsh-crosstalk',
    owner: 'Jesse-njx',
    url: 'https://github.com/Jesse-njx/dsh-crosstalk',
    category: 'session',
    description: {
      en: 'Cross-session messaging for DSH: any session on the machine can list and message any other, Claude Code-style, via a local heartbeat registry and inbox.',
      zh: '跨会话消息：本机任意会话都可像 Claude Code 一样列出并互发消息，基于本地心跳注册表与收件箱。',
    },
    install: 'dsh plugin --profile web add dsh-crosstalk',
    installMethods: npmMethods('Jesse-njx/dsh-crosstalk', 'dsh-crosstalk'),
    added: '2026-08-14',
  },
  {
    id: 'MAXeaglet/dsh-bash-terminal',
    name: 'dsh-bash-terminal',
    owner: 'MAXeaglet',
    url: 'https://github.com/MAXeaglet/dsh-bash-terminal',
    category: 'tools',
    description: {
      en: 'One shell tool for PowerShell / Git Bash / WSL on Windows plus an interactive PTY terminal; the default terminal is chosen by the user in DSH settings.',
      zh: '一个 shell 工具：Windows 上统一执行 PowerShell / Git Bash / WSL，外加交互式 PTY 终端，默认终端由用户在设置中选择。',
    },
    install: 'dsh plugin --profile web add github:MAXeaglet/dsh-bash-terminal',
    added: '2026-08-14',
  },
  {
    id: 'NanmiCoder/dsh-agent-teams',
    name: 'dsh-agent-teams',
    owner: 'NanmiCoder',
    url: 'https://github.com/NanmiCoder/dsh-agent-teams',
    category: 'workflow',
    description: {
      en: 'AgentTeams multi-agent teams.',
      zh: 'AgentTeams 多智能体团队。',
    },
    install: 'dsh plugin --profile web add github:NanmiCoder/dsh-agent-teams',
    added: '2026-08-13',
  },
  {
    id: 'omdsh-dev/dsh-notification',
    name: 'dsh-notification',
    owner: 'omdsh-dev',
    url: 'https://github.com/omdsh-dev/dsh-notification',
    category: 'notify',
    description: {
      en: 'Desktop notifications for turn completions, with per-outcome controls and keyword rules.',
      zh: '回合完成桌面通知，按结果分控 + 关键词过滤。',
    },
    install: 'dsh plugin --profile web add github:omdsh-dev/dsh-notification',
    added: '2026-08-13',
  },
  {
    id: 'omdsh-dev/fabric',
    name: 'fabric',
    owner: 'omdsh-dev',
    url: 'https://github.com/omdsh-dev/fabric',
    category: 'dev',
    description: {
      en: 'An MC-Fabric-style hook processor.',
      zh: '类似 MC Fabric 的 hook 处理器。',
    },
    install: 'dsh plugin --profile web add github:omdsh-dev/fabric',
    added: '2026-08-13',
  },
  {
    id: 'omdsh-dev/dsh-gomoku',
    name: 'dsh-gomoku',
    owner: 'omdsh-dev',
    url: 'https://github.com/omdsh-dev/dsh-gomoku',
    category: 'fun',
    description: {
      en: 'Play Gomoku against the AI, or let two AIs battle it out.',
      zh: '与 AI 下五子棋，也可让 AI 对局比棋力。',
    },
    install: 'dsh plugin --profile web add dsh-gomoku',
    installMethods: npmMethods('omdsh-dev/dsh-gomoku', 'dsh-gomoku'),
    added: '2026-08-13',
  },
  // A monorepo subpackage: its url is the repository root, its id carries the
  // in-repo path, and its install spec gains `#path:`.
  {
    id: 'omdsh-dev/dsh-suite/packages/dsh-inspector',
    name: 'dsh-inspector',
    owner: 'omdsh-dev',
    url: 'https://github.com/omdsh-dev/dsh-suite',
    category: 'tools',
    description: {
      en: 'Inspector panel shipped as one package of a plugin monorepo.',
      zh: '以 monorepo 子包形式发布的检查器面板。',
    },
    install: 'dsh plugin --profile web add github:omdsh-dev/dsh-suite#path:packages/dsh-inspector',
    added: '2026-08-16',
  },
  // Its sibling in the same repository: shares repository facts, keeps its own
  // identity, install spec, and install metrics.
  {
    id: 'omdsh-dev/dsh-suite/packages/dsh-timeline',
    name: 'dsh-timeline',
    owner: 'omdsh-dev',
    url: 'https://github.com/omdsh-dev/dsh-suite',
    category: 'tools',
    description: {
      en: 'Timeline panel shipped as one package of a plugin monorepo.',
      zh: '以 monorepo 子包形式发布的时间线面板。',
    },
    install: 'dsh plugin --profile web add github:omdsh-dev/dsh-suite#path:packages/dsh-timeline',
    added: '2026-08-16',
  },
]

export const TEST_REGISTRY: TestRegistry = {
  updated: '2026-08-14',
  count: TEST_REGISTRY_PLUGINS.length,
  revision: `sha256:${'a'.repeat(64)}`,
  categories: {
    ui: { en: 'UI Enhancements', zh: 'UI 增强' },
    session: { en: 'Sessions & Messages', zh: '会话与消息' },
    tools: { en: 'Tools & Capabilities', zh: '工具与能力' },
    workflow: { en: 'Workflow & Automation', zh: '工作流与自动化' },
    notify: { en: 'Notifications & Integrations', zh: '通知与集成' },
    dev: { en: 'Development & Runtime', zh: '开发与运行时' },
    fun: { en: 'Just for Fun', zh: '娱乐' },
  },
  plugins: TEST_REGISTRY_PLUGINS,
}

/** Ordered category definitions matching TEST_REGISTRY.categories, as loaded from D1 (migration 0014 orders). */
export const TEST_CATEGORY_LIST = [
  { id: 'ui', order: 10, label: { en: 'UI Enhancements', zh: 'UI 增强' } },
  { id: 'session', order: 30, label: { en: 'Sessions & Messages', zh: '会话与消息' } },
  { id: 'tools', order: 50, label: { en: 'Tools & Capabilities', zh: '工具与能力' } },
  { id: 'workflow', order: 70, label: { en: 'Workflow & Automation', zh: '工作流与自动化' } },
  { id: 'notify', order: 80, label: { en: 'Notifications & Integrations', zh: '通知与集成' } },
  { id: 'dev', order: 100, label: { en: 'Development & Runtime', zh: '开发与运行时' } },
  { id: 'fun', order: 110, label: { en: 'Just for Fun', zh: '娱乐' } },
]

// The last two entries are monorepo siblings of one repository: they share the
// repository-level star count and keep their own install metrics.
const STAR_COUNTS = [42, 120, null, 18, 7, 3, 1, 9, 9]
const STAR_GROWTH = [
  { growth24h: 3, growth7d: 12, growth30d: 30 },
  { growth24h: 2, growth7d: 8, growth30d: 45 },
  { growth24h: null, growth7d: null, growth30d: null },
  { growth24h: 8, growth7d: 20, growth30d: 25 },
  { growth24h: 0, growth7d: 1, growth30d: 4 },
  { growth24h: -1, growth7d: 0, growth30d: 1 },
  { growth24h: 1, growth7d: 2, growth30d: 2 },
  { growth24h: 2, growth7d: 5, growth30d: 10 },
  { growth24h: 2, growth7d: 5, growth30d: 10 },
]

const INSTALL_COUNTS = [42, 80, 0, 45, 7, 3, 1, 5, 4]
const INSTALLS_24H = [3, 2, 0, 8, 0, 0, 1, 0, 0]
const INSTALLS_7D = [12, 8, 0, 20, 1, 0, 2, 1, 1]
const INSTALLS_30D = [30, 45, 0, 25, 4, 1, 2, 2, 2]

export const TEST_PLUGINS: CatalogPlugin[] = TEST_REGISTRY.plugins.map((plugin, index) => ({
  ...plugin,
  ...STAR_GROWTH[index],
  installCount: INSTALL_COUNTS[index] ?? 0,
  installerCount: Math.floor((INSTALL_COUNTS[index] ?? 0) * 0.75),
  firstInstallCount: Math.floor((INSTALL_COUNTS[index] ?? 0) * 0.75),
  reinstallCount: (INSTALL_COUNTS[index] ?? 0) - Math.floor((INSTALL_COUNTS[index] ?? 0) * 0.75),
  updateCount: index,
  removeCount: Math.floor(index / 2),
  failureCount: index === 2 ? 1 : 0,
  installs24h: INSTALLS_24H[index] ?? 0,
  installs7d: INSTALLS_7D[index] ?? 0,
  installs30d: INSTALLS_30D[index] ?? 0,
  latestInstallAt: (INSTALL_COUNTS[index] ?? 0) > 0
    ? `2026-08-${String(14 - index).padStart(2, '0')}T13:00:00Z`
    : null,
  repository: repositoryName(plugin),
  stars: STAR_COUNTS[index] ?? null,
  forks: STAR_COUNTS[index] === null ? null : index + 1,
  pushedAt: index === 2 ? null : `2026-08-${String(14 - index).padStart(2, '0')}T12:00:00Z`,
  updatedAt: index === 2 ? null : `2026-08-${String(14 - index).padStart(2, '0')}T12:00:00Z`,
  latestReleaseAt: index === 3
    ? '2026-08-16T09:00:00Z'
    : index === 0
      ? '2026-08-15T09:00:00Z'
      : null,
}))

export function testCatalogResult(
  source: CatalogSnapshotResult['source'] = 'kv',
): CatalogSnapshotResult {
  return {
    source,
    snapshot: {
      generatedAt: '2026-08-14T12:00:00Z',
      registryUpdated: TEST_REGISTRY.updated,
      registryRevision: TEST_REGISTRY.revision,
      metricCoverage: TEST_PLUGINS.filter((plugin) => plugin.stars !== null).length,
      categories: TEST_REGISTRY.categories,
      categoryList: TEST_CATEGORY_LIST,
      plugins: TEST_PLUGINS,
    },
  }
}
