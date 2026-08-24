import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Post text.
 *
 * `react-markdown` does not render raw HTML unless `rehype-raw` is added, and it
 * deliberately is not: every post here is written by an anonymous visitor, so
 * the renderer must have no path from their text to markup. Links are opened in
 * a new tab and marked `nofollow ugc`, which is what they are.
 */
function PostBodyView({ body }: { body: string }) {
  return (
    <div className="post-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="nofollow ugc noreferrer">
              {children}
            </a>
          ),
          // A post is not a document: its headings should not compete with the
          // page's own hierarchy, so they render as emphasised text.
          h1: ({ children }) => <p className="post-heading">{children}</p>,
          h2: ({ children }) => <p className="post-heading">{children}</p>,
          h3: ({ children }) => <p className="post-heading">{children}</p>,
          h4: ({ children }) => <p className="post-heading">{children}</p>,
          h5: ({ children }) => <p className="post-heading">{children}</p>,
          h6: ({ children }) => <p className="post-heading">{children}</p>,
          img: () => null,
          pre: ({ children }) => <pre className="post-pre">{children}</pre>,
          table: ({ children }) => (
            <div className="post-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Markdown parsing is the expensive part of a feed render — measured at ~7ms a
 * post, so a page of them blocks a frame and the section visibly stutters on
 * arrival. It depends on nothing but `body`, so a like or a tab change must not
 * re-parse every post on screen.
 */
export const PostBody = memo(PostBodyView)
