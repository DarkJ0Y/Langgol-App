'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * "Use my location". Asks the browser, rounds to two decimal places (about a kilometre) and
 * puts the result in the URL for one search. Nothing is sent anywhere else and nothing is
 * stored: the server reads it, sorts the farms, and forgets it.
 */
export function LocateButton({
  label,
  busyLabel,
  deniedLabel,
}: {
  label: string
  busyLabel: string
  deniedLabel: string
}) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'denied'>('idle')
  const [supported, setSupported] = useState(true)

  /*
   * Checked after hydration, never during render. The server (Node 22 has a global `navigator`,
   * without geolocation) and the browser would otherwise render different trees, and React would
   * throw the server's HTML away.
   */
  useEffect(() => {
    if (!('geolocation' in navigator)) setSupported(false)
  }, [])

  if (!supported) return null

  return (
    <div className="lg-locate">
      <button
        type="button"
        className="lg-button lg-button--secondary lg-locate__button"
        disabled={state === 'busy'}
        onClick={() => {
          setState('busy')
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const lat = position.coords.latitude.toFixed(2)
              const lng = position.coords.longitude.toFixed(2)
              router.push(`/nearby?lat=${lat}&lng=${lng}`)
            },
            () => setState('denied'),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
          )
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        {state === 'busy' ? busyLabel : label}
      </button>
      {state === 'denied' ? <p className="lg-hint">{deniedLabel}</p> : null}
    </div>
  )
}
