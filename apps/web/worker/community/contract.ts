/**
 * The wire shapes the Worker sends and the browser reads. Both sides import
 * this file, so a field renamed on one side fails to compile on the other.
 */

export interface PostAuthor {
  login: string
  name: string | null
  avatarUrl: string | null
}

/** A plugin the post mentioned, resolved against the catalog at write time. */
export interface PostPluginRef {
  /** Canonical `owner/repository[/sub/dir]`, in its display casing. */
  id: string
  name: string
  owner: string
  category: string | null
  stars: number | null
  /** Absolute URL into the main site's plugin detail page. */
  url: string
}

export interface Post {
  id: number
  author: PostAuthor
  /** null when the post was deleted; the row survives so replies keep their thread. */
  body: string | null
  createdAt: string
  likeCount: number
  replyCount: number
  /** Whether the caller has liked it. Always false for signed-out readers. */
  liked: boolean
  plugins: PostPluginRef[]
  /** Non-null on a reply. */
  replyToId: number | null
  /** Whether the caller may delete it (author, or an admin). */
  deletable: boolean
}

export interface Viewer {
  login: string
  name: string | null
  avatarUrl: string | null
  admin: boolean
}

export type FeedTab = 'latest' | 'hot'

export interface FeedResponse {
  posts: Post[]
  /** Pass back as `cursor` for the next page; null when the feed is exhausted. */
  nextCursor: string | null
}

export interface ThreadResponse {
  post: Post
  replies: Post[]
}

export interface CommunityStats {
  posts: number
  authors: number
  postsToday: number
}

export interface ApiError {
  error: string
  code:
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'INVALID_REQUEST'
    | 'RATE_LIMITED'
    | 'DAILY_QUOTA_EXCEEDED'
    | 'SERVICE_UNAVAILABLE'
  /** Set on RATE_LIMITED / DAILY_QUOTA_EXCEEDED. */
  retryAfterSeconds?: number
}

/** 审核分类。`unavailable` 不是一类内容，是分类器不可用时的拒绝理由。 */
export type ModerationCategory = 'political' | 'sexual' | 'abuse' | 'spam' | 'unavailable'

export type ModerationVerdict =
  | { allowed: true }
  | { allowed: false; category: ModerationCategory; source: 'lexicon' | 'classifier' }
