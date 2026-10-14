/**
 * The demo email-and-password credential.
 *
 * One credential, opening one account: the all-features development fixture. Enabled only when
 * AUTH_MODE=development (which production refuses at startup) AND a DEMO_PASSWORD is configured.
 * The session itself is created by the ordinary development sign-in use case, so the audit trail,
 * the fixture-only lookup and the session rules are the ones every development sign-in has.
 *
 * Refs: packages/shared/src/env.ts (DEMO_EMAIL, DEMO_PASSWORD)
 */

import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '@langgol/shared'
import { authMode } from '@/lib/deps'

/** Used when DEMO_EMAIL is not set, so a password alone is enough to switch the form on. */
export const DEFAULT_DEMO_EMAIL = 'demo@langgol.app'

export function demoLoginEnabled(): boolean {
  const password = env().DEMO_PASSWORD
  return authMode() === 'development' && password !== undefined && password !== ''
}

export function demoEmail(): string {
  const configured = env().DEMO_EMAIL
  return configured === undefined || configured === '' ? DEFAULT_DEMO_EMAIL : configured
}

/**
 * Compared as SHA-256 digests with `timingSafeEqual`: equal-length buffers whatever was typed, so
 * the comparison takes the same time for a near miss as for a wild guess. Both fields are always
 * compared, so the time does not reveal which one was wrong either.
 */
export function demoCredentialsMatch(email: string, password: string): boolean {
  if (!demoLoginEnabled()) return false

  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()
  const emailOk = timingSafeEqual(digest(email.trim().toLowerCase()), digest(demoEmail()))
  const passwordOk = timingSafeEqual(digest(password.trim()), digest(env().DEMO_PASSWORD ?? ''))
  return emailOk && passwordOk
}
