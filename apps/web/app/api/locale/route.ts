/**
 * Language switch.
 *
 * A form POST rather than a client-side toggle, so it works before JavaScript has downloaded —
 * on a congested 2G connection that is a meaningful share of the page's life.
 */

import { NextResponse } from 'next/server'
import { isLocale } from '@langgol/i18n'
import { LOCALE_COOKIE } from '@/lib/locale'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData()
  const requested = form.get('locale')
  const returnTo = form.get('returnTo')

  const locale = typeof requested === 'string' && isLocale(requested) ? requested : 'bn'

  // Open-redirect guard: only same-site paths, never a scheme or a protocol-relative URL.
  const target =
    typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/'

  const response = NextResponse.redirect(new URL(target, request.url), { status: 303 })
  response.cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: false, // A language preference is not a secret, and client code may want to read it.
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
