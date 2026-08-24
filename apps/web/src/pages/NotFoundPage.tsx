import { ArrowLeft, SearchX } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { usePageSeo } from '../lib/usePageSeo'

export function NotFoundPage() {
  const { language, t } = useI18n()
  const { pathname } = useLocation()
  usePageSeo({
    title: language === 'zh' ? '页面未找到 | DSH 1024Store' : 'Page not found | DSH 1024Store',
    description: language === 'zh'
      ? '请求的页面不在 DeepSeek Harness 社区插件目录中。'
      : 'The requested page is not available in the DeepSeek Harness community plugin catalog.',
    path: pathname,
    language,
    robots: 'noindex,follow',
  })
  return (
    <div className="page-container standalone-state">
      <SearchX size={36} aria-hidden="true" />
      <h1>{t('notFound')}</h1>
      <p>{t('notFoundBody')}</p>
      <Link className="button button-primary" to="/plugins">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('back')}
      </Link>
    </div>
  )
}
