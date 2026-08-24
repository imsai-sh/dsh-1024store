import type {
  ApiError,
  CommunityStats,
  FeedResponse,
  FeedTab,
  Post,
  ThreadResponse,
  Viewer,
} from '../../../worker/community/contract'

export type { CommunityStats, FeedResponse, FeedTab, Post, ThreadResponse, Viewer }
export type { PostPluginRef } from '../../../worker/community/contract'

const BASE = '/api/v1/community'

export class RequestFailed extends Error {
  constructor(readonly status: number, readonly payload: ApiError) {
    super(payload.error)
    this.name = 'RequestFailed'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({
      error: `Request failed with HTTP ${response.status}.`,
      code: 'INVALID_REQUEST' as const,
    }))
    throw new RequestFailed(response.status, payload as ApiError)
  }
  return response.json() as Promise<T>
}

export interface Session {
  viewer: Viewer | null
}

export const api = {
  session: () => request<Session>('/me'),
  stats: () => request<CommunityStats>('/stats'),

  feed: (tab: FeedTab, cursor: string | null) =>
    request<FeedResponse>(`/feed?tab=${tab}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),

  thread: (id: number) => request<ThreadResponse>(`/posts/${id}`),

  byAuthor: (login: string, cursor: string | null) =>
    request<FeedResponse>(
      `/users/${encodeURIComponent(login)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),

  publish: (body: string, replyToId: number | null = null) =>
    request<{ post: Post }>('/posts', {
      method: 'POST',
      body: JSON.stringify({ body, replyToId }),
    }).then((payload) => payload.post),

  remove: (id: number) => request<{ ok: true }>(`/posts/${id}`, { method: 'DELETE' }),

  setLike: (id: number, liked: boolean) =>
    request<{ likeCount: number; liked: boolean }>(`/posts/${id}/like`, {
      method: liked ? 'POST' : 'DELETE',
    }),

  signOut: () => request<{ ok: true }>('/sign-out', { method: 'POST' }),
}

/** GitHub's avatar CDN, so a profile picture needs no round trip through us. */
export function avatarUrl(login: string, size: number): string {
  return `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=${size}`
}
