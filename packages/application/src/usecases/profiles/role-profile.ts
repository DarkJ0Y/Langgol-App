/**
 * A user's own role profile.
 *
 * One pair of use cases for all six roles. The role is a parameter, but the SUBJECT never is:
 * every operation acts on `actor.userId`, so there is no argument anybody could put another
 * person's id into.
 *
 * ## "Each role must only manage its own profile"
 *
 * Two separate things, and both are enforced here:
 *
 *  1. **You may only touch a profile for a role you hold.** A consumer asking for the wholesaler
 *     profile is refused — not given an empty one — because answering would quietly raise the
 *     question of what happens when they PATCH it.
 *  2. **You may only touch your own.** Guaranteed by the absence of a subject parameter and,
 *     underneath, by the `user_id` the repository compiles into every query.
 *
 * The first check is deliberately against the actor's LIVE roles rather than anything stored on
 * the profile. A retailer whose role was revoked this morning must not still be editing a
 * retailer profile this afternoon.
 *
 * Refs: docs/07_SECURITY.md §4; docs/03_ARCHITECTURE.md §4
 */

import { allowed, isActor, type MaybeActor, type Role } from '@langgol/domain/policy'
import {
  PROFILE_FIELDS,
  ProfileError,
  isProfileRole,
  profileCompletion,
  validateProfile,
  type ProfileInput,
  type ProfileRole,
} from '@langgol/domain/profiles'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AuditPort,
  Clock,
  RoleProfileRecord,
  RoleProfileRepository,
} from '../../ports/index.js'

export interface RoleProfileDeps {
  readonly clock: Clock
  readonly profiles: RoleProfileRepository
  readonly audit: AuditPort
}

export interface RoleProfileView {
  readonly profile: RoleProfileRecord
  readonly completion: {
    readonly answered: number
    readonly total: number
    readonly percent: number
  }
}

const view = (profile: RoleProfileRecord): RoleProfileView => ({
  profile,
  completion: profileCompletion(profile.role, profile.fields),
})

/**
 * Whether this actor may act on this role's profile at all.
 *
 * `ADMIN` is deliberately not an exception. There is no action in the vocabulary that lets one
 * user edit another's profile, so an administrator has nothing to do it WITH — the guarantee is
 * an absent capability rather than a check somebody could forget.
 */
function gate(actor: MaybeActor, role: string): Result<ProfileRole, AppError> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'profile:manage-own')) return err(Errors.forbidden())
  if (!isProfileRole(role)) return err(Errors.validation('Unknown role', { field: 'role' }))
  if (!actor.roles.includes(role as Role)) return err(Errors.forbidden())
  return ok(role)
}

/* --------------------------------------------------------------------- read */

/**
 * The caller's profile for one of their roles, created empty on first read.
 *
 * Create-on-read for the same reason the farmer profile does it: a role can be granted from
 * several places, and requiring each of them to also insert a profile row means the one that
 * forgets produces a user who cannot open their own settings. The row it creates asserts nothing
 * except a name the owner immediately edits.
 */
export async function getMyRoleProfile(
  actor: MaybeActor,
  role: string,
  deps: RoleProfileDeps,
): Promise<Result<RoleProfileView, AppError>> {
  const gated = gate(actor, role)
  if (!('value' in gated)) return gated
  const profileRole = gated.value
  const userId = (actor as { userId: string }).userId

  const existing = await deps.profiles.findForUser(userId, profileRole)
  if (existing !== null) return ok(view(existing))

  return ok(view(await deps.profiles.ensureForUser(userId, profileRole, deps.clock.now())))
}

/* -------------------------------------------------------------------- write */

export interface UpdateRoleProfileCommand {
  readonly fields: ProfileInput
  /** Admin area ids. Ignored for roles that have no service area. */
  readonly serviceAreaIds?: readonly string[]
}

export async function updateMyRoleProfile(
  actor: MaybeActor,
  role: string,
  command: UpdateRoleProfileCommand,
  deps: RoleProfileDeps,
): Promise<Result<RoleProfileView, AppError>> {
  const gated = gate(actor, role)
  if (!('value' in gated)) return gated
  const profileRole = gated.value
  const userId = (actor as { userId: string }).userId

  const current = await deps.profiles.findForUser(userId, profileRole)
  if (current === null) return err(Errors.notFound('Profile'))

  let changes: Record<string, unknown>
  try {
    // The descriptor table is the allowlist: a field belonging to another role is dropped here,
    // never written.
    changes = validateProfile(profileRole, command.fields)
  } catch (cause) {
    if (cause instanceof ProfileError) {
      return err(Errors.validation(cause.message, { field: cause.field, code: cause.code }))
    }
    throw cause
  }

  /*
   * An address must be the caller's OWN.
   *
   * The domain checked that the id is a UUID; only a database can say whose it is. Without this a
   * retailer could point their profile at any address id they guessed and read a stranger's
   * recipient name and phone number back out of their own profile screen — the same IDOR the
   * farms table closed in P6.
   *
   * Checked here as well as by the trigger underneath, because the trigger raises an exception
   * and this produces a sentence beside the right field. Belt and braces, and the braces are the
   * one the security review counts.
   */
  for (const field of PROFILE_FIELDS[profileRole]) {
    if (field.kind.kind !== 'address') continue
    const chosen = changes[field.name]
    if (typeof chosen !== 'string') continue
    if (!(await deps.profiles.ownsAddress(userId, chosen))) {
      return err(
        Errors.validation('Choose an address from your list', {
          field: field.name,
          code: 'NOT_ADDRESS',
        }),
      )
    }
  }

  /*
   * SUBMITTED is not CHANGED. The form posts every field on every save, so writing the submitted
   * set would record in the audit log that a retailer edited their TIN when they only picked a
   * business type — a line an investigator would read as a true statement about something that
   * did not happen.
   */
  const edited = Object.keys(changes).filter(
    (key) => JSON.stringify(changes[key]) !== JSON.stringify(current.fields[key] ?? null),
  )

  const updated =
    edited.length === 0
      ? current
      : ((await deps.profiles.updateForUser(
          userId,
          profileRole,
          Object.fromEntries(edited.map((k) => [k, changes[k]])),
        )) ?? current)

  let serviceAreaIds = updated.serviceAreaIds
  if (command.serviceAreaIds !== undefined) {
    serviceAreaIds = await deps.profiles.replaceServiceAreas(
      userId,
      profileRole,
      command.serviceAreaIds,
    )
  }

  if (edited.length > 0 || command.serviceAreaIds !== undefined) {
    // Field NAMES only. What changed is what an investigation needs; a trade licence number
    // copied into an audit row would spread it into a table with a different retention policy.
    await deps.audit.record({
      actorUserId: userId,
      action: 'ROLE_PROFILE_UPDATED',
      entityType: 'role_profile',
      entityId: updated.id,
      reason: [profileRole, ...[...edited].sort()].join(','),
    })
  }

  return ok(view({ ...updated, serviceAreaIds }))
}

/** The fields one role declares, for a form that builds itself from the domain. */
export function roleProfileFields(role: string) {
  return isProfileRole(role) ? PROFILE_FIELDS[role] : []
}
