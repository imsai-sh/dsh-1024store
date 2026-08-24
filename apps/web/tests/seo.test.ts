import { describe, expect, it } from 'vitest'
import {
  buildApiHostRobotsTxt,
  buildLlmsFullTxt,
  buildRobotsTxt,
  buildSitemap,
  detailRedirectForPath,
  metadataForPath,
  seoCatalog,
  type SeoCatalog,
} from '../worker/seo'
import { TEST_PLUGINS, testCatalogResult } from './fixtures'
import { pluginDetailPath } from '../worker/lib/plugin-id'

function testSeoCatalog(): SeoCatalog {
  return seoCatalog(testCatalogResult().snapshot)
}

/**
 * Every `@id` a payload points at has to be defined in the same payload.
 * References are objects carrying `@id` and nothing else; nodes carry `@type`.
 */
function danglingReferences(schema: object): string[] {
  const defined = new Set<string>()
  const referenced: string[] = []
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (!value || typeof value !== 'object') return
    const node = value as Record<string, unknown>
    const id = typeof node['@id'] === 'string' ? node['@id'] : null
    if (id) {
      if (node['@type']) defined.add(id)
      else referenced.push(id)
    }
    Object.values(node).forEach(walk)
  }
  walk(schema)
  return referenced.filter((id) => !defined.has(id))
}

describe('SEO metadata', () => {
  it('serves the dedicated embed route as a noindex 200 page', () => {
    const metadata = metadataForPath('/embed/store', testSeoCatalog())
    expect(metadata.status).toBe(200)
    expect(metadata.robots).toBe('noindex,follow')
    expect(metadata.canonical).toBeNull()
  })

  it('builds unique canonical metadata for collection and plugin pages', () => {
    const catalogPages = testSeoCatalog()
    const catalog = metadataForPath('/plugins', catalogPages)
    const home = metadataForPath('/', catalogPages)
    const rankings = metadataForPath('/rankings', catalogPages)
    const plugin = TEST_PLUGINS[0]!
    const detail = metadataForPath(`/plugins/${plugin.owner}/${plugin.repository}`, catalogPages)

    expect(catalog.canonical).toBe('https://deepseek1024.com/plugins')
    expect(home.canonical).toBe('https://deepseek1024.com/')
    expect(rankings.canonical).toBe(home.canonical)
    expect(catalog.title).not.toBe(rankings.title)
    expect(detail.status).toBe(200)
    expect(detail.canonical).toContain(`/plugins/${plugin.owner}/`)
    expect(detail.title).toContain(plugin.name)
    expect(detail.title.length).toBeLessThanOrEqual(60)
    expect(detail.description.length).toBeLessThanOrEqual(160)
  })

  it('targets the store and marketplace terms in the collection titles', () => {
    const catalogPages = testSeoCatalog()
    expect(metadataForPath('/', catalogPages).title).toContain('Plugin Store')
    expect(metadataForPath('/plugins', catalogPages).title).toContain('Plugin Marketplace')
    expect(metadataForPath('/plugins', catalogPages).description).toContain('plugin hub')
  })

  it('keeps plugin titles unique when two owners publish the same name', () => {
    const plugin = TEST_PLUGINS[0]!
    const twin = {
      ...plugin,
      // Identity is the id now, so the twin needs its own — sharing one would
      // make both URLs resolve to the same plugin.
      id: `other-owner/${plugin.repository}`,
      owner: 'other-owner',
      url: `https://github.com/other-owner/${plugin.repository}`,
    }
    const catalog: SeoCatalog = {
      ...testSeoCatalog(),
      plugins: [plugin, twin],
    }
    const first = metadataForPath(`/plugins/${plugin.owner}/${plugin.repository}`, catalog)
    const second = metadataForPath(`/plugins/other-owner/${plugin.repository}`, catalog)

    expect(first.title).not.toBe(second.title)
    expect(first.title).toContain(plugin.owner)
    expect(second.title).toContain('other-owner')
    // The brand tail is what gets dropped when space runs out, never the name.
    expect(first.title).not.toMatch(/…$/)
  })

  it('publishes a resolvable entity graph on every surface', () => {
    const catalogPages = testSeoCatalog()
    const plugin = TEST_PLUGINS[0]!
    const paths = ['/', '/plugins', '/docs/api', '/account', `/plugins/${plugin.owner}/${plugin.repository}`, '/nope']

    for (const path of paths) {
      const { schema } = metadataForPath(path, catalogPages)
      expect(danglingReferences(schema), `dangling @id on ${path}`).toEqual([])
      expect(JSON.stringify(schema)).toContain('"@id":"https://deepseek1024.com/#website"')
    }

    const website = JSON.stringify(metadataForPath('/', catalogPages).schema)
    expect(website).toContain('"name":"DSH 1024Store"')
    expect(website).not.toContain('SearchAction')
    expect(website).not.toContain('search_term_string')
    expect(website).toContain('"DeepSeek Harness Plugin Store"')
    expect(website).toContain('"DSH"')
  })

  it('ranks each ItemList the way that page actually ranks', () => {
    const itemList = (path: string) => {
      const parsed = JSON.parse(JSON.stringify(metadataForPath(path, testSeoCatalog()).schema)) as {
        '@graph': Record<string, unknown>[]
      }
      return parsed['@graph'].find((node) => node['@type'] === 'ItemList') as {
        numberOfItems: number
        itemListElement: { name: string; position: number }[]
      }
    }

    // `/plugins` sorts by stars; `/` defaults to 24h star growth, and plugins
    // with no growth reading are absent from that ranking entirely.
    const topByStars = [...TEST_PLUGINS].sort((left, right) => (right.stars ?? 0) - (left.stars ?? 0))[0]!
    const withGrowth = TEST_PLUGINS.filter((plugin) => plugin.growth24h !== null)
    const topByGrowth = [...withGrowth].sort((left, right) => (right.growth24h ?? 0) - (left.growth24h ?? 0))[0]!

    expect(itemList('/plugins').numberOfItems).toBe(TEST_PLUGINS.length)
    expect(itemList('/plugins').itemListElement[0]?.name).toBe(topByStars.name)
    expect(itemList('/').numberOfItems).toBe(withGrowth.length)
    expect(itemList('/').itemListElement[0]?.name).toBe(topByGrowth.name)
  })

  it('describes plugins as installable software without inventing ratings', () => {
    const plugin = TEST_PLUGINS[0]!
    const { schema } = metadataForPath(`/plugins/${plugin.owner}/${plugin.repository}`, testSeoCatalog())
    const json = JSON.stringify(schema)

    expect(json).toContain('SoftwareApplication')
    expect(json).toContain('SoftwareSourceCode')
    expect(json).toContain('InteractionCounter')
    expect(json).not.toContain('aggregateRating')
    expect(json).toContain('BreadcrumbList')
  })

  it('marks unknown pages as noindex soft-404 replacements without a canonical', () => {
    const missing = metadataForPath('/plugins/example/missing', testSeoCatalog())
    expect(missing.status).toBe(404)
    expect(missing.robots).toBe('noindex,follow')
    expect(missing.canonical).toBeNull()
  })

  it('returns a retryable response instead of a soft 404 when the catalog is unavailable', () => {
    const degraded: SeoCatalog = { ...testSeoCatalog(), plugins: [], degraded: true }
    const page = metadataForPath('/plugins/acme/widget', degraded)

    expect(page.status).toBe(503)
    expect(page.robots).toBe('index,follow')
    expect(page.canonical).toBe('https://deepseek1024.com/plugins/acme/widget')
    expect(page.title).toContain('widget')
    expect(page.shell).toContain('temporarily unavailable')
  })

  it('strips control characters out of URL-derived titles', () => {
    const degraded: SeoCatalog = { ...testSeoCatalog(), plugins: [], degraded: true }
    const page = metadataForPath('/plugins/acme/wid%3Cscript%3Eget', degraded)

    expect(page.title).not.toContain('<')
    expect(page.title).not.toContain('>')
  })
})

describe('crawlable shell', () => {
  it('renders the plugin page as HTML a non-rendering crawler can read', () => {
    // TEST_PLUGINS[0] is npm-published: the shell prints its npm command and
    // never a source command.
    const plugin = TEST_PLUGINS[0]!
    const { shell } = metadataForPath(`/plugins/${plugin.owner}/${plugin.repository}`, testSeoCatalog())

    expect(shell).toBeTruthy()
    expect(shell).toContain('<h1>')
    expect(shell).toContain(plugin.name)
    expect(shell).toContain(plugin.install)
    expect(shell).not.toContain('seo-shell-install-unavailable')
    expect(shell).not.toContain('add github:')
    expect(shell).toContain(`href="${plugin.url}"`)
    // The npx wrapper is a display-layer affordance and must never be rendered
    // into HTML the crawler treats as the canonical install instruction.
    expect(shell).not.toContain('npx @dsh-1024store/')
  })

  it('states browse-only instead of printing a source command', () => {
    // No npm package: the shell says the store cannot install the plugin and
    // relies on the repository link, never the github: command that is no
    // longer offered.
    const plugin = TEST_PLUGINS[2]!
    const { shell } = metadataForPath(`/plugins/${plugin.owner}/${plugin.repository}`, testSeoCatalog())

    expect(shell).toContain('seo-shell-install-unavailable')
    expect(shell).not.toContain(plugin.install)
    expect(shell).not.toContain('add github:')
    expect(shell).toContain(`href="${plugin.url}"`)
  })

  it('links the catalog pages to plugin detail pages', () => {
    const shell = metadataForPath('/plugins', testSeoCatalog()).shell ?? ''
    for (const plugin of TEST_PLUGINS) {
      expect(shell).toContain(`href="${pluginDetailPath(plugin.id)}"`)
    }
    expect(shell).toContain('<h1>')
    expect(shell).toContain('<h2>')
  })

  it('gives every catalog entry an inbound link, not just the starred few', () => {
    const catalog = testSeoCatalog()
    const linked = new Set<string>()
    for (const plugin of TEST_PLUGINS) {
      const shell = metadataForPath(pluginDetailPath(plugin.id), catalog).shell ?? ''
      for (const match of shell.matchAll(/href="(\/plugins\/[^"]+)"/g)) {
        linked.add(match[1] as string)
      }
    }
    // Ranking related plugins by stars alone would link the same handful from
    // every page and strand the tail of the catalog with no inbound link.
    for (const plugin of TEST_PLUGINS) {
      const path = pluginDetailPath(plugin.id)
      expect(linked.has(path), `no page links to ${path}`).toBe(true)
    }
  })

  it('only breaks the catalog out by category where the page does', () => {
    const catalog = testSeoCatalog()
    // A category list on `/` would make it a strict subset duplicate of /plugins.
    expect(metadataForPath('/', catalog).shell).not.toContain('Plugin categories')
    expect(metadataForPath('/plugins', catalog).shell).toContain('Plugin categories')
  })

  it('never links to routes that do not exist', () => {
    const catalogPages = testSeoCatalog()
    const plugin = TEST_PLUGINS[0]!
    for (const path of ['/', '/plugins', `/plugins/${plugin.owner}/${plugin.repository}`]) {
      expect(metadataForPath(path, catalogPages).shell).not.toContain('/plugins/category/')
    }
  })

  it('escapes catalog text so a repository description cannot inject markup', () => {
    const plugin = TEST_PLUGINS[0]!
    const hostile = {
      ...plugin,
      description: { en: '<script>alert(1)</script>', zh: '<script>alert(1)</script>' },
    }
    const catalog: SeoCatalog = { ...testSeoCatalog(), plugins: [hostile] }
    const shell = metadataForPath(`/plugins/${plugin.owner}/${plugin.repository}`, catalog).shell ?? ''

    expect(shell).not.toContain('<script>')
    expect(shell).toContain('&lt;script&gt;')
  })
})

describe('crawler directives', () => {
  it('lists every snapshot plugin in the sitemap and dates them by activity', () => {
    const catalog = testSeoCatalog()
    const sitemap = buildSitemap(catalog)
    const urlCount = (sitemap.match(/<url>/g) ?? []).length

    expect(urlCount).toBe(TEST_PLUGINS.length + 3)
    expect(sitemap).toContain('<loc>https://deepseek1024.com/</loc>')
    expect(sitemap).toContain('<loc>https://deepseek1024.com/docs/api</loc>')
    expect(sitemap).not.toContain('<loc>https://deepseek1024.com/rankings</loc>')
    for (const plugin of TEST_PLUGINS) {
      // Subdirectory ids keep their path segments; each is encoded separately.
      const path = plugin.id.split('/').map(encodeURIComponent).join('/')
      expect(sitemap).toContain(`/plugins/${path}</loc>`)
    }
    expect(sitemap).not.toContain('<loc>https://deepseek1024.com/plugin</loc>')
    // The legacy detail route, not the literal segment: a monorepo plugin id
    // legitimately contains a `packages/` directory.
    expect(sitemap).not.toContain('https://deepseek1024.com/packages/')

    // Repository activity, not the catalog-entry date, is what actually changes
    // a detail page; a plugin with no push data falls back to `added`. Assert
    // the pairing, not the mere presence of a date somewhere in the document.
    const lastmodFor = (path: string) =>
      sitemap.match(
        new RegExp(`<loc>https://deepseek1024\\.com${path.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')}</loc>\\s*<lastmod>([^<]+)</lastmod>`),
      )?.[1]

    for (const plugin of TEST_PLUGINS) {
      const path = `/plugins/${plugin.id.split('/').map(encodeURIComponent).join('/')}`
      expect(lastmodFor(path), `lastmod for ${path}`)
        .toBe((plugin.pushedAt ?? plugin.updatedAt ?? plugin.added).slice(0, 10))
    }
    // A static reference page with a fabricated lastmod trains crawlers to
    // ignore the field, so /docs/api ships without one.
    expect(sitemap).toMatch(/<loc>https:\/\/deepseek1024\.com\/docs\/api<\/loc>\s*<\/url>/)
  })

  it('lets crawlers read the API the pages are built from, and nothing else', () => {
    const robots = buildRobotsTxt()

    expect(robots).toContain('Allow: /api/v1/plugins')
    expect(robots).toContain('Disallow: /api/v1/auth/')
    expect(robots).toContain('Disallow: /api/v1/api-keys')
    expect(robots).toContain('Disallow: /api/v1/install-events')
    expect(robots).not.toMatch(/^Disallow: \/api\/$/m)
    expect(robots).toContain('Sitemap: https://deepseek1024.com/sitemap.xml')
    for (const agent of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      expect(robots).toContain(`User-agent: ${agent}`)
    }
  })

  it('keeps the API-only host out of the index entirely', () => {
    // Nothing on that host is a page, and its clients call it directly rather
    // than crawling it, so there is nothing to open up.
    expect(buildApiHostRobotsTxt()).toBe('User-agent: *\nDisallow: /\n')
  })

  it('publishes the whole catalog as plain text for answer engines', () => {
    const llms = buildLlmsFullTxt(testSeoCatalog())

    for (const plugin of TEST_PLUGINS) {
      expect(llms).toContain(plugin.name)
      expect(llms).toContain(`${plugin.owner}/${plugin.repository}`)
    }
    // npm installs are the only offered method; browse-only plugins carry
    // their repository link instead of a source command.
    expect(llms).toContain(`install: ${TEST_PLUGINS[0]!.install}`)
    expect(llms).toContain('— source: https://github.com/')
    expect(llms).not.toContain('dsh plugin --profile web add github:')
    expect(llms).not.toContain('npx @dsh-1024store/')
  })
  it('redirects a repository address to the subpackage that succeeded it', () => {
    const catalog = testSeoCatalog()

    // omdsh-dev/dsh-suite is not itself a plugin; two subpackages live under
    // it, so the address cannot pick a winner and lands on the filtered catalog.
    expect(detailRedirectForPath('/plugins/omdsh-dev/dsh-suite', catalog))
      .toBe('/plugins?q=omdsh-dev%2Fdsh-suite')

    // With a single successor the old address redirects straight to it.
    const single: SeoCatalog = {
      ...catalog,
      plugins: catalog.plugins.filter((plugin) => plugin.id !== 'omdsh-dev/dsh-suite/packages/dsh-timeline'),
    }
    expect(detailRedirectForPath('/plugins/omdsh-dev/dsh-suite', single))
      .toBe('/plugins/omdsh-dev/dsh-suite/packages/dsh-inspector')
    expect(detailRedirectForPath('/plugins/omdsh-dev/dsh-suite/', single))
      .toBe('/plugins/omdsh-dev/dsh-suite/packages/dsh-inspector')

    // A repository rename must not strand the new GitHub slug at a 404 while
    // the stable, previously published plugin id remains canonical.
    const renamed: SeoCatalog = {
      ...catalog,
      plugins: [{
        ...catalog.plugins[0]!,
        id: 'Fishquito7/dsh-skill-viewer',
        owner: 'Fishquito7',
        name: 'dsh-skill-mcp-panel',
        repository: 'dsh-skill-mcp-panel',
        url: 'https://github.com/Fishquito7/dsh-skill-mcp-panel',
      }],
    }
    expect(detailRedirectForPath('/plugins/Fishquito7/dsh-skill-mcp-panel', renamed))
      .toBe('/plugins/Fishquito7/dsh-skill-viewer')

    // An address that resolves to a real plugin is never redirected, and one
    // with no successors keeps its 404.
    expect(detailRedirectForPath('/plugins/omdsh-dev/dsh-gomoku', catalog)).toBeNull()
    expect(detailRedirectForPath('/plugins/omdsh-dev/dsh-suite/packages/dsh-inspector', catalog)).toBeNull()
    expect(detailRedirectForPath('/plugins/nobody/nothing', catalog)).toBeNull()
    expect(detailRedirectForPath('/plugins', catalog)).toBeNull()
  })
})
