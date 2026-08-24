import { useLayoutEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { RequestFailed, type Post } from '../lib/api'
import { GitHubSignInButton } from '../../components/GitHubSignInButton'
import { useI18n } from '../../lib/i18n'
import { useSession, startSignIn } from '../lib/session'
import { Avatar } from './Avatar'

interface ComposerProps {
  maxLength: number
  placeholderKey: 'composerPlaceholder' | 'replyPlaceholder'
  submitLabelKey: 'publish' | 'reply'
  onSubmit: (body: string) => Promise<Post>
  onPublished: (post: Post) => void
  autoFocus?: boolean
  compact?: boolean
}

export function Composer({
  maxLength,
  placeholderKey,
  submitLabelKey,
  onSubmit,
  onPublished,
  autoFocus = false,
  compact = false,
}: ComposerProps) {
  const { t } = useI18n()
  const { viewer, loading } = useSession()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  // Grow with the text instead of scrolling inside a fixed box: on a phone a
  // three-line box that scrolls internally hides what you just typed.
  //
  // Clearing the inline height first is what makes it shrink again, and it has
  // to be an empty string rather than `auto`: an empty box must be exactly as
  // tall as its `rows`, and measuring scrollHeight against any inline height
  // only ever ratchets upwards. Layout effect, so the measurement happens
  // before paint and the box never flashes at the wrong size.
  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = ''
    if (body.length === 0) return
    element.style.height = `${Math.min(element.scrollHeight, 360)}px`
  }, [body])

  // While the session request is still in flight the reader is not signed out,
  // they are unknown. Showing the sign-in prompt to somebody who is already
  // signed in, and then swapping it for a composer, is a worse flicker than a
  // blank space.
  if (loading) return <div className={compact ? 'composer composer-compact' : 'composer'} aria-busy="true" />

  if (!viewer) {
    return (
      <div className={compact ? 'composer composer-compact composer-signed-out' : 'composer composer-signed-out'}>
        {/* 顶层发帖框不写「登录后即可发言」——按钮自己就说清楚了。
            评论框保留一句，因为那里按钮离上下文更远。 */}
        {compact ? <p>{t('signInToReact')}</p> : null}
        <GitHubSignInButton onClick={startSignIn} />
      </div>
    )
  }

  const length = [...body].length
  const remaining = maxLength - length
  const empty = body.trim().length === 0

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (empty || remaining < 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      onPublished(await onSubmit(body))
      setBody('')
    } catch (failure) {
      setError(failure instanceof RequestFailed ? failure.payload.error : t('loadError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={compact ? 'composer composer-compact' : 'composer'} onSubmit={submit}>
      <Avatar login={viewer.login} src={viewer.avatarUrl} size={compact ? 32 : 40} />
      <div className="composer-main">
        <textarea
          ref={textarea}
          value={body}
          autoFocus={autoFocus}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t(placeholderKey)}
          rows={compact ? 1 : 2}
          aria-label={t(placeholderKey)}
        />
        {error ? <p className="composer-error" role="alert">{error}</p> : null}
        <div className="composer-actions">
          <span className={remaining < 0 ? 'composer-count is-over' : 'composer-count'}>
            {remaining < 0
              ? t('tooLong', { n: -remaining })
              : length > 0 ? t('charactersLeft', { n: remaining }) : ''}
          </span>
          <button type="submit" className="button-primary" disabled={empty || remaining < 0 || busy}>
            {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
            {busy ? t('publishing') : t(submitLabelKey)}
          </button>
        </div>
      </div>
    </form>
  )
}
