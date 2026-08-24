export function LoadingState({ rows = 8 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-label="Loading" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-line skeleton-number" />
          <span className="skeleton-avatar" />
          <span className="skeleton-line skeleton-line-title" />
          <span className="skeleton-line skeleton-line-short" />
        </div>
      ))}
    </div>
  )
}
