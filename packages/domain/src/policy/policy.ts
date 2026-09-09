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

import { PRIVILEGED_ROLES, type Role } from '../identity/roles.js'
import { holdsPermission, type AdminPermission } from '../admin/permissions.js'

export type { AdminPermission }

/**
 * Re-exported so the policy layer stays the one import a caller needs for authorization, while
 * the vocabulary itself lives in `identity/roles.ts`. Two hand-written role lists is one too
 * many: they drift, and the one that drifts is always the one guarding something.
 */
export type { Role }

export interface Actor {
  readonly userId: string
  readonly roles: readonly Role[]
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
  /**
   * Administrative permissions held, if any.
   *
   * Optional so that the hundreds of places constructing an ordinary user's actor need not mention
   * it — and absent means NONE, never all. Every rule below reads it through `holdsPermission`,
   * which treats an absent set as empty, so the failure direction of a forgotten field is a
   * refusal rather than a grant.
   */
  readonly permissions?: readonly AdminPermission[]
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
  // Roles
  | 'role:list'
  | 'role:read-own'
  | 'role:self-select'
  | 'role:assign'
  | 'role:revoke'
  | 'role:assign-privileged'
  // Administration
  | 'consent:read-own'
  | 'consent:decide-own'
  | 'consent:read-any'
  | 'farmer:read-self'
  | 'farmer:update-self'
  | 'advisory:use'
  | 'farm:manage-own'
  | 'profile:manage-own'
  // Identity, KYC and verification
  | 'kyc:submit-own'
  | 'kyc:read-own'
  | 'kyc:review'
  | 'kyc:read-any'
  | 'kyc:document-view'
  // Digital agricultural identity
  | 'agri-profile:read-own'
  | 'admin:access'
  | 'admin:user-read'
  | 'admin:user-edit'
  | 'admin:user-suspend'
  | 'admin:user-restore'
  | 'admin:role-grant'
  | 'admin:audit-read'
  | 'admin:permission-manage'
  // Reviewing the non-identity verification types, each under its own permission
  | 'verification:review-business'
  | 'verification:review-farm'
  | 'verification:review-expert'
  | 'ops:access'

export type Decision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: DenialReason }

export type DenialReason =
  | 'ANONYMOUS'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'MISSING_ROLE'
  /** Holds the ADMIN role, but not the specific permission this action needs. */
  | 'MISSING_PERMISSION'
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
 * Owner, or an administrator who may view users.
 *
 * The admin branch requires `USER_VIEW` since P13, not merely the role. Reading somebody else's
 * address is reading their personal data, and an administrator with an empty permission set being
 * able to do it would have been the one hole left in an otherwise least-privilege back office —
 * reachable without ever opening an admin page.
 *
 * `OPS_AGENT` is deliberately NOT included. Field agents act on a farmer's behalf for onboarding
 * and listing, but they must not reach another user's addresses or account settings, and they
 * can never touch payout destinations. docs/07_SECURITY.md §8.4, T15
 */
const ownerOrAdmin: ResourceRule = (actor, resource) => {
  if (resource.ownerUserId === actor.userId) return ALLOW
  if (!hasRole(actor, 'ADMIN')) return deny('NOT_OWNER')
  // Reported as NOT_OWNER rather than MISSING_PERMISSION: to a caller who is not the owner, the
  // answer is the same whichever reason applies, and the narrower one discloses less.
  return holdsPermission(actor.permissions, 'USER_VIEW') ? ALLOW : deny('NOT_OWNER')
}

const requireRole =
  (...roles: readonly Role[]): ActorRule =>
  (actor) =>
    hasRole(actor, ...roles) ? ALLOW : deny('MISSING_ROLE')

/**
 * The ADMIN role AND a named permission.
 *
 * Both, always. The role is the door and the permission is what may be done inside, and an
 * administrator holding no permissions can open the back office and do nothing in it — which is
 * the correct state for an account that was created five minutes ago.
 *
 * There is deliberately no escape hatch. No wildcard permission, no super-admin, and no branch
 * reading "if the actor is an ADMIN, allow"; adding one would collapse this back into the
 * all-or-nothing model it replaces. A permission nobody holds is an action nobody can perform,
 * including the person who wrote it.
 */
const requirePermission =
  (permission: AdminPermission): ActorRule =>
  (actor) => {
    if (!hasRole(actor, 'ADMIN')) return deny('MISSING_ROLE')
    return holdsPermission(actor.permissions, permission) ? ALLOW : deny('MISSING_PERMISSION')
  }

/**
 * Either of two rules.
 *
 * Needed in exactly one place: reading a user is reachable by an administrator holding
 * `USER_VIEW` and, separately, by a field agent — who has always been able to look up the farmer
 * sitting beside them and must not lose that to a permission scheme aimed at administrators.
 *
 * The first denial is reported when both fail, which is the more informative of the two: an
 * administrator missing a permission wants to be told that, not told they are not a field agent.
 */
const anyOf =
  (first: ActorRule, second: ActorRule): ActorRule =>
  (actor) => {
    const primary = first(actor)
    if (primary.allowed) return primary
    const fallback = second(actor)
    return fallback.allowed ? fallback : primary
  }

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

  /*
   * The catalogue is readable by anyone signed in: the signup screen has to render the choices,
   * and a role's existence is not a secret. Holding one is a different question.
   */
  'role:list': { actor: anyAuthenticated },
  'role:read-own': { actor: anyAuthenticated, resource: ownerOnly },
  'role:self-select': { actor: anyAuthenticated, resource: ownerOnly },

  /*
   * Assignment and revocation are ADMIN-only, and deliberately separate actions from
   * `admin:role-grant` so a future ops-scoped grant can be widened without also widening
   * revocation. Taking a role away can lock a farmer out of their own listings, so it is the
   * more dangerous half of the pair, not the lesser one.
   */
  'role:assign': { actor: requirePermission('ROLE_MANAGE') },
  'role:revoke': { actor: requirePermission('ROLE_MANAGE') },

  /*
   * Granting ADMIN or OPS_AGENT is called out separately from ordinary assignment. Both resolve
   * to the same role today, but a privileged grant is the action worth putting behind a second
   * approval later, and it cannot be if it is indistinguishable from granting WHOLESALER.
   */
  'role:assign-privileged': { actor: requirePermission('ROLE_MANAGE') },

  /*
   * Consent is the subject's to give and the subject's to withdraw.
   *
   * Note what is NOT in this vocabulary and never should be: any action that would let one user
   * record a decision for another. There is no `consent:decide-any`, so an administrator has no
   * permission to grant with — the guarantee is the absence of the action, not a check somewhere
   * that could be forgotten. `consent:read-any` exists because a data-subject request has to be
   * answerable, and reading is not deciding. docs/07_SECURITY.md §9.2, §9.4
   */
  'consent:read-own': { actor: anyAuthenticated, resource: ownerOnly },
  'consent:decide-own': { actor: anyAuthenticated, resource: ownerOnly },
  'consent:read-any': { actor: requirePermission('USER_VIEW') },

  /*
   * The farmer profile is the farmer's own, and holding the FARMER role is what makes one exist.
   *
   * `requireRole` rather than `anyAuthenticated`: a consumer has no farmer profile to read, and
   * an endpoint that answered them with an empty one would quietly invite the question of what
   * happens when they PATCH it. There is deliberately no `farmer:update-any` — an OPS_AGENT
   * onboards a farmer by sitting beside them, not by editing their answers afterwards, and the
   * guarantee is the absence of the action rather than a check somewhere that could be forgotten.
   * docs/07_SECURITY.md §8.4
   */
  'farmer:read-self': { actor: requireRole('FARMER') },
  'farmer:update-self': { actor: requireRole('FARMER') },

  /*
   * Crop diagnosis is for people who grow things, so it is FARMER-gated like the profile it reads
   * context from. This is the coarse gate only — the real one is the `AI_DATA_PROCESSING` consent
   * check inside the use case, because holding a role is not the same as agreeing to have your
   * photograph sent to a third party. Both must pass. docs/07_SECURITY.md §9.2
   */
  'advisory:use': { actor: requireRole('FARMER') },

  /*
   * Farms and plots. One action covers read and write on purpose: a farmer who may see a holding
   * may edit it, and splitting them would imply a sharing model that does not exist.
   *
   * No `resource` rule, and that is not an omission. Ownership here is enforced one layer lower,
   * in the SQL — every farm and plot query carries the owner in its WHERE clause, so a stranger's
   * id matches no row. A resource rule would need the row fetched first, which is precisely the
   * fetch-then-compare shape that leaks when somebody forgets the compare.
   */
  'farm:manage-own': { actor: requireRole('FARMER') },

  /*
   * A role profile. `anyAuthenticated` rather than a role list, deliberately: which roles a
   * profile may be opened for is decided by the use case against the actor's LIVE roles, and
   * duplicating that list here would give it two homes — the one that drifts being the one
   * guarding something.
   *
   * There is no `profile:manage-any`. An administrator therefore has no capability to edit
   * somebody else's profile with, which is the guarantee — an absent action rather than a check
   * that could be forgotten.
   */
  'profile:manage-own': { actor: anyAuthenticated },

  /*
   * Identity and KYC.
   *
   * ## What is deliberately absent
   *
   * There is no `kyc:approve-own`, no `kyc:set-status`, and no action of any kind that would let
   * a subject decide their own verification. A self-attested identity check is not an identity
   * check, and the guarantee here is an ABSENT capability rather than a condition somebody could
   * invert. The transition table in `domain/kyc/verification.ts` says the same thing a second
   * way: no edge reaches VERIFIED with a SUBJECT actor.
   *
   * ## Why review is ADMIN and not OPS_AGENT
   *
   * A field agent sits beside a farmer and helps them submit. Approving the document they helped
   * to gather is the same person on both sides of the check, which is the shape of every KYC
   * fraud that has ever been written up. `OPS_AGENT` can therefore reach nothing below.
   *
   * `kyc:document-view` has no resource rule, and that is not an omission: the document routes
   * carry a signed grant naming both the viewer and the object, and ownership is re-proved
   * against the row inside the use case. A resource rule here would need the row fetched first,
   * which is the fetch-then-compare shape that leaks when somebody forgets the compare.
   *
   * Refs: docs/07_SECURITY.md §4, §7, §8.4
   */
  'kyc:submit-own': { actor: anyAuthenticated },
  'kyc:read-own': { actor: anyAuthenticated, resource: ownerOnly },
  /*
   * Reading the queue and deciding a document are separate permissions held by different people.
   * `KYC_REVIEW` is the one that carries the ability to decrypt a national identity number, which
   * is why it is not implied by being able to see that a submission exists.
   */
  'kyc:review': { actor: requirePermission('KYC_REVIEW') },
  'kyc:read-any': { actor: requirePermission('KYC_VIEW') },
  'kyc:document-view': { actor: anyAuthenticated },

  /*
   * The agricultural profile.
   *
   * Owner-scoped, and there is deliberately no `agri-profile:read-any`. An AGRI-ID is printed on
   * certificates and delivery notes, so it must never be sufficient to FETCH anything — knowing
   * somebody's identifier grants no more than knowing their name does. When a public view is
   * built it gets its own action and its own narrower projection, which the domain's audience
   * table already anticipates; until then the absence of the action is the guarantee.
   */
  'agri-profile:read-own': { actor: anyAuthenticated, resource: ownerOnly },

  /*
   * The back office.
   *
   * `admin:access` is the door and stays a plain role check: somebody with the role but no
   * permissions may open the dashboard and see that they can do nothing, which is a far better
   * experience than a redirect they cannot explain. Every action behind it needs its own grant.
   */
  'admin:access': { actor: requireRole('ADMIN') },

  /*
   * An administrator with `USER_VIEW`, or a field agent.
   *
   * `OPS_AGENT` keeps the narrow lookup it has always had: an agent onboarding a farmer in a
   * village needs to find that farmer's account, and taking it away in the name of least
   * privilege would break the job without reducing any real risk. What an agent still cannot do
   * is everything below.
   */
  'admin:user-read': { actor: anyOf(requirePermission('USER_VIEW'), requireRole('OPS_AGENT')) },
  'admin:user-edit': { actor: requirePermission('USER_EDIT') },
  /*
   * Suspension and restoration share one permission.
   *
   * Splitting them would produce somebody who can lock an account and not unlock it, which is a
   * worse position than holding neither: the harm is done and the remedy is elsewhere.
   */
  'admin:user-suspend': { actor: requirePermission('ACCOUNT_SUSPEND') },
  'admin:user-restore': { actor: requirePermission('ACCOUNT_SUSPEND') },

  'admin:role-grant': { actor: requirePermission('ROLE_MANAGE') },
  'admin:audit-read': { actor: requirePermission('AUDIT_VIEW') },

  /*
   * Managing another administrator's permissions is itself under ROLE_MANAGE.
   *
   * It is the most dangerous action in the vocabulary — a holder can grant themselves everything
   * else — so it belongs with the other privilege-granting power rather than being spread across a
   * second permission somebody might hand out without noticing what it implies. That it is
   * self-amplifying is stated here rather than discovered later.
   */
  'admin:permission-manage': { actor: requirePermission('ROLE_MANAGE') },

  /*
   * The three non-identity review queues.
   *
   * One workflow, from the P10 verification hub, gated three ways — because the person who checks
   * a trade licence is not the person who checks an agronomist's degree, and neither needs to be
   * the person who reads national identity cards.
   */
  'verification:review-business': { actor: requirePermission('BUSINESS_REVIEW') },
  'verification:review-farm': { actor: requirePermission('FARM_REVIEW') },
  'verification:review-expert': { actor: requirePermission('EXPERT_REVIEW') },

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

/**
 * The action required to grant a particular role.
 *
 * Exists so a caller cannot accidentally check the weaker permission when handing out ADMIN. The
 * decision of *which* question to ask is itself part of the policy, and belongs here rather than
 * at each call site.
 */
export function assignmentActionFor(role: Role): Action {
  return (PRIVILEGED_ROLES as readonly string[]).includes(role)
    ? 'role:assign-privileged'
    : 'role:assign'
}
