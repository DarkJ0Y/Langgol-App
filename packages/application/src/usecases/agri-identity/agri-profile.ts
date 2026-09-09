/**
 * Reading and issuing a digital agricultural identity.
 *
 * ## The tripwire runs in production, not only in tests
 *
 * `auditDisclosure` is called on the finished profile before it is returned, on every request. If
 * anything private has reached it — a key that names something sensitive, a value shaped like a
 * phone number or a coordinate pair — the profile is refused and the caller gets an internal
 * error instead.
 *
 * That is a deliberate trade. It costs a walk over a small object on each read, and it means a
 * future field that leaks takes the endpoint down rather than publishing somebody's phone number.
 * Serving nothing is the correct failure when the alternative is serving that.
 *
 * ## The identifier is issued on first read
 *
 * Create-on-read, the same pattern as the farmer profile and the role profiles, and for the same
 * reason: an AGRI-ID can be needed from several places, and requiring each of them to also issue
 * one means the one that forgets produces a user with no identity at all.
 *
 * Refs: docs/07_SECURITY.md §4, §7
 */

import {
  AGRI_ID_RANDOM_BYTES,
  DEFAULT_AGRI_ID_COUNTRY,
  DisclosureError,
  agriIdFromBytes,
  assembleAgriProfile,
  auditDisclosure,
  type AgriAudience,
  type AgriProfile,
} from '@langgol/domain/agri-identity'
import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { AgriIdRandom, AgriIdentityRepository, AuditPort, Clock } from '../../ports/index.js'

export interface AgriProfileDeps {
  readonly clock: Clock
  readonly identities: AgriIdentityRepository
  readonly random: AgriIdRandom
  readonly audit: AuditPort
}

/**
 * How many times to retry a colliding identifier.
 *
 * Thirty-four billion values against any realistic number of users makes a collision vanishingly
 * unlikely, so three attempts is not about the birthday problem — it is about a bug or a
 * misconfigured random source producing the same bytes repeatedly. Failing after three is how
 * that becomes visible rather than becoming an infinite loop.
 */
const ISSUE_ATTEMPTS = 3

/**
 * Issue an AGRI-ID, or return the one already held.
 *
 * The candidate is built in the domain from bytes this function supplies; the database decides
 * whether it is free. A caller cannot influence the value.
 */
async function ensureAgriId(
  userId: string,
  deps: AgriProfileDeps,
): Promise<Result<{ readonly agriId: string; readonly issued: boolean }, AppError>> {
  const existing = await deps.identities.findAgriId(userId)
  if (existing !== null) return ok({ agriId: existing, issued: false })

  for (let attempt = 0; attempt < ISSUE_ATTEMPTS; attempt += 1) {
    const candidate = agriIdFromBytes(
      deps.random.bytes(AGRI_ID_RANDOM_BYTES),
      DEFAULT_AGRI_ID_COUNTRY,
    )
    const claimed = await deps.identities.issueAgriId(userId, candidate, deps.clock.now())
    if (claimed !== null) return ok({ agriId: claimed, issued: true })
  }

  return err(Errors.internal('Could not issue an agricultural identity'))
}

/**
 * The caller's own agricultural profile.
 *
 * Takes no identifier. The subject is the signed-in actor, so there is no argument here that
 * could be pointed at somebody else's card — which is also why this phase ships no lookup by
 * AGRI-ID: a public identifier must never be sufficient to fetch anything.
 */
export async function myAgriProfile(
  actor: MaybeActor,
  deps: AgriProfileDeps,
): Promise<Result<AgriProfile, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'agri-profile:read-own', { ownerUserId: actor.userId })) {
    return err(Errors.forbidden())
  }

  const sources = await deps.identities.profileSources(actor.userId)
  if (sources === null) return err(Errors.notFound('Profile'))

  const identity = await ensureAgriId(actor.userId, deps)
  if (!('value' in identity)) return identity

  if (identity.value.issued) {
    // Worth a line: an AGRI-ID is a permanent public name, and when it came into existence is
    // something a support conversation or a dispute may need to establish.
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'AGRI_ID_ISSUED',
      entityType: 'agri_identity',
      entityId: actor.userId,
    })
  }

  const profile = assembleAgriProfile(
    { ...sources, agriId: identity.value.agriId },
    // The owner, reading their own card. `PUBLIC` exists in the domain and has no route yet.
    'SELF' satisfies AgriAudience,
  )

  try {
    /*
     * The last thing before it leaves.
     *
     * Everything above is meant to be safe by construction, and this is what makes that claim
     * checkable rather than asserted. It has caught nothing today, which is the point: it is here
     * for the field somebody adds next year.
     */
    auditDisclosure(profile)
  } catch (cause) {
    if (cause instanceof DisclosureError) {
      /*
       * The offending value is NOT included in the error, only where it was found. Putting the
       * value in an error message would write the very thing this check exists to stop into a log
       * — which is how a safety net becomes the leak.
       */
      return err(Errors.internal(`Profile withheld: ${cause.code} at ${cause.path}`))
    }
    throw cause
  }

  return ok(profile)
}
