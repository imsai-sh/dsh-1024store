import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true })
const desktopContext = await browser.newContext({ locale: 'zh-CN' })
const mobileContext = await browser.newContext({
  locale: 'zh-CN',
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  permissions: ['clipboard-read', 'clipboard-write'],
})
const errors = []

/**
 * Noise this check must not fail on.
 *
 * The VibeCafe telemetry tag in index.html posts to its own origin, which does
 * not allow http://127.0.0.1, so every local run collects one CORS error per
 * page. It is a third-party script that cannot succeed off the production
 * hostname; failing the layout suite on it would mean the suite is red for
 * everyone, always, for a reason nobody can fix locally.
 */
const IGNORED_ERROR_PATTERNS = [/vibecafe\.ai\/api\/products\//]

function isIgnorable(text) {
  return IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

async function openPage(viewport, path, { touch = false } = {}) {
  const context = touch ? mobileContext : desktopContext
  const page = await context.newPage()
  await page.setViewportSize(viewport)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400 && !isIgnorable(response.url())) {
      errors.push(`HTTP ${response.status()} ${response.url()}`)
    }
  })
  page.on('console', (message) => {
    if (
      message.type() === 'error'
      && !message.text().startsWith('Failed to load resource:')
      && !isIgnorable(message.text())
    ) {
      errors.push(`${page.url()}: ${message.text()}`)
    }
  })
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' })
  return page
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
  if (overflow) throw new Error(`${label} has horizontal overflow`)
}

// The hero clips decorative overflow, so document-level overflow alone cannot
// detect an action row whose right edge was pushed outside the viewport.
async function assertActionsWithinViewport(page, label) {
  const box = await page.locator('.catalog-hero .hero-actions').evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return { left: Math.round(rect.left), right: Math.round(rect.right), viewport: window.innerWidth }
  })
  if (box.left < -1 || box.right > box.viewport + 1) {
    throw new Error(`${label} action row is clipped by the viewport: ${JSON.stringify(box)}`)
  }
}

async function assertVisibleSubdirectorySiblingsHaveDistinctTitles(page, label) {
  const duplicateTitles = await page.locator('.package-row').evaluateAll((rows) => {
    const siblings = new Map()
    for (const row of rows) {
      const link = row.querySelector('.row-link')
      const href = link?.getAttribute('href') ?? ''
      const segments = href.split('/').filter(Boolean)
      if (segments.length <= 3) continue
      const repositoryPath = segments.slice(0, 3).join('/')
      const titles = siblings.get(repositoryPath) ?? []
      titles.push(link?.textContent?.trim() ?? '')
      siblings.set(repositoryPath, titles)
    }
    return [...siblings.entries()]
      .filter(([, titles]) => titles.length > 1 && new Set(titles).size !== titles.length)
  })
  if (duplicateTitles.length > 0) {
    throw new Error(`${label} repeats titles for subdirectory siblings: ${JSON.stringify(duplicateTitles)}`)
  }
}

/**
 * A ranking seat that stands for a whole repository has to say so and open.
 *
 * Boards ranked by a repository-level metric (stars, growth, activity, newest)
 * seat a repository once, because every plugin it publishes carries the same
 * numbers. The seat therefore has to disclose how many plugins it represents
 * and let the reader reach them; a bare count told neither. Skips when the
 * dataset happens to hold no multi-plugin repository.
 */
async function assertRepositorySeatDisclosure(page, label, { touchTargets = false } = {}) {
  const toggle = page.locator('.package-row .row-repo-toggle').first()
  if ((await toggle.count()) === 0) return
  const caption = (await toggle.textContent())?.trim() ?? ''
  if (!/\d/.test(caption)) {
    throw new Error(`${label} repository seat does not say how many plugins it stands for: "${caption}"`)
  }
  if ((await toggle.getAttribute('aria-expanded')) !== 'false') {
    throw new Error(`${label} repository seat does not start collapsed`)
  }
  const panelId = await toggle.getAttribute('aria-controls')
  if (!panelId) throw new Error(`${label} repository seat is not wired to a panel`)
  await toggle.click()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    throw new Error(`${label} repository seat did not expand`)
  }
  const listed = await page.locator(`#${panelId} .package-row`).count()
  if (listed < 2) {
    throw new Error(`${label} expanded repository seat lists ${listed} plugins, expected the whole repository`)
  }
  // The panel's rows are ordinary catalog rows, indented under the seat. If they
  // ever stop being indented the panel reads as more board entries instead.
  const indent = await page.locator(`#${panelId}`).evaluate((node) => {
    const row = node.closest('.package-row')
    return row === null ? 0 : node.getBoundingClientRect().left - row.getBoundingClientRect().left
  })
  if (indent <= 0) {
    throw new Error(`${label} expanded repository panel is not indented under its seat`)
  }
  // The panel's rows only exist once it is open, so the sweep over the closed
  // board never sees them and they need checking here.
  if (touchTargets) {
    await assertMinTouchTargets(page, `${label} expanded repository panel`, [
      '.row-repo-panel .package-row .row-link',
      '.row-repo-panel .package-row .split-install-main',
      '.row-repo-panel .package-row .split-install-toggle',
    ])
    // The panel's rows carry the desktop grid unless the narrow rule overrides
    // it, and `.row-repo-panel .package-row` outranks the shared `.package-row`
    // one — so a missing override does not overflow the page, it silently
    // clips ~680px of columns inside a ~300px panel.
    const clipped = await page.locator('.row-repo-panel .package-row').evaluateAll((rows) =>
      rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length)
    if (clipped > 0) {
      throw new Error(`${label} clips ${clipped} rows inside the repository panel`)
    }
  }

  // The whole width of a plugin row navigates, trailing arrow included: the
  // stretched overlay must survive inside the panel. Scoping the repository
  // row's overlay reset with a descendant selector once switched it off for
  // every row in the panel, which left the arrow inert and looked like a
  // broken link rather than a CSS scope bug.
  const overlay = await page.locator(`#${panelId} .package-row .row-link`).first()
    .evaluate((node) => getComputedStyle(node, '::after').content)
  if (overlay === 'none') {
    throw new Error(`${label} panel rows lost the stretched row link`)
  }
  await assertNoHorizontalOverflow(page, `${label} with a repository seat expanded`)
  await toggle.click()
  if ((await toggle.getAttribute('aria-expanded')) !== 'false') {
    throw new Error(`${label} repository seat did not collapse again`)
  }
}

async function assertMobileEnvironment(page, label) {
  const result = await page.evaluate(() => ({
    maxTouchPoints: navigator.maxTouchPoints,
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
  }))
  if (result.maxTouchPoints < 1) throw new Error(`${label} is not running with touch input`)
  if (!result.viewport.includes('width=device-width')) {
    throw new Error(`${label} is missing a device-width viewport declaration`)
  }
}

async function assertMinTouchTargets(page, label, selectors) {
  const undersized = await page.locator(selectors.join(', ')).evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const style = getComputedStyle(node)
        const box = node.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
      })
      .map((node) => {
        // A stretched link wraps short text but takes its hit area from an
        // absolutely positioned ::after covering the whole card, so measuring
        // the anchor's own box would understate the real touch target.
        const overlay = getComputedStyle(node, '::after')
        const stretched = overlay.position === 'absolute' &&
          overlay.inset === '0px' &&
          node.offsetParent !== null
        const box = (stretched ? node.offsetParent : node).getBoundingClientRect()
        return {
          height: Math.round(box.height),
          label: node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 40) ?? node.tagName,
          width: Math.round(box.width),
        }
      })
      .filter(({ height, width }) => height < 44 || width < 44),
  )
  if (undersized.length > 0) {
    throw new Error(`${label} has touch targets smaller than 44px: ${JSON.stringify(undersized)}`)
  }
}

async function assertMinFontSize(page, label, selector, minimum) {
  const size = await page.locator(selector).first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))
  if (size < minimum) throw new Error(`${label} uses ${size}px text; expected at least ${minimum}px`)
}

async function assertHorizontalTouchScroller(page, label, selector, { requireOverflow = true } = {}) {
  const result = await page.locator(selector).evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    touchAction: getComputedStyle(node).touchAction,
  }))
  if (result.scrollWidth <= result.clientWidth) {
    if (requireOverflow) {
      throw new Error(`${label} does not expose its overflowing controls through a local scroller`)
    }
    // Content fits without scrolling; nothing to pan.
    return
  }
  if (!result.touchAction.includes('pan-x')) {
    throw new Error(`${label} is missing horizontal touch panning`)
  }
}

async function assertWrappedControls(page, label, selector) {
  const result = await page.locator(selector).evaluate((node) => {
    const rows = new Set(
      [...node.querySelectorAll('button')]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => Math.round(button.getBoundingClientRect().top)),
    )
    return {
      rows: rows.size,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      flexWrap: getComputedStyle(node).flexWrap,
    }
  })
  if (result.flexWrap !== 'wrap' || result.rows < 2) {
    throw new Error(`${label} does not wrap onto multiple rows: ${JSON.stringify(result)}`)
  }
  if (result.scrollWidth > result.clientWidth + 1) {
    throw new Error(`${label} still requires horizontal scrolling: ${JSON.stringify(result)}`)
  }
}

// Install commands must stay fully readable: they wrap onto a second line
// instead of hiding their tail behind an inner horizontal scrollbar.
async function assertInstallCommandsReadable(page, label, scope) {
  const clipped = await page.locator(`${scope} .install-command code`).evaluateAll((nodes) => nodes
    .filter((node) => node.scrollWidth > node.clientWidth + 1)
    .map((node) => node.textContent ?? ''))
  if (clipped.length > 0) {
    throw new Error(`${label} clips its install commands: ${JSON.stringify(clipped)}`)
  }
}

// The hero labels sit in one shared column, so all three command boxes have to
// start and end on the same pixel regardless of label width or language.
async function assertHeroCommandsAligned(page, label) {
  const edges = await page.locator('.catalog-hero .self-install-banner .install-command').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return { left: Math.round(box.left), right: Math.round(box.right) }
    }))
  if (edges.length !== 2) {
    throw new Error(`${label} should render two install commands, saw ${edges.length}`)
  }
  const lefts = new Set(edges.map((edge) => edge.left))
  const rights = new Set(edges.map((edge) => edge.right))
  if (lefts.size !== 1 || rights.size !== 1) {
    throw new Error(`${label} install commands are misaligned: ${JSON.stringify(edges)}`)
  }
}

async function heroLanguageGeometry(page) {
  return page.evaluate(() => {
    const heading = document.querySelector('.hero-heading')?.getBoundingClientRect()
    const tally = document.querySelector('.hero-tally')?.getBoundingClientRect()
    const banner = document.querySelector('.self-install-banner')?.getBoundingClientRect()
    const commands = [...document.querySelectorAll('.self-install-banner .install-command')]
      .map((node) => node.getBoundingClientRect())
    const commandLines = [...document.querySelectorAll('.self-install-banner .install-command code')]
      .map((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        return range.getClientRects().length
      })
    const actionBoxes = [...document.querySelectorAll('.hero-actions > *')]
      .map((node) => node.getBoundingClientRect())
    const actionSpan = actionBoxes.length > 0
      ? Math.max(...actionBoxes.map((box) => box.bottom)) - Math.min(...actionBoxes.map((box) => box.top))
      : 0
    const tallestAction = Math.max(0, ...actionBoxes.map((box) => box.height))
    return {
      actionRows: actionSpan > tallestAction + 6 ? 2 : 1,
      bannerWidth: banner ? Math.round(banner.width) : null,
      commandLines,
      commandWidths: commands.map((box) => Math.round(box.width)),
      headingWidth: heading ? Math.round(heading.width) : null,
      tallyWidth: tally ? Math.round(tally.width) : null,
    }
  })
}

// The menu is portaled to document.body, so nothing in the list should be able
// to paint over it. Hit-test its four corners and confirm the topmost element
// at each point still belongs to the menu, and that it fits inside the viewport.
async function assertMenuOnTop(page, label) {
  const result = await page.locator('.split-install-menu').evaluate((menu) => {
    const box = menu.getBoundingClientRect()
    // Stay clear of the 9px rounded corners: a tighter inset lands on the
    // antialiased arc and reports whatever sits behind the menu.
    const inset = 10
    const corners = [
      ['top-left', box.left + inset, box.top + inset],
      ['top-right', box.right - inset, box.top + inset],
      ['bottom-left', box.left + inset, box.bottom - inset],
      ['bottom-right', box.right - inset, box.bottom - inset],
      ['center', (box.left + box.right) / 2, (box.top + box.bottom) / 2],
    ]
    return {
      box: {
        bottom: Math.round(box.bottom),
        left: Math.round(box.left),
        right: Math.round(box.right),
        top: Math.round(box.top),
      },
      covered: corners
        .filter(([, x, y]) => {
          const hit = document.elementFromPoint(x, y)
          return !(hit && (menu === hit || menu.contains(hit)))
        })
        .map(([corner, x, y]) => {
          const hit = document.elementFromPoint(x, y)
          return `${corner}: ${hit ? `${hit.tagName.toLowerCase()}.${hit.className}` : 'null'}`
        }),
      viewport: { height: window.innerHeight, width: window.innerWidth },
    }
  })
  if (result.covered.length > 0) {
    throw new Error(`${label} is covered by other elements at ${JSON.stringify(result.covered)}`)
  }
  const { box, viewport } = result
  if (box.left < 0 || box.top < 0 || box.right > viewport.width || box.bottom > viewport.height) {
    throw new Error(`${label} does not fit inside the viewport: ${JSON.stringify({ box, viewport })}`)
  }
}

async function assertSeo(page, label, canonicalPath, robots = 'index,follow') {
  const result = await page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
    description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
    h1Count: document.querySelectorAll('h1').length,
    h2Count: document.querySelectorAll('h2').length,
    shellLeftBehind: document.querySelectorAll('[data-seo-shell]').length,
    shellGuarded: (() => {
      const probe = document.createElement('div')
      probe.className = 'seo-shell'
      document.body.append(probe)
      const hidden = getComputedStyle(probe).display === 'none'
      probe.remove()
      return document.documentElement.classList.contains('has-js') && hidden
    })(),
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content'),
    title: document.title,
  }))
  // A noindexed permutation ships no canonical at all: pointing it at the
  // unfiltered page would pair a "do not index" with a "index that one instead".
  if (canonicalPath === null) {
    if (result.canonical !== undefined) {
      throw new Error(`${label} should not declare a canonical URL: ${result.canonical}`)
    }
  } else if (result.canonical !== `https://deepseek1024.com${canonicalPath}`) {
    throw new Error(`${label} has an incorrect canonical URL: ${result.canonical}`)
  }
  if (!result.description || result.description.length < 50) {
    throw new Error(`${label} is missing a useful meta description`)
  }
  if (result.h1Count !== 1) throw new Error(`${label} should render exactly one H1`)
  // The Worker injects a crawlable shell into #root for clients that cannot run
  // JavaScript. React replaces it on mount, and the inline head guard must have
  // kept it from ever painting in the meantime.
  if (result.shellLeftBehind !== 0) {
    throw new Error(`${label} still shows the pre-hydration SEO shell after mount`)
  }
  if (!result.shellGuarded) {
    throw new Error(`${label} would paint the SEO shell before React mounts`)
  }
  if (result.h2Count < 1) throw new Error(`${label} should name its content with at least one H2`)
  if (result.robots !== robots) throw new Error(`${label} has incorrect robots metadata`)
  if (!result.title || result.title === 'DeepSeek Harness Store') {
    throw new Error(`${label} is missing page-specific title metadata`)
  }
}

// The rankings view defaults to the 24h growth mode, which is legitimately
// empty until enough star-history snapshots exist (e.g. a freshly seeded local
// environment). Fall back to the stars mode so layout assertions can proceed.
async function waitForRankingList(page) {
  await page.locator('.ranking-section').waitFor()
  await page
    .locator('.ranking-section .package-list, .ranking-section .state-panel')
    .first()
    .waitFor()
  if ((await page.locator('.ranking-section .package-list').count()) === 0) {
    await page.locator('.ranking-section .segmented-control button').nth(1).click()
    await page.locator('.ranking-section .package-list').waitFor()
  }
}

async function assertLiveStats(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll('.hero-live-count')].every((node) => node.textContent !== '--'),
    undefined,
    { timeout: 10_000 },
  )
}

try {
  const defaultView = await openPage({ width: 1440, height: 1000 }, '/')
  await defaultView.locator('.ranking-section').waitFor()
  if (new URL(defaultView.url()).pathname !== '/') {
    throw new Error('root route changed the visible URL while rendering rankings')
  }
  await assertSeo(defaultView, 'default rankings', '/')
  await defaultView.close()

  const legacyCatalog = await openPage({ width: 1440, height: 1000 }, '/plugin?q=crosstalk')
  if (new URL(legacyCatalog.url()).pathname !== '/plugins' || new URL(legacyCatalog.url()).searchParams.get('q') !== 'crosstalk') {
    throw new Error('singular plugin route did not preserve its query while redirecting to /plugins')
  }
  await legacyCatalog.close()

  // 悬浮导航在每一页都在，且社区板块必须真的被渲染出来 —— 它和目录站
  // 共用一份 SPA fallback，路由分流一旦错了会静默地渲染成另一个板块。
  const shell = await openPage({ width: 1500, height: 900 }, '/community')
  await shell.locator('.community-head').waitFor()
  const destinations = await shell.locator('.floating-nav .floating-nav-item').evaluateAll(
    (links) => links.map((link) => link.getAttribute('href')),
  )
  if (JSON.stringify(destinations) !== JSON.stringify(['/', '/community', '/docs/api'])) {
    throw new Error(`floating nav destinations drifted: ${JSON.stringify(destinations)}`)
  }
  const activeHref = await shell.locator('.floating-nav-item.active').getAttribute('href')
  if (activeHref !== '/community') {
    throw new Error(`floating nav does not mark the open page: ${activeHref}`)
  }
  // 宽屏下它停在内容列左侧的余量里，不能压住内容。
  const clearance = await shell.evaluate(() => {
    const nav = document.querySelector('.floating-nav')?.getBoundingClientRect()
    const card = document.querySelector('.floating-wechat')?.getBoundingClientRect()
    const content = document.querySelector('.community')?.getBoundingClientRect()
    return nav && card && content ? {
      cardLeft: Math.round(card.left),
      cardTop: Math.round(card.top),
      cardWidth: Math.round(card.width),
      contentLeft: Math.round(content.left),
      expectedLeft: Math.round(Math.max(16, window.innerWidth / 2 - 744)),
      navBottom: Math.round(nav.bottom),
      navLeft: Math.round(nav.left),
      navRight: Math.round(nav.right),
      navWidth: Math.round(nav.width),
    } : null
  })
  if (
    !clearance
    || clearance.navRight > clearance.contentLeft
    || clearance.navLeft !== clearance.expectedLeft
    || clearance.cardLeft !== clearance.navLeft
    || clearance.cardWidth !== clearance.navWidth
    || clearance.cardTop < clearance.navBottom + 12
  ) {
    throw new Error(`the floating nav overlaps the content column: ${JSON.stringify(clearance)}`)
  }
  // 社区内部链接必须带板块前缀，否则会落到目录站的路由上。
  const strayLinks = await shell.locator('.post a[href^="/"]').evaluateAll(
    (links) => links.map((link) => link.getAttribute('href')).filter((href) => !href.startsWith('/community/')),
  )
  if (strayLinks.length > 0) {
    throw new Error(`community links missing the section prefix: ${JSON.stringify(strayLinks)}`)
  }
  // 切到另一个页面：不整页跳转，首页结构原样保留（hero 还在）。
  await shell.locator('.floating-nav-item[href="/"]').click()
  await shell.waitForURL(/\/$/)
  await shell.locator('.catalog-hero').waitFor()
  await assertNoHorizontalOverflow(shell, 'desktop shell after section switch')
  await shell.close()

  const mobileShell = await openPage({ width: 390, height: 844 }, '/community', { touch: true })
  await mobileShell.locator('.community-head').waitFor()
  await assertNoHorizontalOverflow(mobileShell, 'mobile community')
  await assertMinTouchTargets(mobileShell, 'mobile community actions', [
    '.floating-wechat', '.floating-nav-item', '.tab', '.post-action',
  ])
  // 窄屏下它收成左下角的横排胶囊，仍然常驻且不能撑破页面。
  const pill = await mobileShell.evaluate(() => {
    const nav = document.querySelector('.floating-nav')
    if (!nav) return null
    const box = nav.getBoundingClientRect()
    return { visible: box.width > 0, right: Math.round(box.right), viewport: window.innerWidth }
  })
  if (!pill || !pill.visible || pill.right > pill.viewport) {
    throw new Error(`the floating nav is missing or overflows on a phone: ${JSON.stringify(pill)}`)
  }
  await mobileShell.close()

  const compactCommunity = await openPage({ width: 320, height: 568 }, '/community', { touch: true })
  await compactCommunity.locator('.community-head').waitFor()
  await assertNoHorizontalOverflow(compactCommunity, 'compact community')
  await compactCommunity.close()

  const desktop = await openPage({ width: 1440, height: 1000 }, '/plugins')
  await desktop.locator('.directory-section .package-list').waitFor()
  if ((await desktop.locator('.ranking-section').count()) !== 0) {
    throw new Error('desktop catalog unexpectedly renders rankings')
  }
  if ((await desktop.locator('.directory-section .sort-segments button').count()) !== 5) {
    throw new Error('directory sort controls should contain stars, npm, installs, newest, and active')
  }
  if ((await desktop.getByRole('button', { name: 'npm榜', exact: true }).count()) !== 1) {
    throw new Error('directory npm sort does not use the compact npm榜 label')
  }
  if ((await desktop.locator('.catalog-hero .self-install-banner').count()) !== 1) {
    throw new Error('directory hero is missing the self install banner')
  }
  const desktopBannerText = await desktop.locator('.catalog-hero .self-install-banner').textContent()
  for (const command of [
    'npm install -g dsh1024 && dsh1024 plugin --profile web add dsh1024@latest',
    'dsh plugin --profile web add dsh1024@latest',
  ]) {
    if (!desktopBannerText?.includes(command)) {
      throw new Error(`directory self install banner is missing the command: ${command}`)
    }
  }
  await assertHeroCommandsAligned(desktop, 'desktop directory hero')
  await assertInstallCommandsReadable(desktop, 'desktop directory hero', '.catalog-hero')
  const chineseGeometry = await heroLanguageGeometry(desktop)
  await desktop.locator('.hero-language button').filter({ hasText: 'EN' }).click()
  await desktop.waitForFunction(() => document.documentElement.lang === 'en')
  const englishGeometry = await heroLanguageGeometry(desktop)
  await assertHeroCommandsAligned(desktop, 'English desktop directory hero')
  await assertInstallCommandsReadable(desktop, 'English desktop directory hero', '.catalog-hero')
  if (
    chineseGeometry.headingWidth !== englishGeometry.headingWidth
    || chineseGeometry.tallyWidth !== englishGeometry.tallyWidth
    || englishGeometry.actionRows !== 1
    || chineseGeometry.commandLines.some((lines) => lines !== 1)
    || englishGeometry.commandLines.some((lines) => lines !== 1)
    || chineseGeometry.commandWidths.some((width) => width < 520 || width > (chineseGeometry.bannerWidth ?? 0) - 200)
    || englishGeometry.commandWidths.some((width) => width < 520 || width > (englishGeometry.bannerWidth ?? 0) - 200)
  ) {
    throw new Error(`language switch changes the hero skeleton or crushes commands: ${JSON.stringify({ chineseGeometry, englishGeometry })}`)
  }
  if (!(await desktop.locator('.hero-link-exchange').textContent())?.includes('Open to link exchanges')) {
    throw new Error('English link exchange invitation uses the wrong copy')
  }
  await desktop.locator('.hero-language button').filter({ hasText: '中' }).click()
  await desktop.waitForFunction(() => document.documentElement.lang === 'zh-CN')
  if ((await desktop.locator('.directory-section .package-row .split-install-main').count()) === 0) {
    throw new Error('directory rows are missing the split install button')
  }
  await assertLiveStats(desktop)
  await assertSeo(desktop, 'desktop catalog', '/plugins')
  await assertNoHorizontalOverflow(desktop, 'desktop catalog')
  await assertVisibleSubdirectorySiblingsHaveDistinctTitles(desktop, 'desktop catalog')
  if (await desktop.locator('.hero-heading h1 a[href="https://deepseek1024.com/"]').getAttribute('aria-label') !== 'DeepSeek Harness Plugin 1024Store') {
    throw new Error('catalog hero does not show the linked DeepSeek Harness Plugin 1024Store title')
  }
  if (!(await desktop.locator('.hero-description').textContent())?.includes('收录插件均先经 DSH 插件规范检查与过滤')) {
    throw new Error('catalog hero does not keep the shared plugin screening description')
  }
  if (!/^\d+ (秒|分钟|小时|天)前更新$/.test((await desktop.locator('.hero-updated').textContent())?.trim() ?? '')) {
    throw new Error('catalog tally does not show a relative update time')
  }
  const heroAlignment = await desktop.evaluate(() => {
    const heading = document.querySelector('.hero-heading')?.getBoundingClientRect()
    const actions = document.querySelector('.hero-stage > .hero-actions')?.getBoundingClientRect()
    const hero = document.querySelector('.catalog-hero')?.getBoundingClientRect()
    const navigation = document.querySelector('.catalog-content > .catalog-navigation')?.getBoundingClientRect()
    return {
      actionsTop: actions?.top,
      headingTop: heading?.top,
      heroBottom: hero?.bottom,
      heroControlCount: document.querySelectorAll('.catalog-hero .catalog-toolbar, .catalog-hero .catalog-view-tabs').length,
      legacyToplineCount: document.querySelectorAll('.hero-topline').length,
      navigationTop: navigation?.top,
    }
  })
  if (
    heroAlignment.legacyToplineCount !== 0
    || heroAlignment.heroControlCount !== 0
    || heroAlignment.actionsTop === undefined
    || heroAlignment.headingTop === undefined
    || heroAlignment.heroBottom === undefined
    || heroAlignment.navigationTop === undefined
    || Math.abs(heroAlignment.actionsTop - heroAlignment.headingTop) > 1
    || heroAlignment.navigationTop < heroAlignment.heroBottom
  ) {
    throw new Error(`hero and catalog controls have incorrect structure: ${JSON.stringify(heroAlignment)}`)
  }
  await desktop.close()

  const rankings = await openPage({ width: 1440, height: 1000 }, '/rankings')
  await rankings.locator('.ranking-section').waitFor()
  await assertRepositorySeatDisclosure(rankings, 'desktop rankings')
  if ((await rankings.locator('.directory-section').count()) !== 0) {
    throw new Error('desktop rankings unexpectedly renders the directory')
  }
  if ((await rankings.locator('.ranking-section .segmented-control button').count()) !== 6) {
    throw new Error('rankings should expose install plus the five public activity modes')
  }
  if ((await rankings.getByRole('button', { name: 'npm榜', exact: true }).count()) !== 1) {
    throw new Error('rankings npm mode does not use the compact npm榜 label')
  }
  if (
    (await rankings.locator('.ranking-section > .section-title').count()) !== 0
    || await rankings.locator('#rankings-heading').getAttribute('class') !== 'visually-hidden'
    || (await rankings.locator('.ranking-mode-group > span').count()) !== 0
  ) {
    throw new Error('rankings still show the redundant list heading or GitHub activity label')
  }
  // The install-rankings group renders first in the DOM; the default mode is
  // the github group's 24h growth button, so assert that button directly.
  if (await rankings.getByRole('button', { name: '近 24 小时增速', exact: true }).getAttribute('aria-pressed') !== 'true') {
    throw new Error('rankings should default to the 24h growth mode')
  }
  if ((await rankings.locator('header a[href="https://www.deepseek.com/harness/"]').count()) !== 0) {
    throw new Error('official Harness link should not be rendered in the header')
  }
  if ((await rankings.locator('.site-bottom-link a[href="https://www.deepseek.com/harness/"]').count()) !== 1) {
    throw new Error('official Harness link is missing from the page bottom')
  }
  if (!(await rankings.locator('.site-bottom-link p').textContent())?.includes('DeepSeek')) {
    throw new Error('unofficial project notice is missing from the page bottom')
  }
  if ((await rankings.locator('.catalog-hero .github-link[href="https://github.com/imsai-sh/dsh1024-oss"]').count()) !== 1) {
    throw new Error('GitHub repository link is missing from the catalog banner')
  }
  if ((await rankings.locator('.catalog-hero .hero-author[href="https://www.imsai.cc/"][target="_blank"]').count()) !== 1) {
    throw new Error('author homepage link is missing from the catalog banner')
  }
  if ((await rankings.locator('.catalog-hero .hero-api').count()) !== 0) {
    throw new Error('catalog banner duplicates the API entry from the floating navigation')
  }
  if ((await rankings.locator('.floating-nav a[href="/docs/api"]').count()) !== 1) {
    throw new Error('floating navigation is missing the sole API entry')
  }
  if ((await rankings.locator('.catalog-hero .hero-wechat').count()) !== 0) {
    throw new Error('WeChat group entry should no longer be hidden in the catalog banner')
  }
  if ((await rankings.locator('.floating-wechat[href="/wechat-group.jpg"][target="_blank"]').count()) !== 1) {
    throw new Error('WeChat group QR floating card is missing')
  }
  if ((await rankings.locator('.floating-wechat-copy').textContent())?.trim() !== 'DSH插件社区') {
    throw new Error('WeChat group card must only say DSH插件社区')
  }
  if ((await rankings.locator('.floating-nav .floating-wechat').count()) !== 0) {
    throw new Error('WeChat group card is still nested inside navigation')
  }
  const desktopQr = await rankings.locator('.floating-wechat-qr').evaluate((node) => {
    const box = node.getBoundingClientRect()
    const image = node.querySelector('img')
    return {
      width: Math.round(box.width),
      height: Math.round(box.height),
      imageLoaded: Boolean(image?.complete && image.naturalWidth > 0),
      copyVisible: getComputedStyle(node.nextElementSibling).display !== 'none',
      borderRadius: getComputedStyle(node).borderRadius,
    }
  })
  if (
    desktopQr.width < 68
    || desktopQr.height !== desktopQr.width
    || !desktopQr.imageLoaded
    || !desktopQr.copyVisible
    || desktopQr.borderRadius !== '0px'
  ) {
    throw new Error(`WeChat QR floating card is not directly visible or scan-safe: ${JSON.stringify(desktopQr)}`)
  }
  const linkExchange = rankings.locator('.hero-link-exchange[href="https://www.imsai.cc/"][target="_blank"]')
  if ((await linkExchange.count()) !== 1 || !(await linkExchange.textContent())?.includes('欢迎互链')) {
    throw new Error('link exchange invitation is missing from the catalog hero')
  }
  if ((await rankings.locator('.catalog-hero .github-link span').textContent())?.trim() !== '插件市场开源') {
    throw new Error('market source action uses the wrong Chinese label')
  }
  const languageStyle = await rankings.locator('.catalog-hero .hero-language').evaluate((node) => {
    const selected = node.querySelector('button.selected')
    return {
      borderWidth: getComputedStyle(node).borderWidth,
      selectedBackground: selected ? getComputedStyle(selected).backgroundColor : null,
      switchBackground: getComputedStyle(node).backgroundColor,
    }
  })
  if (
    languageStyle.borderWidth !== '0px'
    || languageStyle.selectedBackground !== 'rgba(0, 0, 0, 0)'
    || languageStyle.switchBackground !== 'rgba(0, 0, 0, 0)'
  ) {
    throw new Error(`language switch is too visually prominent: ${JSON.stringify(languageStyle)}`)
  }
  if ((await rankings.locator('.catalog-hero .hero-submit[href="https://github.com/imsai-sh/awesome-deepseek-harness-plugins"][target="_blank"]').count()) !== 1) {
    throw new Error('submit button does not link to the GitHub repository')
  }
  if ((await rankings.locator('.catalog-hero .hero-brand').count()) !== 0) {
    throw new Error('removed top-left banner title is still rendered')
  }
  if ((await rankings.locator('.site-header').count()) !== 0) {
    throw new Error('the removed standalone site header is still rendered')
  }
  if (await rankings.locator('.hero-heading h1 a[href="https://deepseek1024.com/"]').getAttribute('aria-label') !== 'DeepSeek Harness Plugin 1024Store') {
    throw new Error('ranking hero does not keep the shared store title')
  }
  if (!(await rankings.locator('.hero-description').textContent())?.includes('收录插件均先经 DSH 插件规范检查与过滤')) {
    throw new Error('ranking hero does not keep the shared plugin screening description')
  }
  if ((await rankings.locator('.catalog-hero .hero-lockup-mark img[src="/deepseek1024.png"]').count()) !== 1) {
    throw new Error('hero poster mark is missing the store icon')
  }
  if ((await rankings.locator('footer, .reset-button').count()) !== 0) {
    throw new Error('removed footer or refresh control is still rendered')
  }
  if ((await rankings.locator('.catalog-hero .self-install-banner').count()) !== 1) {
    throw new Error('rankings hero is missing the self install banner')
  }
  const rankingsBannerText = await rankings.locator('.catalog-hero .self-install-banner').textContent()
  for (const command of [
    'npm install -g dsh1024 && dsh1024 plugin --profile web add dsh1024@latest',
    'dsh plugin --profile web add dsh1024@latest',
  ]) {
    if (!rankingsBannerText?.includes(command)) {
      throw new Error(`rankings self install banner is missing the command: ${command}`)
    }
  }
  await assertHeroCommandsAligned(rankings, 'desktop rankings hero')
  await assertInstallCommandsReadable(rankings, 'desktop rankings hero', '.catalog-hero')
  await assertSeo(rankings, 'desktop rankings', '/')
  await rankings.locator('.ranking-section .segmented-control button').last().click()
  await rankings.locator('.ranking-section .package-row').first().waitFor()
  // A repository row's expandable panel nests its sibling plugins as further
  // .package-row elements, so only top-level rows count toward the board size.
  const topLevelRankingRows = await rankings
    .locator('.ranking-section .package-row:not(.row-repo-panel .package-row)')
    .count()
  if (topLevelRankingRows !== 100) {
    throw new Error('GitHub activity rankings did not render the top 100 packages')
  }
  if ((await rankings.locator('.ranking-section .package-row .split-install-main').count()) === 0) {
    throw new Error('ranking rows are missing the split install button')
  }
  // A middle row is the interesting case: rows below it used to paint over the
  // menu back when it was anchored inside the row's stacking context.
  await rankings.locator('.ranking-section .package-row .split-install-toggle:visible').nth(4).click()
  await rankings.locator('.split-install-menu').waitFor()
  await assertMenuOnTop(rankings, 'desktop rankings split install menu')
  await assertNoHorizontalOverflow(rankings, 'desktop rankings with the install menu open')
  if ((await rankings.locator('.split-install-menu [role="menuitem"]').count()) !== 2) {
    throw new Error('split install menu does not expose exactly two command options')
  }
  // The first row may be the store's own catalog entry, whose menu shows the
  // dedicated `… add dsh1024` pair instead of the generic
  // owner/repository commands.
  const splitMenuText = await rankings.locator('.split-install-menu').textContent()
  // Two fixed options: the tracked wrapper and the official CLI. The row may be
  // the store's own entry, whose commands target dsh1024.
  for (const command of ['dsh1024 plugin --profile web add', 'dsh plugin --profile web add']) {
    if (!splitMenuText?.includes(command)) {
      throw new Error(`split install menu is missing an install command: ${command}`)
    }
  }
  // Commands must be fully readable: wide menu, wrapping instead of clipping.
  const clippedMenuCommands = await rankings
    .locator('.split-install-menu code')
    .evaluateAll((nodes) => nodes
      .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1)
      .map((node) => node.textContent ?? ''))
  if (clippedMenuCommands.length > 0) {
    throw new Error(`split install menu clips its commands: ${JSON.stringify(clippedMenuCommands)}`)
  }
  await rankings.keyboard.press('Escape')
  if ((await rankings.locator('.split-install-menu').count()) !== 0) {
    throw new Error('split install menu did not close on Escape')
  }
  if ((await rankings.locator('a[href^="/plugins/"]').count()) === 0) {
    throw new Error('catalog cards do not use the canonical plural plugins path')
  }
  // Search filters client-side from the cached catalog; no network round trip.
  await rankings.locator('input[type="search"]').fill('crosstalk')
  await rankings.waitForFunction(
    () => document.querySelectorAll('.ranking-section .package-row').length === 1,
    undefined,
    { timeout: 5_000 },
  )
  if ((await rankings.locator('.ranking-section .package-row').count()) !== 1) {
    throw new Error('ranking search did not filter the visible ranking')
  }
  await assertNoHorizontalOverflow(rankings, 'desktop rankings')
  await rankings.close()

  const mobile = await openPage({ width: 390, height: 844 }, '/plugins', { touch: true })
  await mobile.locator('.directory-section .package-list').waitFor()
  await assertLiveStats(mobile)

  // Regression guards for instant filtering: the directory renders
  // incrementally instead of mounting every plugin at once, and switching
  // filters derives from the cached catalog without another network request.
  let catalogRequests = 0
  mobile.on('request', (request) => {
    if (request.url().includes('/api/v1/plugins')) catalogRequests += 1
  })
  const initialRows = await mobile.locator('.directory-section .package-row').count()
  if (initialRows !== 100) {
    throw new Error(`directory mounted ${initialRows} rows at once; expected the first 100 rows`)
  }
  await mobile.locator('.load-more-row button').waitFor()
  await mobile.locator('.load-more-row button').scrollIntoViewIfNeeded()
  await mobile.waitForTimeout(500)
  if ((await mobile.locator('.directory-section .package-row').count()) !== initialRows) {
    throw new Error('directory loaded more rows automatically before the button was clicked')
  }
  await mobile.locator('.load-more-row button').click()
  await mobile.waitForFunction(
    (before) => document.querySelectorAll('.directory-section .package-row').length > before,
    initialRows,
    { timeout: 5_000 },
  )
  await mobile.locator('.category-filter button').nth(2).click()
  await mobile.waitForFunction(
    () => document.querySelectorAll('.category-filter button')[2]?.classList.contains('selected'),
    undefined,
    { timeout: 5_000 },
  )
  if (catalogRequests > 0) {
    throw new Error('filter interactions refetched the catalog; expected client-side derivation')
  }
  await mobile.locator('.category-filter button').first().click()
  await mobile.waitForURL((url) => !url.searchParams.has('category'))
  await assertMobileEnvironment(mobile, 'mobile catalog')
  await assertNoHorizontalOverflow(mobile, 'mobile catalog')
  await assertActionsWithinViewport(mobile, 'mobile catalog')
  await assertVisibleSubdirectorySiblingsHaveDistinctTitles(mobile, 'mobile catalog')
  await assertMinTouchTargets(mobile, 'mobile catalog', [
    '.floating-wechat',
    '.catalog-hero .hero-author',
    '.catalog-hero .github-link',
    '.catalog-hero .hero-submit',
    '.catalog-hero .hero-language button',
    '.catalog-hero .hero-link-exchange',
    '.catalog-view-tabs a',
    '.category-filter button',
    '.segmented-control button',
    '.self-install-banner .install-command .icon-button',
    '.package-row .split-install-main',
    '.package-row .split-install-toggle',
    '.package-row .row-link',
    '.load-more-row .button',
  ])
  await assertHeroCommandsAligned(mobile, 'mobile catalog hero')
  await assertInstallCommandsReadable(mobile, 'mobile catalog hero', '.catalog-hero')
  await assertMinFontSize(mobile, 'mobile search input', 'input[type="search"]', 16)
  await assertMinFontSize(mobile, 'mobile package title', '.row-title', 14)
  await assertMinFontSize(mobile, 'mobile package description', '.row-identity p', 12)
  await assertMinFontSize(mobile, 'mobile package metrics', '.row-metrics > span', 11)
  await assertMinFontSize(mobile, 'mobile hero description', '.hero-description', 14)
  await assertMinFontSize(mobile, 'mobile hero tally label', '.hero-tally-label', 11)
  await assertWrappedControls(mobile, 'mobile category filters', '.category-filter')
  await assertWrappedControls(mobile, 'mobile directory sort modes', '.sort-segments')

  await mobile.locator('.category-filter button').nth(1).click()
  await mobile.waitForURL((url) => url.searchParams.has('category'))
  await mobile.locator('.category-filter button').first().click()
  await mobile.waitForURL((url) => !url.searchParams.has('category'))

  await mobile.locator('input[type="search"]').fill('crosstalk')
  await mobile.waitForURL((url) => url.searchParams.get('q') === 'crosstalk')
  await mobile.waitForFunction(
    () => document.querySelector('meta[name="robots"]')?.getAttribute('content') === 'noindex,follow',
    undefined,
    { timeout: 5_000 },
  )
  await assertSeo(mobile, 'filtered mobile catalog', null, 'noindex,follow')
  // The URL and the robots meta flip a render before the filtered list does, so
  // counting rows immediately races the re-render rather than testing the search.
  await mobile.locator('.directory-section .package-row').first().waitFor({ timeout: 10_000 })
    .catch(() => { throw new Error('search returned no package rows') })
  await mobile.locator('.directory-section .package-row .split-install-main:visible').first().click()
  await mobile.locator('.directory-section .package-row .split-install-main[aria-label="已复制"]').waitFor()
  // The filtered list is short, so this is the first row; the portal assertion
  // below still proves nothing paints over the menu.
  await mobile.locator('.directory-section .package-row .split-install-toggle:visible').first().click()
  await mobile.locator('.split-install-menu').waitFor()
  await assertMenuOnTop(mobile, 'mobile split install menu')
  if ((await mobile.locator('.split-install-menu [role="menuitem"]').count()) !== 2) {
    throw new Error('mobile split install menu does not expose exactly two command options')
  }
  await assertMinTouchTargets(mobile, 'mobile split install menu', ['.split-install-menu [role="menuitem"]'])
  await assertNoHorizontalOverflow(mobile, 'mobile catalog with the install menu open')
  await mobile.keyboard.press('Escape')
  if ((await mobile.locator('.split-install-menu').count()) !== 0) {
    throw new Error('mobile split install menu did not close on Escape')
  }
  await mobile.locator('.catalog-hero .language-switch button').last().click()
  await mobile.waitForFunction(() => document.documentElement.lang === 'en')
  await assertNoHorizontalOverflow(mobile, 'English mobile catalog')
  await mobile.locator('.catalog-hero .language-switch button').first().click()
  await mobile.waitForFunction(() => document.documentElement.lang === 'zh-CN')

  // The visual row is also the primary mobile navigation target. Exercise a
  // point in its padding, away from the title link and copy button, so this
  // fails if only those small controls are clickable.
  const firstMobileRow = mobile.locator('.directory-section .package-row').first()
  const firstMobileDetailPath = await firstMobileRow.locator('.row-link').getAttribute('href')
  if (!firstMobileDetailPath) throw new Error('mobile package row is missing its detail path')
  const detailPopupPromise = mobile.waitForEvent('popup')
  await firstMobileRow.click({ position: { x: 8, y: 8 } })
  const detailPopup = await detailPopupPromise
  await detailPopup.waitForLoadState('domcontentloaded')
  if (new URL(detailPopup.url()).pathname !== firstMobileDetailPath) {
    throw new Error(`mobile package row opened the wrong detail page: ${detailPopup.url()}`)
  }
  await detailPopup.close()
  await mobile.close()

  const mobileRankings = await openPage({ width: 390, height: 844 }, '/rankings', { touch: true })
  await waitForRankingList(mobileRankings)
  await assertMobileEnvironment(mobileRankings, 'mobile rankings')
  await assertNoHorizontalOverflow(mobileRankings, 'mobile rankings')
  await assertMinTouchTargets(mobileRankings, 'mobile rankings', [
    '.floating-wechat',
    '.catalog-view-tabs a',
    '.segmented-control button',
    '.package-row .row-link',
    // Small on purpose so it does not shout over the plugin name; its hit area
    // is grown separately, and that is what this guards.
    '.package-row .row-repo-toggle',
  ])
  await assertRepositorySeatDisclosure(mobileRankings, 'mobile rankings', { touchTargets: true })
  await assertHorizontalTouchScroller(
    mobileRankings,
    'mobile GitHub ranking modes',
    '.ranking-mode-group:last-child .segmented-control',
    // Five short modes fit within 390px; the scroller only engages when they overflow.
    { requireOverflow: false },
  )
  await mobileRankings.locator('.ranking-section .segmented-control button').last().click()
  if (await mobileRankings.locator('.ranking-section .segmented-control button').last().getAttribute('aria-pressed') !== 'true') {
    throw new Error('mobile ranking controls could not select an offscreen mode')
  }
  await mobileRankings.close()

  const apiDocs = await openPage({ width: 1440, height: 900 }, '/docs/api')
  await apiDocs.locator('.api-docs-contact').waitFor()
  if ((await apiDocs.locator('.api-docs-contact-link[href="https://www.imsai.cc/"][target="_blank"]').count()) !== 1) {
    throw new Error('API docs author contact does not link to imsai.cc in a new tab')
  }
  if ((await apiDocs.locator('.api-docs-header + .api-docs-contact').count()) !== 1) {
    throw new Error('API docs author contact is not the first section below the page introduction')
  }
  await assertSeo(apiDocs, 'desktop API docs', '/docs/api')
  await assertNoHorizontalOverflow(apiDocs, 'desktop API docs')
  await apiDocs.close()

  const mobileApiDocs = await openPage({ width: 390, height: 844 }, '/docs/api', { touch: true })
  await mobileApiDocs.locator('.api-docs-contact').waitFor()
  await assertMobileEnvironment(mobileApiDocs, 'mobile API docs')
  await assertNoHorizontalOverflow(mobileApiDocs, 'mobile API docs')
  await assertMinTouchTargets(mobileApiDocs, 'mobile API docs', [
    '.detail-brand',
    '.detail-utility .language-switch button',
    '.api-docs-key-button',
    '.api-docs-contact-link',
  ])
  await assertMinFontSize(mobileApiDocs, 'mobile API contact copy', '.api-docs-contact p', 13)
  await mobileApiDocs.close()

  const compactApiDocs = await openPage({ width: 320, height: 568 }, '/docs/api', { touch: true })
  await compactApiDocs.locator('.api-docs-contact').waitFor()
  await assertNoHorizontalOverflow(compactApiDocs, 'compact mobile API docs')
  await compactApiDocs.close()

  const detail = await openPage({ width: 1440, height: 1000 }, '/plugins/openma-ai/deepseek-harness-tui')
  await detail.locator('.detail-header').waitFor()
  await detail.locator('.install-activity-section').waitFor()
  const detailInstallCommands = await detail.locator('.install-section .install-command code:visible').allTextContents()
  // The store installs from npm only: both commands target the published npm
  // package, and no visible command may carry a github: source spec.
  if (!detailInstallCommands.some((text) => /^dsh plugin --profile web add (?!github:)\S/.test(text.trim()))) {
    throw new Error('detail page is missing the bare official npm install command')
  }
  if (!detailInstallCommands.some((text) => /^dsh1024 plugin --profile web add (?!github:)\S/.test(text.trim()))) {
    throw new Error('detail page is missing the tracked dsh1024 npm install command')
  }
  if (detailInstallCommands.some((text) => text.includes('add github:'))) {
    throw new Error('detail page still renders a github source install command')
  }
  if (detailInstallCommands.some((text) => text.includes('@dsh-1024store/cli'))) {
    throw new Error('detail page still renders the legacy @dsh-1024store/cli command')
  }
  // main ships the verification badges without any assertion; pin their shape
  // and the states' copy so a wording change cannot silently drop them. The
  // build-allowance badge died with source installs and may not reappear.
  const methodCount = await detail.locator('.install-section .install-method').count()
  if (methodCount > 0) {
    const badges = await detail.locator('.install-section .install-method .install-badge').allTextContents()
    if (badges.length === 0) throw new Error('install methods render without a verification badge')
    const known = ['已验证', '未验证', '检查中']
    const unknownBadge = badges.find((text) => !known.includes(text.trim()))
    if (unknownBadge !== undefined) {
      throw new Error(`unexpected install verification badge: ${JSON.stringify(unknownBadge)}`)
    }
    // Every method carries both ways to run it, not just the official one.
    for (const selector of ['.install-option-recommended', '.install-option-official']) {
      const rows = await detail.locator(`.install-section .install-method ${selector}`).count()
      if (rows !== methodCount) {
        throw new Error(`each install method needs one ${selector}; saw ${rows} for ${methodCount} methods`)
      }
    }
  }
  await assertInstallCommandsReadable(detail, 'desktop detail', '.install-options')
  await assertSeo(detail, 'desktop detail', '/plugins/openma-ai/deepseek-harness-tui')
  await assertNoHorizontalOverflow(detail, 'desktop detail')
  await detail.locator('.detail-brand').click()
  await detail.waitForURL((url) => url.pathname === '/')
  await detail.locator('.ranking-section').waitFor()
  await detail.close()

  // npm-only regression: a plugin without a published npm package is
  // browse-only — its detail page shows the unavailable note and repository
  // link, never an install command. The plugin is picked from the live local
  // registry so the assertion survives catalog drift.
  const registryResponse = await fetch(`${baseUrl}/api/v1/registry`)
  if (!registryResponse.ok) throw new Error(`registry API answered ${registryResponse.status}`)
  const registryData = await registryResponse.json()
  const browseOnly = registryData.plugins.find(
    (plugin) => plugin.target?.startsWith('github:') && plugin.id.split('/').length === 2,
  )
  if (browseOnly === undefined) throw new Error('local registry has no browse-only plugin to check')
  const unavailable = await openPage({ width: 1440, height: 1000 }, `/plugins/${browseOnly.id}`)
  await unavailable.locator('.detail-header').waitFor()
  await unavailable.locator('.install-section .install-unavailable').waitFor()
  if ((await unavailable.locator('.install-section .install-command').count()) !== 0) {
    throw new Error(`browse-only plugin ${browseOnly.id} still renders an install command`)
  }
  if ((await unavailable.locator('.install-section .install-unavailable a').count()) === 0) {
    throw new Error('browse-only install note is missing its repository link')
  }
  const unavailableText = await unavailable.locator('.install-section').textContent()
  if (unavailableText?.includes('add github:')) {
    throw new Error('browse-only install section leaks a github source command')
  }
  await assertNoHorizontalOverflow(unavailable, 'browse-only detail')
  await unavailable.close()

  // The store's own catalog entry must show the dedicated dsh1024 commands,
  // never a generic "install the whole monorepo" command.
  const selfDetail = await openPage({ width: 1440, height: 1000 }, '/plugins/imsai-sh/awesome-deepseek-harness-plugins')
  await selfDetail.locator('.detail-header').waitFor()
  const selfInstallCommands = await selfDetail.locator('.install-section .install-command code:visible').allTextContents()
  if (!selfInstallCommands.some((text) => text.includes('npm install -g dsh1024 && dsh1024 plugin --profile web add dsh1024@latest'))) {
    throw new Error('self entry detail page is missing the global dsh1024 store install command')
  }
  if (selfInstallCommands.some((text) => text.includes('add imsai-sh/awesome-deepseek-harness-plugins') || text.includes('add github:imsai-sh/awesome-deepseek-harness-plugins'))) {
    throw new Error('self entry detail page renders a generic monorepo install command')
  }
  await selfDetail.close()

  const scoped = await openPage({ width: 390, height: 844 }, '/plugins/zhaoolee/notes', { touch: true })
  await scoped.locator('.detail-header').waitFor()
  await assertMobileEnvironment(scoped, 'mobile package detail')
  await assertNoHorizontalOverflow(scoped, 'scoped package detail')
  await assertMinTouchTargets(scoped, 'mobile package detail', [
    '.detail-brand',
    '.detail-utility .language-switch button',
    '.back-link',
    '.detail-actions .button',
    '.install-options .icon-button',
    '.site-bottom-link a',
  ])
  // Entered by direct URL, so nothing on this site preceded it: the control has
  // to stay a real link to the catalog rather than a dead history step.
  const backControl = await scoped.locator('.back-link').evaluate((node) => ({
    href: node.getAttribute('href'),
    tag: node.tagName,
  }))
  if (backControl.tag !== 'A' || backControl.href !== '/plugins') {
    throw new Error(`directly opened detail page has no catalog fallback: ${JSON.stringify(backControl)}`)
  }
  await assertMinFontSize(scoped, 'mobile detail prose', '.detail-description', 15)
  await assertMinFontSize(scoped, 'mobile README prose', '.markdown-body', 15)
  await assertMinFontSize(scoped, 'mobile package facts', '.package-facts dd', 13)
  const detailOrder = await scoped.evaluate(() => ({
    install: document.querySelector('.install-section')?.getBoundingClientRect().top,
    installActivity: document.querySelector('.install-activity-section')?.getBoundingClientRect().top,
    primary: document.querySelector('.detail-primary')?.getBoundingClientRect().top,
    readme: document.querySelector('.readme-section')?.getBoundingClientRect().top,
    sidebar: document.querySelector('.package-sidebar')?.getBoundingClientRect().top,
  }))
  if (
    detailOrder.install === undefined
    || detailOrder.installActivity === undefined
    || detailOrder.primary === undefined
    || detailOrder.sidebar === undefined
    || detailOrder.readme === undefined
    || !(
      detailOrder.primary <= detailOrder.install
      && detailOrder.install < detailOrder.installActivity
      && detailOrder.installActivity < detailOrder.sidebar
      && detailOrder.sidebar < detailOrder.readme
    )
  ) {
    throw new Error(`mobile detail content priority is incorrect: ${JSON.stringify(detailOrder)}`)
  }
  await assertInstallCommandsReadable(scoped, 'mobile package detail', '.install-options')
  await scoped.locator('.install-command-prominent .icon-button').click()
  await scoped.locator('.install-command-prominent .icon-button[aria-label="已复制"]').waitFor()
  await scoped.locator('.detail-brand').click()
  await scoped.waitForURL((url) => url.pathname === '/')
  await scoped.locator('.ranking-section').waitFor()
  await scoped.close()

  const compactDirectory = await openPage({ width: 320, height: 568 }, '/plugins', { touch: true })
  await compactDirectory.locator('.directory-section .package-list').waitFor()
  await assertWrappedControls(compactDirectory, 'compact directory sort modes', '.sort-segments')
  await assertNoHorizontalOverflow(compactDirectory, 'compact mobile directory')
  await compactDirectory.close()

  const compactMobile = await openPage({ width: 320, height: 568 }, '/rankings', { touch: true })
  await waitForRankingList(compactMobile)
  await assertNoHorizontalOverflow(compactMobile, 'compact mobile rankings')
  await assertActionsWithinViewport(compactMobile, 'compact mobile rankings')
  if (await compactMobile.locator('.catalog-hero .hero-language').isVisible()) {
    throw new Error('compact mobile header did not hide the secondary language control')
  }
  await assertMinTouchTargets(compactMobile, 'compact mobile header', [
    '.floating-wechat',
    '.catalog-hero .hero-author',
    '.catalog-hero .github-link',
    '.catalog-hero .hero-submit',
    '.catalog-hero .hero-link-exchange',
    '.catalog-view-tabs a',
    '.self-install-banner .install-command .icon-button',
    '.package-row .split-install-main',
    '.package-row .split-install-toggle',
    '.package-row .row-link',
  ])
  await assertHeroCommandsAligned(compactMobile, 'compact mobile hero')
  await assertInstallCommandsReadable(compactMobile, 'compact mobile hero', '.catalog-hero')
  await compactMobile.locator('.ranking-section .package-row .split-install-toggle:visible').nth(3).click()
  await compactMobile.locator('.split-install-menu').waitFor()
  await assertMenuOnTop(compactMobile, 'compact split install menu')
  if ((await compactMobile.locator('.split-install-menu [role="menuitem"]').count()) !== 2) {
    throw new Error('compact split install menu does not expose exactly two command options')
  }
  await assertMinTouchTargets(compactMobile, 'compact split install menu', ['.split-install-menu [role="menuitem"]'])
  await assertNoHorizontalOverflow(compactMobile, 'compact mobile rankings with the install menu open')
  await compactMobile.keyboard.press('Escape')
  if ((await compactMobile.locator('.split-install-menu').count()) !== 0) {
    throw new Error('compact split install menu did not close on Escape')
  }
  await compactMobile.close()

  // 看板娘（桌宠）回归：固定在视口内不越界、触屏按钮 ≥44px、
  // 投喂 → 气泡、玩耍 → 气泡。鲸鱼娘常驻（无隐藏入口）。
  // 看板娘带持续 3D 摆动动画，Playwright 的稳定检查会一直等，交互统一用 force。
  const pet = await openPage({ width: 390, height: 844 }, '/rankings', { touch: true })
  await waitForRankingList(pet)
  await pet.locator('.kanban-girl').waitFor()
  const petBounds = await pet.evaluate(() => {
    const rect = document.querySelector('.kanban-girl')?.getBoundingClientRect()
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } : null
  })
  if (
    !petBounds
    || petBounds.left < 0
    || petBounds.top < 0
    || petBounds.right > 390
    || petBounds.bottom > 844
  ) {
    throw new Error(`mobile kanban girl leaves the viewport: ${JSON.stringify(petBounds)}`)
  }
  await pet.locator('.kanban-girl').tap({ force: true })
  await pet.locator('.kanban-girl-menu .kanban-girl-action').first().waitFor()
  await assertMinTouchTargets(pet, 'mobile kanban girl actions', [
    '.kanban-girl-menu .kanban-girl-action',
  ])
  await pet.locator('.kanban-girl-menu .kanban-girl-action').first().tap({ force: true })
  await pet.locator('.kanban-girl-bubble').waitFor()
  await pet.locator('.kanban-girl-menu .kanban-girl-action').nth(1).tap({ force: true })
  await pet.locator('.kanban-girl-bubble').waitFor()
  await pet.close()

  if (errors.length > 0) throw new Error(`browser errors:\n${errors.join('\n')}`)
  console.log('Visual smoke check passed: floating nav, community section, desktop, touch-enabled 390px mobile, compact 320px mobile, search, split install menus, self install banner, copy actions, local scrollers, and package details.')
} finally {
  await desktopContext.close()
  await mobileContext.close()
  await browser.close()
}
