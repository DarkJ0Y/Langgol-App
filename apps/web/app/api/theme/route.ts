/**
 * Theme switch: dark (the default) or bright.
 *
 * A form POST rather than a client-side toggle, like the language switch beside it, so it works
 * before JavaScript has downloaded and needs none at all.
 */

import { NextResponse } from 'next/server'
import { DEFAULT_THEME, isTheme, THEME_COOKIE } from '@/lib/theme'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData()
  const requested = form.get('theme')
  const returnTo = form.get('returnTo')

  const theme = isTheme(requested) ? requested : DEFAULT_THEME

  // Open-redirect guard: only same-site paths, never a scheme or a protocol-relative URL.
  const target =
    typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/'

  const response = NextResponse.redirect(new URL(target, request.url), { status: 303 })
  response.cookies.set(THEME_COOKIE, theme, {
    httpOnly: false, // A display preference is not a secret.
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}
