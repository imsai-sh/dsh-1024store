import { useCallback } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useI18n } from '../../lib/i18n'
import { useFeed } from '../lib/useFeed'
import { Avatar } from '../components/Avatar'
import { FeedStatus } from '../components/FeedStatus'
import { PostCard } from '../components/PostCard'
import { communityHome } from '../lib/paths'

export function UserPage() {
  const { t } = useI18n()
  const { login = '' } = useParams()
  const load = useCallback((cursor: string | null) => api.byAuthor(login, cursor), [login])
  const feed = useFeed(load, login)

  return (
    <>
      <Link className="back-link" to={communityHome}>
        <ArrowLeft size={15} aria-hidden="true" />
        {t('backToFeed')}
      </Link>

      <header className="profile">
        <Avatar login={login} size={56} />
        <div>
          <h1>@{login}</h1>
          <a href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noreferrer">
            github.com/{login}
          </a>
        </div>
      </header>

      <FeedStatus feed={feed} emptyKey="emptyAuthor">
        {feed.posts.map((post) => (
          <PostCard key={post.id} post={post} onChange={feed.replace} onRemoved={feed.remove} />
        ))}
      </FeedStatus>
    </>
  )
}
