/**
 * The optional password in front of the whole site (`SITE_PASSWORD`), checked in middleware.ts.
 *
 * A demo deployment signs people in with one click as any fixture account, administrator
 * included. On cPanel the host's Directory Privacy keeps strangers out; on Vercel's free plan the
 * production address cannot be protected by the platform, so the app does it: HTTP Basic, which
 * every browser answers with its own prompt and remembers for the session.
 *
 * Any user name is accepted; only the password is checked. It is a gate for a demo, not an account
 * system — there is one shared password and nothing is stored.
 */

export const SITE_REALM = 'Langgol demo'

const COLON = 58

/** Compares every byte whatever the lengths, so timing does not reveal how much matched. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/**
 * True when an `Authorization` header carries the site password.
 *
 * Browsers send Basic credentials as UTF-8 when the challenge says `charset="UTF-8"`, so the
 * comparison is on bytes rather than on a decoded string: a Bangla password works too.
 */
export function sitePasswordAccepted(authorization: string | null, password: string): boolean {
  if (authorization === null || !authorization.startsWith('Basic ')) return false

  let decoded: string
  try {
    decoded = atob(authorization.slice('Basic '.length).trim())
  } catch {
    return false
  }

  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
  const colon = bytes.indexOf(COLON)
  if (colon === -1) return false

  return sameBytes(bytes.subarray(colon + 1), new TextEncoder().encode(password))
}
