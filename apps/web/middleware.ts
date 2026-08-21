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
const PROTECTED_PREFIXES = ['/auth/role', '/account']

/** Pages that make no sense once signed in. */
const ANONYMOUS_ONLY_PREFIXES = ['/auth/phone', '/auth/verify', '/auth/development']

function securityHeaders(nonce: string, isDevelopment: boolean): Record<string, string> {
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
   */
  const scriptSrc = isDevelopment
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`

  const connectSrc = isDevelopment ? "'self' ws: wss:" : "'self'"

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "form-action 'self'",
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

  for (const [name, value] of Object.entries(securityHeaders(nonce, isDevelopment))) {
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
