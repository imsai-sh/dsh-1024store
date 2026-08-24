import { useEffect, useState } from 'react'
import { LogOut, ScrollText } from 'lucide-react'
import { Link, Outlet } from 'react-router-dom'
import { LanguageSwitch } from '../../components/LanguageSwitch'
import { GitHubSignInButton } from '../../components/GitHubSignInButton'
import { useI18n } from '../../lib/i18n'
import { startSignIn, useSession } from '../lib/session'
import { Avatar } from './Avatar'
import { communityRules, profilePath } from '../lib/paths'

/**
 * The community section's own frame.
 *
 * Site-level navigation, branding and the footer belong to the site shell; what
 * is left here is what only this section has — who you are signed in as, and the
 * activity rail.
 */

function ViewerChip() {
  const { t } = useI18n()
  const { viewer, loading, signOut } = useSession()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  if (loading) return <span className="viewer-placeholder" aria-hidden="true" />
  if (!viewer) {
    return (
      <GitHubSignInButton onClick={startSignIn} className="is-compact" />
    )
  }

  return (
    <div className="viewer" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="viewer-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar login={viewer.login} src={viewer.avatarUrl} size={28} />
        <span className="viewer-login">@{viewer.login}</span>
      </button>
      {open ? (
        <div className="viewer-menu" role="menu">
          <Link to={profilePath(viewer.login)} role="menuitem" onClick={() => setOpen(false)}>
            {viewer.login}{t('postsBy')}
          </Link>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); void signOut() }}>
            <LogOut size={14} aria-hidden="true" />
            {t('signOut')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 右栏：社区规则摘要。
 *
 * 这里原来是帖子数 / 发言者 / 今日新帖。空社区里那三个 0 只是在反复强调
 * 没人；有人之后它们也不影响任何人的下一步动作。规则不一样——新来的人
 * 发第一条之前真正需要知道的就是这几条。
 *
 * 顺带少了一次挂载时的 /stats 请求。
 */
function RulesRail() {
  const { t, language } = useI18n()
  const rules = RAIL_RULES[language]

  return (
    <section className="rail-card">
      <h2 className="rail-title">
        <ScrollText size={14} aria-hidden="true" />
        {t('guidelines')}
      </h2>
      <ul className="rail-rules">
        {rules.map((rule) => <li key={rule}>{rule}</li>)}
      </ul>
      <Link className="rail-link" to={communityRules}>{t('readAllRules')}</Link>
    </section>
  )
}

const RAIL_RULES = {
  zh: [
    '用 GitHub 账号登录就能发言，不需要另外注册。',
    '只发文字，支持 Markdown。',
    '写 @owner/name 会自动带出插件卡片。',
    '广告、人身攻击、与 DeepSeek Harness 无关的内容会被删除。',
  ],
  en: [
    'Sign in with GitHub and you can post. No separate account.',
    'Text only, Markdown supported.',
    'Write @owner/name to pull in a plugin card.',
    'Ads, personal attacks, and off-topic posts get removed.',
  ],
} as const

export function CommunityLayout() {
  const { t } = useI18n()

  // 站点其它页面一律不碰滚动位置。这里原来有一个 window.scrollTo({top:0})，
  // 它在 React 画完之后才跑：浏览器先按旧滚动位置画一帧，再跳到顶，切进
  // 社区时就会看见明显的一抖。要改滚动行为得全站一起改，不能只有一页特殊。

  return (
    <div className="community">
      <header className="community-head">
        <div>
          <h1>{t('siteName')}</h1>
          <p>{t('tagline')}</p>
        </div>
        <div className="community-head-actions">
          <LanguageSwitch />
          <ViewerChip />
        </div>
      </header>

      <div className="community-body">
        <div className="community-main">
          <Outlet />
        </div>
        <aside className="community-rail" aria-label={t('guidelines')}>
          <RulesRail />
        </aside>
      </div>
    </div>
  )
}
