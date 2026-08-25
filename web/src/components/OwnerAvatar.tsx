import { useState, type CSSProperties } from 'react'
import { githubAvatar } from '../lib/api'

interface OwnerAvatarProps {
  owner: string
  size: number
  className: string
  src?: string
  eager?: boolean
  fallbackToGitHub?: boolean
}

function ownerHue(owner: string): number {
  return [...owner].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 360, 0)
}

export function OwnerAvatar({
  owner,
  size,
  className,
  src,
  eager = false,
  fallbackToGitHub = true,
}: OwnerAvatarProps) {
  const [loaded, setLoaded] = useState(false)
  const hue = ownerHue(owner)
  const style = {
    backgroundColor: `hsl(${hue} 42% 89%)`,
    color: `hsl(${hue} 44% 27%)`,
  } satisfies CSSProperties

  return (
    <span className={className} style={style} aria-hidden="true">
      <span className="avatar-fallback">{owner.slice(0, 1).toLocaleUpperCase()}</span>
      {(src || fallbackToGitHub) && (
        <img
          className={loaded ? 'avatar-image is-loaded' : 'avatar-image'}
          src={src ?? githubAvatar(owner)}
          alt=""
          width={size}
          height={size}
          loading={eager ? 'eager' : 'lazy'}
          onLoad={() => setLoaded(true)}
        />
      )}
    </span>
  )
}
