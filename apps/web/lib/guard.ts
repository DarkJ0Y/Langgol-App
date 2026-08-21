/**
 * Server-side authorization guards.
 *
 * The audit found the policy engine fully built and never called: `getActor()` existed, `can()`
 * existed, and no request path connected them. This module is that connection, and it exists as
 * *one* place so the connection cannot be made inconsistently in twenty others.
 *
 * These are layer 2 of the three in `packages/domain/src/policy/policy.ts`. They do not replace
 * layer 3 — the ownership condition still belongs in the SQL, because a query that is scoped
 * cannot be forgotten the way a guard can. A guard that passes over an unscoped query is still a
 * vulnerability.
 *
 * Refs: docs/07_SECURITY.md §4
 */

import 'server-only'
import { redirect } from 'next/navigation'
import {
  ANONYMOUS,
  allowed,
  can,
  isActor,
  type Action,
  type Actor,
  type MaybeActor,
  type OwnedResource,
  type Role,
} from '@langgol/domain/policy'
import { Errors, type AppError } from '@langgol/shared'
import { getActor, getSession, type SessionUser } from './session'

/**
 * The current actor, or the anonymous marker.
 *
 * Re-exported through this module so a caller reaching for authorization imports one thing.
 */
export async function currentActor(): Promise<MaybeActor> {
  return await getActor()
}

/**
 * Require a signed-in actor, or send them to sign in.
 *
 * For PAGES. Redirecting is the right answer on a page and the wrong one in an action, which is
 * why the action-side guards below return a typed error instead.
 */
export async function requireSession(returnTo?: string): Promise<SessionUser> {
  const session = await getSession()
  if (session === null) {
    redirect(returnTo === undefined ? '/auth' : `/auth?next=${encodeURIComponent(returnTo)}`)
  }
  return session
}

/**
 * Require a permission on a page, or redirect.
 *
 * A denial sends an anonymous visitor to sign in and everyone else to the home page. It
 * deliberately does NOT render "you are not allowed to see /admin/users": telling an
 * unauthorised visitor that a resource exists is itself a disclosure. docs/07 §4.4
 */
export async function requirePermission(action: Action, resource?: OwnedResource): Promise<Actor> {
  const actor = await getActor()

  if (!isActor(actor)) redirect('/auth')
  if (!allowed(actor, action, resource)) redirect('/')

  return actor
}

/**
 * Require a permission inside a server action, returning a typed error rather than redirecting.
 *
 * A redirect thrown from an action aborts the submission with no message the form can render, so
 * an action needs a value it can turn into a field error. `AppError` already carries the code the
 * boundary maps to a status and the flag saying whether the message is safe to show.
 */
export type GuardResult =
  { readonly ok: true; readonly actor: Actor } | { readonly ok: false; readonly error: AppError }

export async function authorize(action: Action, resource?: OwnedResource): Promise<GuardResult> {
  const actor = await getActor()
  const decision = can(actor, action, resource)

  if (decision.allowed) {
    // `can` already proved this is an Actor: it denies ANONYMOUS before any rule runs.
    return { ok: true, actor: actor as Actor }
  }

  return { ok: false, error: errorFor(decision.reason) }
}

/**
 * Map a denial reason to the error the boundary should return.
 *
 * `NOT_OWNER` becomes **not found**, not forbidden. A 403 confirms the resource exists, which
 * hands an attacker an enumeration oracle; the whole point of scoping by owner is that another
 * person's resource is indistinguishable from one that was never there. docs/07 §4.4
 */
function errorFor(reason: string): AppError {
  switch (reason) {
    case 'ANONYMOUS':
      return Errors.unauthenticated()
    case 'ACCOUNT_NOT_ACTIVE':
      return Errors.forbidden('This account is not active.')
    case 'NOT_OWNER':
      return Errors.notFound('Resource')
    default:
      return Errors.forbidden()
  }
}

/** Convenience for a page that only needs a role check. */
export async function requireRole(...roles: readonly Role[]): Promise<Actor> {
  const actor = await getActor()
  if (!isActor(actor)) redirect('/auth')
  if (!roles.some((role) => actor.roles.includes(role))) redirect('/')
  return actor
}

export { ANONYMOUS, isActor, type Actor, type MaybeActor }
