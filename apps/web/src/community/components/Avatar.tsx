import { useState } from 'react'
import { avatarUrl } from '../lib/api'

/** A stable colour per login, so a missing picture still reads as a person. */
function loginHue(login: string): number {
  return [...login].reduce((value, character) => (value * 31 + character.charCodeAt(0)) % 360, 0)
}

interface AvatarProps {
  login: string
  src?: string | null
  size: number
  className?: string
}

export function Avatar({ login, src, size, className = '' }: AvatarProps) {
  const [loaded, setLoaded] = useState(false)
  const hue = loginHue(login)

  return (
    <span
      className={`avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        backgroundColor: `hsl(${hue} 42% 89%)`,
        color: `hsl(${hue} 44% 27%)`,
        fontSize: Math.round(size * 0.42),
      }}
      aria-hidden="true"
    >
      <span className="avatar-fallback">{login.slice(0, 1).toLocaleUpperCase()}</span>
      <img
        className={loaded ? 'avatar-image is-loaded' : 'avatar-image'}
        src={src ?? avatarUrl(login, size * 2)}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onLoad={() => setLoaded(true)}
      />
    </span>
  )
}
