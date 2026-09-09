/**
 * Server-side session resolution.
 *
 * The session cookie holds a random token; the database holds only its SHA-256 hash. Every
 * resolution is a database lookup, which is the price of revocable sessions and is the reason
 * "sign out everywhere" works at all.
 *
 * This runs in server components and server actions — **never in middleware**. Middleware is on
 * the hot path for every request including static assets, and a database round trip there is
 * both slow and a poor place to be when the database is degraded.
 *
 * Refs: docs/07_SECURITY.md §3.3, §4; docs/03_ARCHITECTURE.md §4
 */

import 'server-only'
import type { AdminPermission } from '@langgol/domain/admin'
import { cookies } from 'next/headers'
import { prisma } from '@langgol/db'
import { hashToken } from '@langgol/infrastructure'
import { ANONYMOUS, type Actor, type MaybeActor, type Role } from '@langgol/domain/policy'
import { env } from '@langgol/shared'

/**
 * `__Host-` is the strictest cookie prefix: it forces Secure, path `/`, and forbids a Domain
 * attribute, so a subdomain cannot set or overwrite it. The prefix only works over HTTPS, so
 * plain-HTTP local development falls back to an unprefixed name.
 */
export const SESSION_COOKIE = '__Host-langgol_session'
export const SESSION_COOKIE_DEV = 'langgol_session'

export function sessionCookieName(): string {
  return env().isProduction || env().APP_ENV === 'staging' ? SESSION_COOKIE : SESSION_COOKIE_DEV
}

export interface SessionUser {
  readonly userId: string
  readonly fullName: string
  readonly roles: readonly Role[]
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
  readonly preferredLanguage: 'BN' | 'EN'
  /**
   * Administrative permissions held right now.
   *
   * Read from the database on every request alongside the roles, deliberately not cached in the
   * session row or the cookie. A permission revoked at 09:00 must be gone at 09:00, not whenever
   * the operator next signs in — and a cookie carrying a permission list would be a claim the
   * holder could try to edit.
   */
  readonly permissions: readonly AdminPermission[]
  readonly isDevelopmentFixture: boolean
  /** Server-side only. Never rendered; used to resolve a fixture’s localised label. */
  readonly phone: string
  readonly expiresAt: Date
}

/**
 * Resolve the current session, or `null`.
 *
 * Expiry and revocation are in the WHERE clause, not checked afterwards — an expired session is
 * not "found then rejected", it is not found.
 */
export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(sessionCookieName())?.value
  if (token === undefined || token.length === 0) return null

  const row = await prisma.session.findFirst({
    where: {
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          phone: true,
          fullName: true,
          status: true,
          preferredLanguage: true,
          isDevelopmentFixture: true,
          deletedAt: true,
          roles: { where: { revokedAt: null }, select: { role: true } },
          // Live grants only. A revoked permission is gone on the next request, not on the next
          // sign-in.
          adminPermissions: { where: { revokedAt: null }, select: { permission: true } },
        },
      },
    },
  })

  if (row === null || row.user.deletedAt !== null) return null

  return {
    userId: row.user.id,
    fullName: row.user.fullName,
    phone: row.user.phone,
    roles: row.user.roles.map((assignment) => assignment.role),
    permissions: row.user.adminPermissions.map((grant) => grant.permission as AdminPermission),
    status: row.user.status,
    preferredLanguage: row.user.preferredLanguage,
    isDevelopmentFixture: row.user.isDevelopmentFixture,
    expiresAt: row.expiresAt,
  }
}

/**
 * The current actor for the policy layer.
 *
 * A suspended user resolves to an `Actor` with their real status rather than to `ANONYMOUS`, so
 * the policy layer can deny with `ACCOUNT_NOT_ACTIVE` and the UI can explain what happened
 * instead of silently returning them to a login form they will complete successfully.
 */
export async function getActor(): Promise<MaybeActor> {
  const session = await getSession()
  if (session === null) return ANONYMOUS
  return {
    userId: session.userId,
    roles: session.roles,
    status: session.status,
    /*
     * Carried onto the actor so the policy engine can see them.
     *
     * Without this line every permission check refuses, which is the correct failure direction —
     * a forgotten wiring locks administrators out rather than letting everybody in.
     */
    permissions: session.permissions,
  } satisfies Actor
}

/** Set the session cookie. The token never reaches client-side JavaScript. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies()
  const secure = env().isProduction || env().APP_ENV === 'staging'
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(sessionCookieName())
}

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(sessionCookieName())?.value ?? null
}
