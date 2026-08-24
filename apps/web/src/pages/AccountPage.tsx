import { Check, Copy, KeyRound, LogOut } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LanguageSwitch } from '../components/LanguageSwitch'
import {
  API_ORIGIN,
  createApiKey,
  getApiKeys,
  getAuthUser,
  githubAvatar,
  githubLoginUrl,
  logoutUser,
  revokeApiKey,
  type ApiKeySummary,
  type AuthUser,
  type CreatedApiKey,
} from '../lib/api'
import { publicAsset } from '../lib/assets'
import { formatDateTime } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { collectionCopy, graph, simplePageNode, siteNodes } from '../../worker/seo-templates'
import { usePageSeo } from '../lib/usePageSeo'

type SessionState = { status: 'loading' } | { status: 'ready'; user: AuthUser | null }

export function AccountPage() {
  const { language, t } = useI18n()
  const { search } = useLocation()
  const loginFailed = new URLSearchParams(search).get('login') === 'error'

  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([])
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null)
  const [keyName, setKeyName] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copy = collectionCopy('account', language)

  usePageSeo({
    title: copy.title,
    description: copy.description,
    path: '/account',
    language,
    robots: 'noindex,follow',
    schema: graph([...siteNodes(), simplePageNode('/account', copy, language)]),
  })

  const reload = useCallback(async (signal?: AbortSignal) => {
    let user: AuthUser | null = null
    try {
      user = await getAuthUser(signal)
    } catch (error) {
      if (signal?.aborted) return
      setSession({ status: 'ready', user: null })
      setActionError(error instanceof Error ? error.message : String(error))
      return
    }
    setSession({ status: 'ready', user })
    if (!user) {
      setApiKeys([])
      return
    }
    // A key-list failure must not masquerade as a logged-out session.
    try {
      setApiKeys(await getApiKeys(signal))
    } catch (error) {
      if (signal?.aborted) return
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal)
    return () => controller.abort()
  }, [reload])

  async function handleCreateKey() {
    setBusy(true)
    setActionError(null)
    try {
      const created = await createApiKey(keyName)
      setNewKey(created)
      setKeyName('')
      setCopied(false)
      setApiKeys(await getApiKeys())
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(id: number) {
    setActionError(null)
    try {
      await revokeApiKey(id)
      if (newKey?.id === id) setNewKey(null)
      setApiKeys(await getApiKeys())
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleSignOut() {
    setActionError(null)
    try {
      await logoutUser()
      setSession({ status: 'ready', user: null })
      setApiKeys([])
      setNewKey(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be denied; the key stays selectable as text.
    }
  }

  return (
    <div className="page-container account-page">
      <div className="detail-utility">
        <Link className="detail-brand" to="/" aria-label="DeepSeek Harness Store homepage">
          <img className="brand-mark" src={publicAsset('deepseek1024-icon.png')} alt="" aria-hidden="true" />
          <span>DeepSeek Harness <strong>{t('market')}</strong></span>
        </Link>
        <LanguageSwitch />
      </div>

      <header className="account-header">
        <h1>{t('accountTitle')}</h1>
        <p>{t('accountIntro')}</p>
        <Link className="account-docs-link" to="/docs/api">{t('viewApiDocs')}</Link>
      </header>

      {loginFailed ? <p className="account-error" role="alert">{t('loginFailed')}</p> : null}
      {actionError ? <p className="account-error" role="alert">{actionError}</p> : null}

      {API_ORIGIN ? (
        <section className="account-signin">
          <p className="account-signin-note">{t('accountCrossOrigin')}</p>
          <a className="button button-primary" href={`${API_ORIGIN}/account`}>
            {t('accountTitle')}
          </a>
        </section>
      ) : session.status === 'loading' ? (
        <p className="account-loading">…</p>
      ) : session.user === null ? (
        <section className="account-signin">
          <a className="button button-primary account-github-button" href={githubLoginUrl('/account')}>
            <img src={publicAsset('github-mark.svg')} alt="" aria-hidden="true" />
            {t('signInWithGitHub')}
          </a>
          <p className="account-signin-note">{t('signInOnly')}</p>
        </section>
      ) : (
        <>
          <section className="account-profile">
            <img
              className="account-avatar"
              src={session.user.avatarUrl ?? githubAvatar(session.user.githubLogin)}
              alt=""
              aria-hidden="true"
            />
            <div className="account-identity">
              <p className="account-signed-in">{t('signedInAs')}</p>
              <p className="account-login">
                {session.user.githubName ?? session.user.githubLogin}
                <span>@{session.user.githubLogin}</span>
              </p>
            </div>
            <button type="button" className="button button-secondary" onClick={() => void handleSignOut()}>
              <LogOut size={16} aria-hidden="true" />
              {t('signOut')}
            </button>
          </section>

          <section className="account-keys">
            <h2>
              <KeyRound size={18} aria-hidden="true" />
              {t('apiKeysHeading')}
            </h2>
            <p className="account-keys-intro">{t('apiKeysIntro')}</p>

            <form
              className="account-key-create"
              onSubmit={(event) => {
                event.preventDefault()
                void handleCreateKey()
              }}
            >
              <input
                type="text"
                value={keyName}
                maxLength={100}
                placeholder={t('apiKeyNamePlaceholder')}
                onChange={(event) => setKeyName(event.target.value)}
                aria-label={t('apiKeyNamePlaceholder')}
              />
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? t('creating') : t('createApiKey')}
              </button>
            </form>

            {newKey ? (
              <div className="account-key-reveal" role="status">
                <p>{t('newKeyNotice')}</p>
                <div className="account-key-value">
                  <code>{newKey.key}</code>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void handleCopy(newKey.key)}
                  >
                    {copied
                      ? <Check size={16} aria-hidden="true" />
                      : <Copy size={16} aria-hidden="true" />}
                    {copied ? t('copied') : t('copyKey')}
                  </button>
                </div>
              </div>
            ) : null}

            {apiKeys.length === 0 ? (
              <p className="account-keys-empty">{t('noApiKeys')}</p>
            ) : (
              <ul className="account-key-list">
                {apiKeys.map((key) => (
                  <li key={key.id} className="account-key-row">
                    <div className="account-key-meta">
                      <p className="account-key-name">{key.name}</p>
                      <p className="account-key-prefix"><code>{key.keyPrefix}…</code></p>
                      <p className="account-key-dates">
                        {t('keyCreatedAt')} {formatDateTime(key.createdAt, language)}
                        {' · '}
                        {key.lastUsedAt
                          ? `${t('keyLastUsed')} ${formatDateTime(key.lastUsedAt, language)}`
                          : t('keyNeverUsed')}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button button-secondary"
                      aria-label={`${t('revoke')} ${key.name}`}
                      onClick={() => void handleRevoke(key.id)}
                    >
                      {t('revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
