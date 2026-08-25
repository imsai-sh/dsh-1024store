import {
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  Code2,
  Download,
  ExternalLink,
  GitFork,
  Package,
  RefreshCw,
  ShieldAlert,
  Star,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import { CategoryTag } from '../components/CategoryTag'
import { InstallMethods } from '../components/InstallMethods'
import { InstallOptions } from '../components/InstallOptions'
import { InstallUnavailable } from '../components/InstallUnavailable'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { OwnerAvatar } from '../components/OwnerAvatar'
import { pluginDetailPath, pluginSourceUrl } from '../../worker/lib/plugin-id'
import {
  ApiError,
  getPackage,
  getPackageSummary,
  installOffered,
  npmPackageUrl,
  repositoryName,
  type PackageDetail,
  type PackageSummaryDetail,
} from '../lib/api'
import { publicAsset } from '../lib/assets'
import { formatDate, formatDateTime, formatNumber } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { readmeImage, readmeLink } from '../lib/readme'
import {
  graph,
  pluginDescription,
  pluginNodes,
  pluginTitle,
  siteNodes,
} from '../../worker/seo-templates'
import { SITE_ORIGIN, usePageSeo } from '../lib/usePageSeo'

function returnPathFromState(state: unknown): string | null {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return null
  const candidate = (state as { dsh1024ReturnTo?: unknown }).dsh1024ReturnTo
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//')) return null
  return candidate
}

export function PackagePage() {
  // Splat route: the id is owner plus every remaining segment, which is how a
  // monorepo subpackage (owner/repo/packages/foo) addresses its detail page.
  const { owner = '', '*': rest = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const returnPath = returnPathFromState(location.state)
  // React Router stamps the first entry of a tab's history with key 'default',
  // which is exactly "nothing on this site preceded this page".
  const cameFromSite = returnPath !== null || location.key !== 'default'
  const requestedId = [owner, ...rest.split('/')].filter(Boolean).join('/')
  const { language, t } = useI18n()
  const [summary, setSummary] = useState<PackageSummaryDetail | null>(null)
  const [detail, setDetail] = useState<PackageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [githubError, setGithubError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [reload, setReload] = useState(0)
  const [githubReload, setGithubReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setSummary(null)
    setDetail(null)
    setError(null)
    setGithubError(null)
    setMissing(false)
    getPackageSummary(requestedId, controller.signal)
      .then(setSummary)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        // Only a 404 proves the plugin is gone. Anything else is a failure of
        // this request, and must not be allowed to noindex a live page.
        if (requestError instanceof ApiError && requestError.status === 404) setMissing(true)
        setError(requestError instanceof Error ? requestError.message : t('notFoundBody'))
      })
    return () => controller.abort()
  }, [requestedId, reload, t])

  // GitHub is an enhancement, never a prerequisite for the useful page. This
  // effect cannot start until the first-party summary has painted once.
  useEffect(() => {
    if (!summary) return
    const controller = new AbortController()
    setDetail(null)
    setGithubError(null)
    getPackage(summary.id, controller.signal)
      .then(setDetail)
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return
        setGithubError(requestError instanceof Error ? requestError.message : t('githubDetailsUnavailable'))
      })
    return () => controller.abort()
  }, [summary, githubReload, t])

  const canonicalPath = pluginDetailPath(summary?.id ?? requestedId)
  // The splat route carries one id, so the pieces upstream took from separate
  // route params come from it: the owner is the first segment and the display
  // name the last (the subpackage directory for a monorepo plugin).
  const requestedSegments = requestedId.split('/')
  const name = summary ? repositoryName(summary) : (requestedSegments.at(-1) ?? '')
  const canonicalRepository = name
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`
  const categoryLabel = summary?.category?.label[language] ?? ''
  const seoTitle = summary
    ? pluginTitle(summary.name, summary.owner, language)
    : missing
      ? language === 'zh' ? '插件未找到 | DSH 1024Store' : 'Plugin not found | DSH 1024Store'
      : pluginTitle(name || 'DeepSeek Harness', owner || 'DSH 1024Store', language)
  const seoDescription = summary
    ? pluginDescription(summary.name, summary.owner, summary.description[language], categoryLabel, language)
    : missing
      ? language === 'zh'
        ? '该插件不在 DeepSeek Harness 社区插件目录中。'
        : 'This plugin is not in the DeepSeek Harness community plugin catalog.'
      : language === 'zh'
        ? '浏览 DeepSeek Harness 社区插件的功能、安装命令与仓库信息。'
        : 'Explore features, install commands, and repository details for a DeepSeek Harness community plugin.'
  const schema = summary
    ? graph([
        ...siteNodes(),
        ...pluginNodes(
          {
            name: summary.name,
            owner: summary.owner,
            url: summary.url,
            description: summary.description[language],
            categoryLabel,
            added: summary.added,
            stars: detail?.github?.stars ?? summary.stars,
            pushedAt: detail?.github?.pushedAt ?? summary.pushedAt,
            updatedAt: detail?.github?.updatedAt ?? summary.updatedAt,
            license: detail?.manifest?.license ?? detail?.github?.license ?? null,
            repository: canonicalRepository,
            sourceUrl: pluginSourceUrl(summary.id, summary.url, detail?.github?.defaultBranch ?? 'HEAD'),
          },
          canonicalUrl,
          seoTitle,
          seoDescription,
          language,
          t('catalog'),
        ),
      ])
    : null

  usePageSeo({
    title: seoTitle,
    description: seoDescription,
    path: canonicalPath,
    language,
    // Only a confirmed 404 deindexes. While the fetch is in flight the Worker's
    // own metadata stays untouched, so a crawler never snapshots a placeholder.
    robots: missing ? 'noindex,follow' : 'index,follow',
    canonical: missing ? null : canonicalUrl,
    schema,
    ready: Boolean(summary || missing),
  })

  if (error) {
    return (
      <div className="page-container standalone-state">
        <AlertTriangle size={36} aria-hidden="true" />
        <h1>{t('notFound')}</h1>
        <p>{error}</p>
        <div className="state-actions">
          <Link className="button button-primary" to={returnPath ?? '/plugins'} replace={returnPath !== null}>
            <ArrowLeft size={16} aria-hidden="true" />
            {t('back')}
          </Link>
          <button className="button button-secondary" type="button" onClick={() => setReload((value) => value + 1)}>
            {t('retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="page-container detail-loading" aria-label="Loading">
        <span className="skeleton-line skeleton-line-short" />
        <span className="skeleton-line detail-title-placeholder" />
        <span className="skeleton-line" />
        <div className="detail-panel-placeholder" />
      </div>
    )
  }

  const github = detail?.github ?? null
  const manifest = detail?.manifest ?? null
  const category = summary.category
    ? { id: summary.category.id, en: summary.category.label.en, zh: summary.category.label.zh, count: 0 }
    : undefined
  const runtime = manifest?.engines
    ? Object.entries(manifest.engines)
        .map(([engine, version]) => `${engine} ${version}`)
        .join(', ')
    : null
  // Issues are tracked per repository, so the report link stays at the root
  // even for a subpackage; only the source link points into the subdirectory.
  const reportUrl = `${summary.url}/issues/new?title=${encodeURIComponent(`[DSH 1024Store] ${summary.name}`)}`
  const branch = github?.defaultBranch ?? 'main'
  const sourceUrl = detail ? pluginSourceUrl(summary.id, summary.url, branch) : summary.url
  const detailOwner = summary.owner
  const detailRepository = repositoryName(summary)
  // Relative links resolve against the directory the README actually came
  // from: a subpackage without its own README falls back to the root one, and
  // rebasing that onto the subdirectory would break every link in it.
  const readmeBasePath = detail?.readmeBasePath ?? ''
  const readmeLocation = { owner: detailOwner, repository: detailRepository, branch, basePath: readmeBasePath }
  const npmMethod = summary.installMethods?.find((method) => method.kind === 'npm')
  const installData = detail ?? summary
  const githubLoading = detail === null && githubError === null
  const githubUnavailable = githubError !== null || Boolean(
    detail && detail.github === null && detail.manifest === null && detail.readme === null,
  )
  const githubFactFallback = githubLoading ? t('loading') : t('unavailable')
  const displayedStars = github?.stars ?? summary.stars
  const displayedForks = github?.forks ?? summary.forks
  const displayedPush = github?.pushedAt ?? summary.pushedAt

  return (
    <div className="page-container package-detail-page">
      <div className="detail-utility">
        <Link className="detail-brand" to="/" aria-label="DeepSeek Harness Store homepage">
          <img className="brand-mark" src={publicAsset('deepseek1024-icon.png')} alt="" aria-hidden="true" />
          <span>DeepSeek Harness <strong>{t('market')}</strong></span>
        </Link>
        <LanguageSwitch />
      </div>

      {/* Back means the page the reader came from — the rankings, a search, a
          repository they had expanded — not always the catalog. Rows open in a
          new tab by default, and a detail page can also be entered from a link
          or a search engine; in those tabs there is no in-app history to
          return to, so the control stays a plain link to the catalog. */}
      {cameFromSite ? (
        <button
          type="button"
          className="back-link"
          onClick={() => returnPath === null ? navigate(-1) : navigate(returnPath, { replace: true })}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {t('backToPrevious')}
        </button>
      ) : (
        <Link className="back-link" to="/plugins">
          <ArrowLeft size={16} aria-hidden="true" />
          {t('back')}
        </Link>
      )}

      <section className="detail-header">
        <OwnerAvatar
          owner={summary.owner}
          size={72}
          className="detail-avatar"
          src={github?.avatarUrl}
          eager
          fallbackToGitHub={false}
        />
        <div className="detail-heading">
          <div className="detail-title-row">
            <h1>{summary.name}</h1>
            <CategoryTag category={category} />
          </div>
          <p className="detail-owner">{t('by')} <a href={`https://github.com/${summary.owner}`} target="_blank" rel="noreferrer">{summary.owner}</a></p>
          <p className="detail-description">{summary.description[language]}</p>
        </div>
        <div className="detail-actions">
          <a className="button button-primary" href={sourceUrl} target="_blank" rel="noreferrer">
            <Code2 size={16} aria-hidden="true" />
            {t('source')}
          </a>
          {npmMethod && (
            <a className="button button-secondary" href={npmPackageUrl(npmMethod.spec)} target="_blank" rel="noreferrer">
              <Package size={16} aria-hidden="true" />
              {t('npmPackage')}
            </a>
          )}
          <a className="button button-secondary" href={reportUrl} target="_blank" rel="noreferrer">
            <CircleDot size={16} aria-hidden="true" />
            {t('report')}
          </a>
        </div>
      </section>

      {githubUnavailable && (
        <div className="notice github-detail-notice" role="status" title={githubError ?? undefined}>
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>{t('githubDetailsUnavailable')}</strong>
            <p>{t('githubDetailsUnavailableBody')}</p>
          </div>
          <button className="button button-secondary" type="button" onClick={() => setGithubReload((value) => value + 1)}>
            {t('retryGitHub')}
          </button>
        </div>
      )}

      <dl className="repository-stats">
        <div>
          <dt><Star size={16} aria-hidden="true" /> {t('stars')}</dt>
          <dd>{displayedStars === null ? githubFactFallback : formatNumber(displayedStars, language)}</dd>
        </div>
        <div>
          <dt><GitFork size={16} aria-hidden="true" /> {t('forks')}</dt>
          <dd>{displayedForks === null ? githubFactFallback : formatNumber(displayedForks, language)}</dd>
        </div>
        <div>
          <dt><CircleDot size={16} aria-hidden="true" /> {t('issues')}</dt>
          <dd>{github ? formatNumber(github.openIssues, language) : githubFactFallback}</dd>
        </div>
        <div>
          <dt><CalendarDays size={16} aria-hidden="true" /> {t('lastPush')}</dt>
          <dd>{displayedPush ? formatDate(displayedPush, language) : githubFactFallback}</dd>
        </div>
      </dl>

      <div className="detail-layout">
        <div className="detail-primary">
          <section className="detail-section install-section" aria-labelledby="install-heading">
            <h2 id="install-heading">{t('install')}</h2>
            {/* Verified npm methods when the crawler has reached this plugin;
                the plain two-option form until then. A plugin without a
                published npm package is browse-only — the store no longer
                offers source installs — so it gets the repository link
                instead of a command. */}
            {summary.installMethods
              ? summary.installMethods.some((method) => method.kind === 'npm')
                ? <InstallMethods methods={summary.installMethods} pluginId={summary.id} />
                : <InstallUnavailable repositoryUrl={summary.url} />
              : installOffered(summary)
                ? <InstallOptions plugin={summary} />
                : <InstallUnavailable repositoryUrl={summary.url} />}
          </section>

          <section className="detail-section install-activity-section" aria-labelledby="install-activity-heading">
            <div className="install-activity-heading">
              <div>
                <h2 id="install-activity-heading">{t('installActivity')}</h2>
                <p>{t('anonymousInstallerNote')}</p>
              </div>
              <span className="latest-install-time">
                <Clock3 size={15} aria-hidden="true" />
                <span>
                  <small>{t('latestInstall')}</small>
                  <strong>
                    {installData.latestInstallAt
                      ? formatDateTime(installData.latestInstallAt, language)
                      : t('neverInstalled')}
                  </strong>
                </span>
              </span>
            </div>

            <dl className="install-stat-grid">
              <div className="install-stat-primary">
                <dt><Download size={16} aria-hidden="true" /> {t('installOperations')}</dt>
                <dd>{formatNumber(installData.installCount ?? 0, language)}</dd>
              </div>
              <div className="install-stat-primary">
                <dt><Users size={16} aria-hidden="true" /> {t('anonymousInstallers')}</dt>
                <dd>{formatNumber(installData.installerCount ?? 0, language)}</dd>
              </div>
              <div>
                <dt>{t('installs24h')}</dt>
                <dd>{formatNumber(installData.installs24h ?? 0, language)}</dd>
              </div>
              <div>
                <dt>{t('installs7d')}</dt>
                <dd>{formatNumber(installData.installs7d ?? 0, language)}</dd>
              </div>
              <div>
                <dt>{t('installs30d')}</dt>
                <dd>{formatNumber(installData.installs30d ?? 0, language)}</dd>
              </div>
            </dl>

            <dl className="install-operation-breakdown">
              <div>
                <dt><CheckCircle2 size={14} aria-hidden="true" /> {t('firstInstalls')}</dt>
                <dd>{formatNumber(installData.firstInstallCount ?? 0, language)}</dd>
              </div>
              <div>
                <dt><RefreshCw size={14} aria-hidden="true" /> {t('reinstalls')}</dt>
                <dd>{formatNumber(installData.reinstallCount ?? 0, language)}</dd>
              </div>
              <div>
                <dt><ArrowUp size={14} aria-hidden="true" /> {t('updates')}</dt>
                <dd>{formatNumber(installData.updateCount ?? 0, language)}</dd>
              </div>
              <div>
                <dt><Trash2 size={14} aria-hidden="true" /> {t('removals')}</dt>
                <dd>{formatNumber(installData.removeCount ?? 0, language)}</dd>
              </div>
              <div>
                <dt><XCircle size={14} aria-hidden="true" /> {t('failedOperations')}</dt>
                <dd>{formatNumber(installData.failureCount ?? 0, language)}</dd>
              </div>
            </dl>
          </section>

          {detail && !githubUnavailable && <div className={`notice verification-notice ${detail.verification.bundleDeclared ? 'notice-success' : 'notice-warning'}`}>
            {detail.verification.bundleDeclared ? (
              <CheckCircle2 size={20} aria-hidden="true" />
            ) : (
              <AlertTriangle size={20} aria-hidden="true" />
            )}
            <div>
              <strong>{detail.verification.bundleDeclared ? t('verifiedBundle') : t('unverifiedBundle')}</strong>
              <p>{detail.verification.bundleDeclared ? t('verifiedBody') : t('unverifiedBody')}</p>
            </div>
          </div>}

          <div className="notice security-notice">
            <ShieldAlert size={20} aria-hidden="true" />
            <div>
              <strong>{t('securityTitle')}</strong>
              <p>{t('securityBody')}</p>
            </div>
          </div>
        </div>

        <aside className="package-sidebar" aria-labelledby="package-info-heading">
          <h2 id="package-info-heading">
            <Package size={18} aria-hidden="true" />
            {t('packageInfo')}
          </h2>
          <dl className="package-facts">
            <div><dt>{t('version')}</dt><dd>{manifest?.version ?? npmMethod?.revision ?? githubFactFallback}</dd></div>
            <div><dt>{t('license')}</dt><dd>{manifest?.license ?? github?.license ?? githubFactFallback}</dd></div>
            <div><dt>{t('bundlePatch')}</dt><dd><code>{manifest?.bundlePatch ?? githubFactFallback}</code></dd></div>
            <div><dt>{t('dependencies')}</dt><dd>{manifest?.dependencies ?? githubFactFallback}</dd></div>
            <div><dt>{t('peerDependencies')}</dt><dd>{manifest?.peerDependencies ?? githubFactFallback}</dd></div>
            <div><dt>{t('runtime')}</dt><dd>{runtime ?? githubFactFallback}</dd></div>
          </dl>
          {github?.homepage && (
            <a className="sidebar-link" href={github.homepage} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              {github.homepage.replace(/^https?:\/\//, '')}
            </a>
          )}
        </aside>

        <section className="detail-section readme-section" aria-labelledby="readme-heading">
          <h2 id="readme-heading">{t('readme')}</h2>
          {detail?.readme ? (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeSlug]}
                components={{
                  h1: ({ node: _node, children, ...props }) => <h3 {...props}>{children}</h3>,
                  h2: ({ node: _node, children, ...props }) => <h3 {...props}>{children}</h3>,
                  h3: ({ node: _node, children, ...props }) => <h4 {...props}>{children}</h4>,
                  a: ({ href, children }) => {
                    if (href?.startsWith('#')) {
                      // Fragment links must never reach the router: under hash-based
                      // routing the fragment is the route and would 404.
                      return (
                        <a
                          href={href}
                          onClick={(event) => {
                            event.preventDefault()
                            const target = document.getElementById(decodeURIComponent(href.slice(1)))
                            target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }}
                        >
                          {children}
                        </a>
                      )
                    }
                    return (
                      <a href={readmeLink(href, readmeLocation)} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    )
                  },
                  img: ({ src, alt }) => <img src={readmeImage(src, readmeLocation)} alt={alt ?? ''} loading="lazy" />,
                }}
              >
                {detail.readme}
              </ReactMarkdown>
            </div>
          ) : githubLoading ? (
            <p className="muted-copy" role="status">{t('githubDetailsLoading')}</p>
          ) : githubUnavailable ? (
            <p className="muted-copy">{t('githubDetailsUnavailableBody')}</p>
          ) : (
            <p className="muted-copy">{t('noReadme')}</p>
          )}
        </section>
      </div>
    </div>
  )
}
