/**
 * Authorization policy.
 *
 * Every protected operation answers one question: *is this actor allowed to perform this action
 * on this resource?* The answer is a pure function of the actor, the action and the resource —
 * no database, no request object, no framework — which is what makes it exhaustively testable.
 *
 * This is layer two of three. It is defence in depth, not the whole defence:
 *
 *   1. Route gate (middleware)      coarse: may this session enter this route group?
 *   2. Policy check (here)          may this actor do this to this resource?
 *   3. Owner-scoped query (repo)    the ownership condition is IN THE SQL
 *
 * Layer 3 is what actually stops IDOR, because it cannot be forgotten the way an `if` can.
 * A policy that passes but a query that is not scoped is still a vulnerability.
 *
 * Refs: docs/07_SECURITY.md §4
 */

export type Role = 'FARMER' | 'CONSUMER' | 'RETAILER' | 'OPS_AGENT' | 'ADMIN'

export interface Actor {
  readonly userId: string
  readonly roles: readonly Role[]
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
}

/** The anonymous actor. Distinct from "a user with no roles", which is a bug. */
export const ANONYMOUS = Symbol('anonymous')
export type MaybeActor = Actor | typeof ANONYMOUS

/** Anything with an owner. Most resources in Langgol have exactly one. */
export interface OwnedResource {
  readonly ownerUserId: string
}

export type Action =
  // Own account
  | 'user:read-self'
  | 'user:update-self'
  | 'session:revoke-own'
  // Addresses
  | 'address:create'
  | 'address:read'
  | 'address:update'
  | 'address:delete'
  // Platform configuration
  | 'config:read'
  | 'config:write'
  // Administration
  | 'admin:access'
  | 'admin:user-read'
  | 'admin:user-suspend'
  | 'admin:role-grant'
  | 'admin:audit-read'
  | 'ops:access'

export type Decision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: DenialReason }

export type DenialReason =
  | 'ANONYMOUS'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'MISSING_ROLE'
  | 'NOT_OWNER'
  | 'RESOURCE_REQUIRED'
  | 'UNKNOWN_ACTION'

const ALLOW: Decision = { allowed: true }
const deny = (reason: DenialReason): Decision => ({ allowed: false, reason })

export function hasRole(actor: Actor, ...roles: readonly Role[]): boolean {
  return roles.some((role) => actor.roles.includes(role))
}

export function isActor(candidate: MaybeActor): candidate is Actor {
  return candidate !== ANONYMOUS
}

/** Rules that need a resource to decide. */
type ResourceRule = (actor: Actor, resource: OwnedResource) => Decision
/** Rules that depend only on the actor. */
type ActorRule = (actor: Actor) => Decision

const ownerOnly: ResourceRule = (actor, resource) =>
  resource.ownerUserId === actor.userId ? ALLOW : deny('NOT_OWNER')

/**
 * Owner, or an admin.
 *
 * `OPS_AGENT` is deliberately NOT included. Field agents act on a farmer's behalf for onboarding
 * and listing, but they must not reach another user's addresses or account settings, and they
 * can never touch payout destinations. docs/07_SECURITY.md §8.4, T15
 */
const ownerOrAdmin: ResourceRule = (actor, resource) =>
  resource.ownerUserId === actor.userId || hasRole(actor, 'ADMIN') ? ALLOW : deny('NOT_OWNER')

const requireRole =
  (...roles: readonly Role[]): ActorRule =>
  (actor) =>
    hasRole(actor, ...roles) ? ALLOW : deny('MISSING_ROLE')

const anyAuthenticated: ActorRule = () => ALLOW

/**
 * One rule per action.
 *
 * `actor` gates on identity and role; `resource` gates on ownership. An action declaring a
 * `resource` rule can only be decided WITH a resource — calling it without one is denied as
 * `RESOURCE_REQUIRED`, never silently allowed, because a forgotten argument must fail the same
 * way a forgotten `if` should.
 */
interface Rule {
  readonly actor?: ActorRule
  readonly resource?: ResourceRule
}

const RULES: Record<Action, Rule> = {
  'user:read-self': { actor: anyAuthenticated },
  'user:update-self': { actor: anyAuthenticated },
  'session:revoke-own': { actor: anyAuthenticated },

  'address:create': { actor: anyAuthenticated },
  'address:read': { actor: anyAuthenticated, resource: ownerOrAdmin },
  'address:update': { actor: anyAuthenticated, resource: ownerOnly },
  'address:delete': { actor: anyAuthenticated, resource: ownerOnly },

  'config:read': { actor: anyAuthenticated },
  'config:write': { actor: requireRole('ADMIN') },

  'admin:access': { actor: requireRole('ADMIN') },
  'admin:user-read': { actor: requireRole('ADMIN', 'OPS_AGENT') },
  'admin:user-suspend': { actor: requireRole('ADMIN') },
  'admin:role-grant': { actor: requireRole('ADMIN') },
  'admin:audit-read': { actor: requireRole('ADMIN') },
  'ops:access': { actor: requireRole('ADMIN', 'OPS_AGENT') },
}

/**
 * Decide whether an actor may perform an action.
 *
 * Fails closed at every step: anonymous is denied, a non-active account is denied, an action
 * with no rule is denied, and an ownership-scoped action without a resource is denied. Adding an
 * `Action` to the union without adding a rule is a TYPE ERROR, because `RULES` is an exhaustive
 * `Record<Action, Rule>` — the compiler enforces that no action ships unguarded.
 */
export function can(actor: MaybeActor, action: Action, resource?: OwnedResource): Decision {
  if (!isActor(actor)) return deny('ANONYMOUS')
  if (actor.status !== 'ACTIVE') return deny('ACCOUNT_NOT_ACTIVE')

  const rule: Rule | undefined = RULES[action]
  if (rule === undefined) return deny('UNKNOWN_ACTION')

  if (rule.actor !== undefined) {
    const decision = rule.actor(actor)
    if (!decision.allowed) return decision
  }

  if (rule.resource !== undefined) {
    if (resource === undefined) return deny('RESOURCE_REQUIRED')
    return rule.resource(actor, resource)
  }

  return ALLOW
}

export function allowed(actor: MaybeActor, action: Action, resource?: OwnedResource): boolean {
  return can(actor, action, resource).allowed
}
