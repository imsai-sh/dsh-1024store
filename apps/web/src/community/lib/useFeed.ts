import { useCallback, useEffect, useRef, useState } from 'react'
import type { Post } from './api'

export interface FeedState {
  posts: Post[]
  cursor: string | null
  status: 'loading' | 'ready' | 'error'
  loadingMore: boolean
}

type Loader = (cursor: string | null) => Promise<{ posts: Post[]; nextCursor: string | null }>

const INITIAL: FeedState = { posts: [], cursor: null, status: 'loading', loadingMore: false }

/**
 * Last page rendered per list, kept for the life of the tab.
 *
 * The catalog does the same thing (`getCachedCatalog`) and that is why moving
 * between site pages is seamless: a remount paints the previous answer
 * immediately and refreshes behind it. Without this the community remounted
 * empty on every visit, flashed a loading row, then jumped to full height.
 */
const lastRendered = new Map<string, { posts: Post[]; cursor: string | null }>()

/**
 * A paged list of posts with local edits applied in place.
 *
 * Liking or deleting inside a feed must not refetch the page — that would jump
 * the reader's scroll position for a one-character change — so the hook owns the
 * list and exposes surgical edits instead of a reload.
 */
export function useFeed(load: Loader, resetKey: string) {
  const [state, setState] = useState<FeedState>(() => {
    const warm = lastRendered.get(resetKey)
    return warm ? { ...warm, status: 'ready', loadingMore: false } : INITIAL
  })
  // A mirror of the latest state, so loadMore can read the current cursor
  // without taking it as a dependency and re-creating itself on every page.
  const latest = useRef(state)
  latest.current = state
  const loaderRef = useRef(load)
  loaderRef.current = load
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    // A warm list stays on screen while the refresh runs; only a cold one shows
    // the loading state, so navigating back never blanks the page.
    if (!lastRendered.has(resetKey)) setState(INITIAL)
    load(null)
      .then((page) => {
        if (cancelled) return
        lastRendered.set(resetKey, { posts: page.posts, cursor: page.nextCursor })
        setState({ posts: page.posts, cursor: page.nextCursor, status: 'ready', loadingMore: false })
      })
      .catch(() => {
        // A failed refresh keeps the last good list, like the catalog does.
        if (!cancelled && !lastRendered.has(resetKey)) setState({ ...INITIAL, status: 'error' })
      })
    return () => { cancelled = true }
  }, [load, resetKey, reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  const loadMore = useCallback(async () => {
    const current = latest.current
    if (current.loadingMore || current.cursor === null) return
    // Which list this page belongs to. Switching tabs mid-flight replaces the
    // loader, and appending the old tab's page to the new list would interleave
    // two feeds.
    const issuedFor = load
    setState((previous) => ({ ...previous, loadingMore: true }))
    try {
      const page = await load(current.cursor)
      if (issuedFor !== loaderRef.current) return
      setState((previous) => ({
        // Dedupe by id: a post published between two page fetches would
        // otherwise appear in both.
        posts: [
          ...previous.posts,
          ...page.posts.filter((post) => !previous.posts.some((existing) => existing.id === post.id)),
        ],
        cursor: page.nextCursor,
        status: 'ready',
        loadingMore: false,
      }))
    } catch {
      if (issuedFor === loaderRef.current) {
        setState((previous) => ({ ...previous, loadingMore: false }))
      }
    }
  }, [load])

  const replace = useCallback((post: Post) => {
    setState((previous) => ({
      ...previous,
      posts: previous.posts.map((existing) => existing.id === post.id ? post : existing),
    }))
  }, [])

  const remove = useCallback((id: number) => {
    setState((previous) => ({
      ...previous,
      posts: previous.posts.filter((existing) => existing.id !== id),
    }))
  }, [])

  const prepend = useCallback((post: Post) => {
    setState((previous) => ({ ...previous, posts: [post, ...previous.posts] }))
  }, [])

  return { ...state, loadMore, replace, remove, prepend, reload }
}
