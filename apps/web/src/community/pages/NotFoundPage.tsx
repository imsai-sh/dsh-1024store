import { Link } from 'react-router-dom'
import { useI18n } from '../../lib/i18n'
import { communityHome } from '../lib/paths'

export function NotFoundPage() {
  const { t } = useI18n()
  return (
    <div className="feed-state">
      <p>{t('notFound')}</p>
      <Link className="button-secondary" to={communityHome}>{t('backToFeed')}</Link>
    </div>
  )
}
