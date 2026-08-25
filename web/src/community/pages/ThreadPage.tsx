import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type Post, type ThreadResponse } from '../lib/api'
import { useI18n } from '../../lib/i18n'
import { Composer } from '../components/Composer'
import { PostCard } from '../components/PostCard'
import { MAX_REPLY_LENGTH } from '../../../worker/community/post-body'
import { communityHome } from '../lib/paths'

export function ThreadPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { id } = useParams()
  const postId = Number(id)
  const [thread, setThread] = useState<ThreadResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    if (!Number.isSafeInteger(postId) || postId <= 0) return setStatus('missing')
    let cancelled = false
    setStatus('loading')
    api.thread(postId)
      .then((next) => { if (!cancelled) { setThread(next); setStatus('ready') } })
      .catch(() => { if (!cancelled) setStatus('missing') })
    return () => { cancelled = true }
  }, [postId])

  const replaceReply = useCallback((post: Post) => {
    setThread((previous) => previous && {
      ...previous,
      replies: previous.replies.map((reply) => reply.id === post.id ? post : reply),
    })
  }, [])

  const removeReply = useCallback((replyId: number) => {
    setThread((previous) => previous && {
      ...previous,
      replies: previous.replies.filter((reply) => reply.id !== replyId),
      post: { ...previous.post, replyCount: Math.max(0, previous.post.replyCount - 1) },
    })
  }, [])

  if (status === 'loading') {
    return <p className="feed-state"><Loader2 size={16} className="spin" aria-hidden="true" />{t('loading')}</p>
  }
  if (status === 'missing' || !thread) {
    return (
      <div className="feed-state">
        <p>{t('notFound')}</p>
        <Link className="button-secondary" to={communityHome}>{t('backToFeed')}</Link>
      </div>
    )
  }

  return (
    <>
      <Link className="back-link" to={communityHome}>
        <ArrowLeft size={15} aria-hidden="true" />
        {t('backToFeed')}
      </Link>

      <div className="thread-root">
        <PostCard
          post={thread.post}
          variant="detail"
          /* Functional update, not `{ ...thread, post }`: `thread` here is the
             value from the render that created this callback, so liking the
             root while a reply is in flight would put the old reply list back. */
          onChange={(post) => setThread((previous) => previous && { ...previous, post })}
          onRemoved={() => navigate(communityHome)}
        />
      </div>

      <Composer
        compact
        maxLength={MAX_REPLY_LENGTH}
        placeholderKey="replyPlaceholder"
        submitLabelKey="reply"
        onSubmit={(body) => api.publish(body, thread.post.id)}
        onPublished={(reply) => setThread((previous) => previous && {
          ...previous,
          replies: [...previous.replies, reply],
          post: { ...previous.post, replyCount: previous.post.replyCount + 1 },
        })}
      />

      {thread.replies.length > 0 ? (
        <div className="feed thread-replies">
          {thread.replies.map((reply) => (
            <PostCard
              key={reply.id}
              post={reply}
              variant="reply"
              onChange={replaceReply}
              onRemoved={removeReply}
            />
          ))}
        </div>
      ) : null}
    </>
  )
}
