import { useState } from 'react'
import { Heart, Link2, MessageCircle, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, RequestFailed, type Post } from '../lib/api'
import { useI18n, useRelativeTime } from '../../lib/i18n'
import { startSignIn, useSession } from '../lib/session'
import { Avatar } from './Avatar'
import { PluginCard } from './PluginCard'
import { PostBody } from './PostBody'
import { postPath, profilePath } from '../lib/paths'

interface PostCardProps {
  post: Post
  /** A thread's root post gets the larger treatment and no "open" affordance. */
  variant?: 'feed' | 'detail' | 'reply'
  onChange: (post: Post) => void
  onRemoved: (id: number) => void
}

export function PostCard({ post, variant = 'feed', onChange, onRemoved }: PostCardProps) {
  const { t } = useI18n()
  const relative = useRelativeTime()
  const { viewer } = useSession()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  const deleted = post.body === null

  async function toggleLike() {
    if (!viewer) return startSignIn()
    if (busy) return
    setBusy(true)
    // Optimistic: the count is the only thing that moves, and a failure puts it
    // straight back. Waiting for a round trip to fill a heart feels broken.
    const next = { ...post, liked: !post.liked, likeCount: post.likeCount + (post.liked ? -1 : 1) }
    onChange(next)
    try {
      const result = await api.setLike(post.id, !post.liked)
      onChange({ ...post, liked: result.liked, likeCount: result.likeCount })
    } catch (failure) {
      onChange(post)
      if (failure instanceof RequestFailed && failure.status === 401) startSignIn()
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}${postPath(post.replyToId ?? post.id)}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      window.prompt('', url)
    }
  }

  async function remove() {
    if (!window.confirm(t('removeConfirm'))) return
    setBusy(true)
    try {
      await api.remove(post.id)
      onRemoved(post.id)
    } catch (failure) {
      // Silently leaving the post on screen reads as "the button is broken".
      window.alert(failure instanceof RequestFailed ? failure.payload.error : t('loadError'))
    } finally {
      setBusy(false)
    }
  }

  const timestamp = (
    <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
      {relative(post.createdAt)}
    </time>
  )

  return (
    <article className={`post post-${variant}${deleted ? ' is-deleted' : ''}`}>
      <Link className="post-avatar" to={profilePath(post.author.login)} aria-label={post.author.login}>
        <Avatar login={post.author.login} src={post.author.avatarUrl} size={variant === 'reply' ? 32 : 40} />
      </Link>

      <div className="post-main">
        <header className="post-head">
          <Link className="post-author" to={profilePath(post.author.login)}>
            {post.author.name ?? post.author.login}
          </Link>
          <span className="post-login">@{post.author.login}</span>
          <span className="post-dot" aria-hidden="true">·</span>
          {variant === 'feed'
            ? <Link className="post-time" to={postPath(post.id)}>{timestamp}</Link>
            : <span className="post-time">{timestamp}</span>}
        </header>

        {deleted
          ? <p className="post-deleted">{t('deletedBody')}</p>
          : <PostBody body={post.body!} />}

        {post.plugins.length > 0 ? (
          <div className="post-plugins">
            {post.plugins.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} />)}
          </div>
        ) : null}

        {deleted ? null : (
          <footer className="post-actions">
            <button
              type="button"
              className={post.liked ? 'post-action is-active' : 'post-action'}
              onClick={toggleLike}
              aria-pressed={post.liked}
              aria-label={t(post.liked ? 'liked' : 'like')}
            >
              <Heart size={16} aria-hidden="true" fill={post.liked ? 'currentColor' : 'none'} />
              {post.likeCount > 0 ? <span>{post.likeCount}</span> : null}
            </button>

            {post.replyToId === null ? (
              <Link className="post-action" to={postPath(post.id)} aria-label={t('reply')}>
                <MessageCircle size={16} aria-hidden="true" />
                {post.replyCount > 0 ? <span>{post.replyCount}</span> : null}
              </Link>
            ) : null}

            <button
              type="button"
              className="post-action"
              onClick={copyLink}
              /* The label is hidden on narrow screens, so the name has to live
                 on the button itself or the control is unreachable there. */
              aria-label={t(copied ? 'shared' : 'share')}
            >
              <Link2 size={16} aria-hidden="true" />
              <span className="post-action-label">{t(copied ? 'shared' : 'share')}</span>
            </button>

            {post.deletable ? (
              <button
                type="button"
                className="post-action post-action-danger"
                onClick={remove}
                disabled={busy}
                aria-label={t('remove')}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            ) : null}
          </footer>
        )}
      </div>
    </article>
  )
}
