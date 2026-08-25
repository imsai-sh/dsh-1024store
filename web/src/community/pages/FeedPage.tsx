import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type FeedTab } from '../lib/api'
import { useI18n } from '../../lib/i18n'
import { useFeed } from '../lib/useFeed'
import { Composer } from '../components/Composer'
import { PostCard } from '../components/PostCard'
import { FeedStatus } from '../components/FeedStatus'
import { MAX_POST_LENGTH } from '../../../worker/community/post-body'

const TABS: FeedTab[] = ['latest', 'hot']

export function FeedPage() {
  const { t } = useI18n()
  const [params, setParams] = useSearchParams()
  const tab: FeedTab = params.get('tab') === 'hot' ? 'hot' : 'latest'

  const load = useCallback(
    (cursor: string | null) => api.feed(tab, cursor),
    [tab],
  )
  const feed = useFeed(load, tab)

  return (
    <>
      <div className="tabs" role="tablist" aria-label={t('siteName')}>
        {TABS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={tab === option ? 'tab is-active' : 'tab'}
            onClick={() => setParams(option === 'latest' ? {} : { tab: option }, { replace: true })}
          >
            {t(option)}
          </button>
        ))}
      </div>

      <Composer
        maxLength={MAX_POST_LENGTH}
        placeholderKey="composerPlaceholder"
        submitLabelKey="publish"
        onSubmit={(body) => api.publish(body)}
        onPublished={feed.prepend}
      />

      <FeedStatus feed={feed} emptyKey="emptyFeed">
        {feed.posts.map((post) => (
          <PostCard key={post.id} post={post} onChange={feed.replace} onRemoved={feed.remove} />
        ))}
      </FeedStatus>
    </>
  )
}
