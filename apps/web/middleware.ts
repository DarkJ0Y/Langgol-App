/**
 * Edge middleware: security headers, locale, and a coarse route gate.
 *
 * Deliberately lightweight. Middleware runs on every request including navigations to static
 * pages, so it does **no database work** — session validity is resolved in server components and
 * server actions where a round trip is affordable and where a degraded database produces a
 * useful error rather than a site-wide failure.
 *
 * The gate here is presence-of-cookie only. It is a redirect for the user's benefit, **not** an
 * authorization boundary: every protected page re-resolves the session and every action calls
 * the policy layer. A forged cookie gets a redirect it did not want and nothing else.
 *
 * Refs: docs/07_SECURITY.md §4.5, §11; docs/03_ARCHITECTURE.md §4
 */

import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIES = ['__Host-langgol_session', 'langgol_session']

/** Pages that require a session. Everything else is public. */
const PROTECTED_PREFIXES = [
  '/auth/role',
  '/account',
  '/farmer',
  '/admin',
  '/agri-profile',
  '/onboarding',
]

/** Pages that make no sense once signed in. */
const ANONYMOUS_ONLY_PREFIXES = [
  '/auth/phone',
  '/auth/register',
  '/auth/verify',
  '/auth/development',
  '/auth/firebase',
]

/**
 * The origins Firebase phone sign-in needs, and nothing more.
 *
 * Phone authentication runs a reCAPTCHA challenge in an iframe and talks to two Google endpoints:
 * Identity Toolkit to start the sign-in, Secure Token to exchange and refresh. Under the policy
 * below every one of those is blocked by `default-src 'self'`, silently — the widget simply never
 * appears and no error explains why.
 *
 * Added ONLY when Firebase is the active mode. A policy is worth exactly what it refuses, and
 * permanently admitting four Google origins to buy a feature that is switched off would weaken
 * every deployment that never turns it on.
 *
 * `auth-domain` is the deployment's own Firebase domain, which serves the sign-in helper frame.
 */
const FIREBASE_SCRIPT_SRC = ['https://www.google.com', 'https://www.gstatic.com'] as const
const FIREBASE_CONNECT_SRC = [
  'https://identitytoolkit.googleapis.com',
  'https://securetoken.googleapis.com',
] as const
const FIREBASE_FRAME_SRC = ['https://www.google.com'] as const

interface CspOptions {
  readonly nonce: string
  readonly isDevelopment: boolean
  /** The Firebase auth domain, when and only when `AUTH_MODE=firebase`. */
  readonly firebaseAuthDomain: string | null
}

function securityHeaders(options: CspOptions): Record<string, string> {
  const { nonce, isDevelopment, firebaseAuthDomain } = options
  /*
   * Content-Security-Policy.
   *
   * Nonce-based with `strict-dynamic`: scripts Next injects carry the nonce and may load their
   * own chunks; nothing else runs. No `unsafe-inline` for scripts.
   *
   * Documented exceptions:
   *  - `style-src` allows `unsafe-inline`. React sets inline styles and Next inlines critical
   *    CSS; there is no nonce path for those today. Style injection is a far smaller risk than
   *    script injection, and this is revisited if that changes.
   *  - `connect-src`/`script-src` relax in development only, for the dev server's websocket and
   *    eval-based fast refresh. Never in staging or production.
   *  - Four Google origins are admitted when, and only when, Firebase is the active sign-in mode.
   */
  const firebase = firebaseAuthDomain !== null

  /*
   * reCAPTCHA loads its own script from these, and `strict-dynamic` does NOT cover them.
   *
   * That is worth stating because it looks like it should: `strict-dynamic` lets a nonced script
   * load further scripts, but the reCAPTCHA bootstrap is injected as a plain tag by Firebase's
   * bundle rather than created by a nonced one, so the host has to be named.
   */
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ...(firebase ? FIREBASE_SCRIPT_SRC : []),
  ].join(' ')

  const connectSrc = [
    "'self'",
    ...(isDevelopment ? ['ws:', 'wss:'] : []),
    ...(firebase ? FIREBASE_CONNECT_SRC : []),
  ].join(' ')

  /*
   * `frame-src` is absent entirely unless Firebase is active, so it falls back to `default-src
   * 'self'` and no cross-origin frame can be embedded. This is the direction that matters: the
   * app never needs to embed anything, right up until the reCAPTCHA challenge does.
   */
  const frameSrc = firebase
    ? [`frame-src 'self' ${[...FIREBASE_FRAME_SRC, `https://${firebaseAuthDomain}`].join(' ')}`]
    : []

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    ...frameSrc,
    "form-action 'self'",
    // Unchanged by any of the above. Langgol is never embedded in somebody else's page, whichever
    // sign-in mode is active — this is the clickjacking control, not a Firebase concern.
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')

  return {
    'content-security-policy': csp,
    // frame-ancestors covers modern browsers; this is the belt for older ones.
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    // Send the origin cross-site, the full path same-origin. A farmer's order id is not another
    // site's business.
    'referrer-policy': 'strict-origin-when-cross-origin',
    // Nothing in Langgol needs these yet. Geolocation will be requested explicitly when the
    // buyer address screen lands, and this list revisited then.
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'x-dns-prefetch-control': 'off',
  }
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, '')
  const isDevelopment = process.env['NODE_ENV'] === 'development'

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  // The layout reads this so the language switch returns to the page you were on.
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  // Correlates a request across middleware, server components, actions and logs.
  requestHeaders.set('x-request-id', request.headers.get('x-request-id') ?? crypto.randomUUID())

  const hasSession = SESSION_COOKIES.some((name) => {
    const value = request.cookies.get(name)?.value
    return value !== undefined && value.length > 0
  })

  const { pathname } = request.nextUrl

  let response: NextResponse
  if (!hasSession && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth'
    url.search = ''
    response = NextResponse.redirect(url)
  } else if (hasSession && ANONYMOUS_ONLY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/role'
    url.search = ''
    response = NextResponse.redirect(url)
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }

  /*
   * Read straight from `process.env`, as NODE_ENV above already is.
   *
   * Middleware runs in the edge runtime, where the full parsed environment is deliberately not
   * loaded. Both values are used only to decide whether to widen the policy, and either one
   * missing simply leaves it narrow — which is the safe direction to fail in.
   */
  const firebaseAuthDomain =
    process.env['AUTH_MODE'] === 'firebase'
      ? (process.env['FIREBASE_AUTH_DOMAIN'] ?? '').trim() || null
      : null

  for (const [name, value] of Object.entries(
    securityHeaders({ nonce, isDevelopment, firebaseAuthDomain }),
  )) {
    response.headers.set(name, value)
  }

  // HSTS only where HTTPS is real. Setting it on plain-HTTP local development would pin the
  // browser to a scheme the dev server does not serve.
  if (process.env['APP_ENV'] === 'production' || process.env['APP_ENV'] === 'staging') {
    response.headers.set(
      'strict-transport-security',
      'max-age=63072000; includeSubDomains; preload',
    )
  }

  return response
}

export const config = {
  // Static assets and images skip middleware entirely — headers there cost latency for no gain.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
