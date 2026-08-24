import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n } from '../../lib/i18n'
import { communityHome } from '../lib/paths'

const RULES = {
  zh: [
    '用 GitHub 账号登录就能发言，不需要另外注册，也没有等级和积分。',
    '只发文字。第一版不支持图片和视频——先把话说清楚。',
    '正文里写 @owner/name，或者贴插件详情页链接，会自动带出一张插件卡片。写不存在的插件不会有卡片。',
    '你可以随时删掉自己发的内容。',
    '发帖有频率限制（每分钟 5 条、每天 50 条），评论和点赞另有额度。这是防灌水，不是防你。',
    '广告、人身攻击、与 DeepSeek Harness 无关的内容会被删除。',
  ],
  en: [
    'Sign in with GitHub and you can post. No separate account, no levels, no karma.',
    'Text only. The first version has no images or video — say it in words.',
    'Write @owner/name, or paste a link to a plugin page, and a plugin card appears. Mentioning something that is not in the catalog just stays text.',
    'You can delete anything you posted, at any time.',
    'Posting is rate limited (5 a minute, 50 a day), with separate allowances for comments and likes. That is for spam, not for you.',
    'Ads, personal attacks, and things unrelated to DeepSeek Harness get removed.',
  ],
} as const

export function AboutPage() {
  const { t, language } = useI18n()
  return (
    <>
      <Link className="back-link" to={communityHome}>
        <ArrowLeft size={15} aria-hidden="true" />
        {t('backToFeed')}
      </Link>
      <article className="prose">
        <h1>{t('aboutTitle')}</h1>
        <p>{t('tagline')}</p>
        <ol>
          {RULES[language].map((rule) => <li key={rule}>{rule}</li>)}
        </ol>
        <p className="prose-note">{t('unofficialNotice')}</p>
      </article>
    </>
  )
}
