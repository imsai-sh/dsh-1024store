import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useI18n, type MessageKey } from '../../lib/i18n'
import type { useFeed } from '../lib/useFeed'

interface FeedStatusProps {
  feed: ReturnType<typeof useFeed>
  emptyKey: MessageKey
  children: ReactNode
}

/** Loading / empty / error / load-more, in one place so every list agrees. */
export function FeedStatus({ feed, emptyKey, children }: FeedStatusProps) {
  const { t } = useI18n()

  if (feed.status === 'loading') {
    return (
      <p className="feed-state">
        <Loader2 size={16} className="spin" aria-hidden="true" />
        {t('loading')}
      </p>
    )
  }

  if (feed.status === 'error') {
    return (
      <div className="feed-state">
        <p>{t('loadError')}</p>
        <button type="button" className="button-secondary" onClick={feed.reload}>{t('retry')}</button>
      </div>
    )
  }

  if (feed.posts.length === 0) return <p className="feed-state feed-empty">{t(emptyKey)}</p>

  return (
    <>
      <div className="feed">{children}</div>
      {feed.cursor !== null ? (
        <button
          type="button"
          className="button-secondary load-more"
          onClick={feed.loadMore}
          disabled={feed.loadingMore}
        >
          {feed.loadingMore ? t('loading') : t('loadMore')}
        </button>
      ) : null}
    </>
  )
}
