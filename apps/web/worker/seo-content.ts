import { offeredInstallCommand } from './lib/install-methods'
import { pluginDetailPath } from './lib/plugin-id'
import { BRAND_HEADING } from './seo-templates'
import type { CatalogPlugin, Language, RegistryCategory } from './types'

/**
 * Crawlable HTML for the SPA shell.
 *
 * The React app is client rendered, so the document the Worker serves carries an
 * empty `#root`. Googlebot renders JavaScript eventually, but Bingbot and the
 * AI crawlers (GPTBot, ClaudeBot, PerplexityBot) largely do not, and a ~3k-page
 * catalog is far past the budget where "render later" means "index never".
 *
 * These renderers emit the same facts the React page shows — headline, copy,
 * install command, catalog links — into `#root`. React clears the container on
 * mount, so the markup is a pre-hydration projection of the real page, never a
 * separate document that could drift into cloaking.
 */

const DESCRIPTION_CLAMP = 180

export interface ShellCatalog {
  updated: string
  plugins: CatalogPlugin[]
  categories: Record<string, RegistryCategory>
}

export interface ShellCopy {
  heading: string
  intro: string
  listHeading: string
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function clamp(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`
}

/** Defence in depth: catalog URLs are validated at ingest, but this markup is
    server-rendered, so anything but an https GitHub URL is dropped rather than
    linked. */
function safeExternalHref(url: string): string | null {
  return /^https:\/\/[a-z0-9.-]+\//i.test(url) ? url : null
}

function pluginHref(plugin: CatalogPlugin): string {
  return pluginDetailPath(plugin.id)
}

function labelFor(
  categories: Record<string, RegistryCategory>,
  id: string,
  language: Language,
): string {
  const label = categories[id]
  if (label) return label[language]
  return language === 'zh' ? '待分类' : 'Unclassified'
}

function starCount(plugin: CatalogPlugin): number {
  return typeof plugin.stars === 'number' && plugin.stars > 0 ? plugin.stars : 0
}

function byStars(left: CatalogPlugin, right: CatalogPlugin): number {
  return starCount(right) - starCount(left) || left.name.localeCompare(right.name)
}

/** One catalog row: a crawlable link plus the facts that make it worth clicking. */
function pluginListItem(
  plugin: CatalogPlugin,
  categories: Record<string, RegistryCategory>,
  language: Language,
): string {
  const stars = starCount(plugin)
  const meta = [
    `${language === 'zh' ? '作者' : 'by'} ${plugin.owner}`,
    labelFor(categories, plugin.category, language),
    stars > 0 ? `${stars} ${language === 'zh' ? '星标' : 'stars'}` : '',
  ].filter(Boolean).join(' · ')
  return [
    '<li>',
    `<a href="${escapeHtml(pluginHref(plugin))}">${escapeHtml(plugin.name)}</a>`,
    ` <span class="seo-shell-meta">${escapeHtml(meta)}</span>`,
    `<p>${escapeHtml(clamp(plugin.description[language], DESCRIPTION_CLAMP))}</p>`,
    '</li>',
  ].join('')
}

/**
 * Categories are labels, not links: `/plugins?category=…` is deliberately
 * noindexed and there is no standalone category route yet, so linking here
 * would spend crawl budget on pages that decline to be indexed.
 */
function categorySummary(catalog: ShellCatalog, language: Language): string {
  const counts = new Map<string, number>()
  for (const plugin of catalog.plugins) {
    counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1)
  }
  const items = Object.keys(catalog.categories)
    .filter((id) => (counts.get(id) ?? 0) > 0)
    .map((id) => `<li>${escapeHtml(`${labelFor(catalog.categories, id, language)} (${counts.get(id) ?? 0})`)}</li>`)
  if (items.length === 0) return ''
  const heading = language === 'zh' ? '插件分类' : 'Plugin categories'
  return [
    '<section class="seo-shell-categories">',
    `<h2>${escapeHtml(heading)}</h2>`,
    `<ul>${items.join('')}</ul>`,
    '</section>',
  ].join('')
}

/**
 * Neighbours first, then the category's best known plugins.
 *
 * Ranking by stars alone would link the same dozen repositories from every one
 * of ~2,900 pages and leave the rest of the catalog with no inbound link at
 * all. Walking the snapshot's own ordering instead chains every plugin to its
 * neighbours, so each one is reachable, and the starred entries still get
 * surfaced on top of that.
 */
function relatedPlugins(plugin: CatalogPlugin, catalog: ShellCatalog): CatalogPlugin[] {
  const index = catalog.plugins.findIndex((item) => item.url === plugin.url)
  const picked = new Map<string, CatalogPlugin>()
  if (index >= 0) {
    for (let offset = 1; offset <= 4; offset += 1) {
      for (const neighbour of [
        catalog.plugins[(index + offset) % catalog.plugins.length],
        catalog.plugins[(index - offset + catalog.plugins.length) % catalog.plugins.length],
      ]) {
        if (neighbour && neighbour.url !== plugin.url) picked.set(neighbour.url, neighbour)
      }
    }
  }
  const sameCategory = catalog.plugins
    .filter((item) => item.category === plugin.category && item.url !== plugin.url)
    .sort(byStars)
  for (const item of sameCategory) {
    if (picked.size >= 12) break
    picked.set(item.url, item)
  }
  return [...picked.values()].slice(0, 12)
}

function shell(inner: string): string {
  return `<div class="seo-shell" data-seo-shell>${inner}</div>`
}

/** Rankings (`/`) and catalog (`/plugins`) share one collection template. */
export function renderCollectionShell(
  catalog: ShellCatalog,
  language: Language,
  copy: ShellCopy,
  options: { listed: CatalogPlugin[]; showCategories: boolean },
): string {
  const listed = options.listed
  const rows = listed.map((plugin) => pluginListItem(plugin, catalog.categories, language)).join('')
  const total = catalog.plugins.length
  const totalNote = language === 'zh'
    ? `目录共收录 ${total} 个 DeepSeek Harness 插件，数据更新于 ${catalog.updated}。`
    : `The catalog indexes ${total} DeepSeek Harness plugins. Data updated ${catalog.updated}.`
  const browseAll = listed.length < total
    ? `<p><a href="/plugins">${escapeHtml(
        language === 'zh' ? `浏览全部 ${total} 个 DeepSeek Harness 插件` : `Browse all ${total} DeepSeek Harness plugins`,
      )}</a></p>`
    : ''
  return shell([
    // Mirrors the rendered masthead heading exactly; the view-specific wording
    // lives in the H2 below, as it does after hydration.
    `<h1>${escapeHtml(BRAND_HEADING)}</h1>`,
    `<p>${escapeHtml(copy.intro)}</p>`,
    `<p>${escapeHtml(totalNote)}</p>`,
    // Only the catalog view renders a category breakdown; showing one on the
    // rankings view would make `/` a strict subset duplicate of `/plugins`.
    options.showCategories ? categorySummary(catalog, language) : '',
    `<h2>${escapeHtml(copy.listHeading)}</h2>`,
    `<ol class="seo-shell-list">${rows}</ol>`,
    browseAll,
  ].join(''))
}

export function renderPluginShell(
  plugin: CatalogPlugin,
  catalog: ShellCatalog,
  language: Language,
  categoryLabel: string,
): string {
  const zh = language === 'zh'
  const related = relatedPlugins(plugin, catalog)
    .map((item) => `<li><a href="${escapeHtml(pluginHref(item))}">${escapeHtml(item.name)}</a></li>`)
    .join('')
  const stars = starCount(plugin)
  const repositoryLink = safeExternalHref(plugin.url)
  const offeredCommand = offeredInstallCommand(plugin)
  const facts = [
    `<dt>${zh ? '作者' : 'Author'}</dt><dd><a href="https://github.com/${escapeHtml(plugin.owner)}" rel="noopener">${escapeHtml(plugin.owner)}</a></dd>`,
    `<dt>${zh ? '分类' : 'Category'}</dt><dd>${escapeHtml(categoryLabel)}</dd>`,
    stars > 0 ? `<dt>${zh ? 'GitHub 星标' : 'GitHub stars'}</dt><dd>${stars}</dd>` : '',
    `<dt>${zh ? '收录时间' : 'Added'}</dt><dd>${escapeHtml(plugin.added)}</dd>`,
  ].filter(Boolean).join('')
  return shell([
    `<nav class="seo-shell-breadcrumb"><a href="/plugins">${escapeHtml(zh ? 'DeepSeek Harness 插件目录' : 'DeepSeek Harness plugin catalog')}</a></nav>`,
    `<h1>${escapeHtml(plugin.name)}</h1>`,
    `<p>${escapeHtml(plugin.description[language])}</p>`,
    `<h2>${escapeHtml(zh ? `安装 ${plugin.name}` : `Install ${plugin.name}`)}</h2>`,
    // Always the official DSH CLI command: the registry `install` field is the
    // contract, and wrapper commands stay display-layer only. Only npm installs
    // are offered — a plugin without a published npm package is browse-only,
    // and the shell says so instead of printing a command nobody should run.
    offeredCommand
      ? `<pre class="seo-shell-install"><code>${escapeHtml(offeredCommand)}</code></pre>`
      : `<p class="seo-shell-install-unavailable">${escapeHtml(zh
          ? '该插件尚未发布 npm 包，1024 Store 暂不提供安装；可通过下方仓库链接查看源码。'
          : 'This plugin has not published an npm package, so the store does not offer an install command yet. Use the repository link below to view the source.')}</p>`,
    `<h2>${escapeHtml(zh ? '插件信息' : 'Plugin details')}</h2>`,
    `<dl class="seo-shell-facts">${facts}</dl>`,
    repositoryLink
      ? `<p><a href="${escapeHtml(repositoryLink)}" rel="noopener">${escapeHtml(zh ? '在 GitHub 上查看源码' : 'View the source on GitHub')}</a></p>`
      : '',
    related
      ? `<h2>${escapeHtml(zh ? `更多${categoryLabel}插件` : `More ${categoryLabel.toLocaleLowerCase('en-US')} plugins`)}</h2><ul class="seo-shell-related">${related}</ul>`
      : '',
  ].join(''))
}

export function renderNotFoundShell(heading: string, body: string, linkText: string): string {
  return shell([
    `<h1>${escapeHtml(heading)}</h1>`,
    `<p>${escapeHtml(body)}</p>`,
    `<p><a href="/plugins">${escapeHtml(linkText)}</a></p>`,
  ].join(''))
}

export function renderSimpleShell(heading: string, body: string): string {
  return shell(`<h1>${escapeHtml(heading)}</h1><p>${escapeHtml(body)}</p>`)
}
