/**
 * The signed-in farmer's own profile.
 *
 * Both operations are scoped to the actor themselves, and neither takes a `userId` parameter —
 * the same discipline as `usecases/account/profile.ts` and for the same reason: a use case that
 * can address "any farmer" by argument is one bad route handler away from an IDOR, and the
 * reliable way not to have that bug is not to have that parameter.
 *
 * There is no admin or ops variant here. An OPS_AGENT onboards a farmer by sitting beside them
 * with their phone, which produces the farmer's own authenticated session; it does not produce a
 * licence to edit their answers afterwards. docs/07_SECURITY.md §8.4
 *
 * Refs: docs/03_ARCHITECTURE.md §4, docs/08_BANGLADESH_CONTEXT.md §2
 */

import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import {
  FarmingProfileError,
  farmingCompletion,
  validateFarmingUpdate,
  type FarmingCompletion,
  type FarmingFields,
  type FarmingFieldsUpdate,
} from '@langgol/domain/farming'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AuditPort,
  Clock,
  FarmerProfileRecord,
  FarmerProfileRepository,
} from '../../ports/index.js'

export interface FarmerProfileDeps {
  readonly clock: Clock
  readonly farmers: FarmerProfileRepository
  readonly audit: AuditPort
}

/** The profile plus how far through the questionnaire it is. */
export interface FarmerProfileView {
  readonly profile: FarmerProfileRecord
  readonly completion: FarmingCompletion
}

const view = (profile: FarmerProfileRecord): FarmerProfileView => ({
  profile,
  completion: farmingCompletion(profile),
})

/* ------------------------------------------------------------------- GET /farmers/me */

/**
 * The signed-in farmer's profile, creating it on first read if the role is held without one.
 *
 * The create-on-read is not laziness about migrations. The FARMER role can be granted in several
 * places — signup, `/auth/role`, an admin grant, a seed — and requiring each of them to remember
 * to also insert a profile row means the one that forgets produces a farmer who cannot open
 * their own dashboard. Making the read total removes that whole class of bug, and the row it
 * creates is empty: it asserts nothing about the farmer that they did not tell us.
 */
export async function getMyFarmerProfile(
  actor: MaybeActor,
  deps: FarmerProfileDeps,
): Promise<Result<FarmerProfileView, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farmer:read-self')) return err(Errors.forbidden())

  const existing = await deps.farmers.findByUserId(actor.userId)
  if (existing !== null) return ok(view(existing))

  const created = await deps.farmers.ensureForUser({
    userId: actor.userId,
    now: deps.clock.now(),
  })

  return ok(view(created))
}

/* ----------------------------------------------------------------- PATCH /farmers/me */

/**
 * The agronomic fields, and only those.
 *
 * `displayName` and `bio` are deliberately not here yet. They are ordinary profile text rather
 * than farming answers, nothing in the onboarding flow collects them, and a command field that
 * is accepted and then quietly ignored is worse than one that does not exist — the caller has no
 * way to tell the difference between "saved" and "dropped".
 */
export type UpdateFarmerProfileCommand = FarmingFieldsUpdate

/**
 * Update the signed-in farmer's own profile.
 *
 * Notably absent, and absent on purpose:
 *
 *  - **verificationStatus / verifiedAt** — a self-attested verification is not a verification;
 *  - **nidHash** — identity documents are their own flow, with their own evidence trail;
 *  - **payout fields** — changing where money goes re-authenticates (`OtpPurpose.PAYOUT_CHANGE`
 *    already exists for it) and is never a profile edit;
 *  - **riskTier and the settlement-hold override** — an internal assessment; a farmer who could
 *    set their own would set it to TRUSTED.
 *
 * Validation runs against the MERGED state rather than the submission alone, so a two-step edit
 * cannot reach a contradiction that neither step could reach directly. See
 * `validateFarmingUpdate`.
 */
export async function updateMyFarmerProfile(
  actor: MaybeActor,
  command: UpdateFarmerProfileCommand,
  deps: FarmerProfileDeps,
): Promise<Result<FarmerProfileView, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'farmer:update-self')) return err(Errors.forbidden())

  const current = await deps.farmers.findByUserId(actor.userId)
  if (current === null) return err(Errors.notFound('Farmer profile'))

  let changes: Partial<FarmingFields>
  try {
    changes = validateFarmingUpdate(command, current)
  } catch (cause) {
    if (cause instanceof FarmingProfileError) {
      return err(Errors.validation(cause.message, { field: cause.field, code: cause.code }))
    }
    throw cause
  }

  /*
   * SUBMITTED is not the same as CHANGED. The onboarding form posts every question on every
   * save, so writing the submitted set would record in the audit log that a farmer edited their
   * land area when they only picked an irrigation method — a line an investigator would read as
   * a true statement about something that did not happen.
   */
  const edited = (Object.keys(changes) as (keyof FarmingFields)[]).filter(
    (key) => changes[key] !== current[key],
  )

  if (edited.length === 0) {
    // A form submitted unchanged is a normal thing for a person to do, and it should not leave a
    // trail suggesting otherwise.
    return ok(view(current))
  }

  const updated = await deps.farmers.updateForUser(
    actor.userId,
    Object.fromEntries(edited.map((key) => [key, changes[key]])),
  )
  if (updated === null) return err(Errors.notFound('Farmer profile'))

  /*
   * Audited with the FIELD NAMES that changed, never the values. That a farmer revised their land
   * area is what an investigation needs; copying the figure into an audit row would spread the
   * data into a table with a different retention policy. docs/07_SECURITY.md §7, §11
   */
  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'FARMER_PROFILE_UPDATED',
    entityType: 'farmer_profile',
    entityId: current.id,
    reason: [...edited].sort().join(','),
  })

  return ok(view(updated))
}
