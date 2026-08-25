import { Star } from 'lucide-react'
import type { PostPluginRef } from '../lib/api'

/**
 * A plugin the post mentioned. This is the one element in the feed that is
 * allowed to look like a card — it is a quotation from another surface, and the
 * gradient rule is the same one the catalog uses on its own rows.
 */
export function PluginCard({ plugin }: { plugin: PostPluginRef }) {
  return (
    <a className="plugin-card" href={plugin.url} target="_blank" rel="noreferrer">
      <span className="plugin-card-rule" aria-hidden="true" />
      <span className="plugin-card-main">
        <span className="plugin-card-name">{plugin.name}</span>
        <span className="plugin-card-meta">
          <span className="plugin-card-owner">{plugin.owner}</span>
          {plugin.category ? <span className="plugin-card-category">{plugin.category}</span> : null}
        </span>
      </span>
      {plugin.stars !== null ? (
        <span className="plugin-card-stars">
          <Star size={13} aria-hidden="true" />
          {plugin.stars.toLocaleString()}
        </span>
      ) : null}
    </a>
  )
}
