/**
 * How far through setup an account is.
 *
 * ## These states describe; they never permit
 *
 * The single most important thing about this vocabulary is what it is not. `FULLY_ONBOARDED` is
 * not a licence and `REGISTERED` is not a restriction. A user sitting at `PHONE_VERIFIED` can
 * browse the market, place an order, list produce and be paid, exactly as one at the far end can.
 * Nothing in Langgol branches on this value to decide whether an action is allowed — that is the
 * policy engine's job, and it reads roles and ownership, never progress.
 *
 * Stated this plainly because a progress enum is the most natural thing in the world to start
 * gating on, and the first `if (status !== 'FULLY_ONBOARDED')` would undo the entire point of a
 * progressive flow.
 *
 * ## Derived from facts, not accumulated by events
 *
 * `deriveOnboardingState` is a pure function of what is true about the account right now. The
 * stored column is a cache of that answer, kept for querying — "how many users stalled after
 * verifying their phone?" is a question worth being able to ask in SQL.
 *
 * The alternative, a field each flow remembers to advance, is the arrangement where the one
 * screen that forgets leaves a user permanently mislabelled, and nothing ever notices because the
 * value is only read by a dashboard.
 *
 * ## Monotone against what is stored
 *
 * `advanceOnboardingState` never moves anybody backwards. Somebody who completed their profile
 * and later cleared an optional field has not become un-onboarded, and demoting them would
 * re-trigger a setup flow they have already finished.
 *
 * Refs: docs/01_MVP_REQUIREMENTS.md §79; docs/07_SECURITY.md §4
 */

import type { OnboardingFacts } from './steps.js'

/**
 * The milestones, in the order they are reached.
 *
 * `KYC_PENDING` sits between the profile being finished and the identity being confirmed, which
 * is the only place a submitted-but-unjudged document can honestly go. It is a state somebody can
 * sit in indefinitely without consequence, because identity verification is optional.
 *
 * `FULLY_ONBOARDED` therefore means everything INCLUDING the optional identity check. It is a
 * description of a complete account, not a requirement — most healthy accounts will never reach
 * it, and that is fine.
 */
export const ONBOARDING_STATES = [
  'REGISTERED',
  'PHONE_VERIFIED',
  'ROLE_SELECTED',
  'PROFILE_STARTED',
  'PROFILE_COMPLETED',
  'KYC_PENDING',
  'KYC_VERIFIED',
  'FULLY_ONBOARDED',
] as const
export type OnboardingState = (typeof ONBOARDING_STATES)[number]

export const isOnboardingState = (value: unknown): value is OnboardingState =>
  typeof value === 'string' && (ONBOARDING_STATES as readonly string[]).includes(value)

const ORDER: ReadonlyMap<OnboardingState, number> = new Map(
  ONBOARDING_STATES.map((state, index) => [state, index]),
)

export const onboardingRank = (state: OnboardingState): number => ORDER.get(state) ?? 0

/**
 * The furthest milestone this account has actually reached.
 *
 * Written as a descending ladder rather than a chain of increments, so that adding a state means
 * inserting one clause instead of rewiring the transitions around it. Each rung states the whole
 * condition for being at that rung, which is also what makes the table readable as a definition.
 */
export function deriveOnboardingState(facts: OnboardingFacts): OnboardingState {
  const hasRole = facts.roles.length > 0
  const basics = facts.hasConfirmedName && facts.phoneVerified && hasRole

  // Everything, including the optional identity check.
  if (basics && facts.roleProfileComplete && facts.kycStatus === 'VERIFIED') {
    return 'FULLY_ONBOARDED'
  }

  /*
   * Verified identity, but something else still outstanding.
   *
   * Reachable, and worth distinguishing: somebody may verify their identity early and leave their
   * role questionnaire half done, and calling that `PROFILE_STARTED` would hide the strongest
   * thing they have proved.
   */
  if (basics && facts.kycStatus === 'VERIFIED') return 'KYC_VERIFIED'

  // Submitted, nobody has decided yet. Not a problem state — the queue is a human one.
  if (basics && facts.kycStatus === 'PENDING') return 'KYC_PENDING'

  if (basics && facts.roleProfileComplete) return 'PROFILE_COMPLETED'

  /*
   * Something beyond the bare minimum has been filled in.
   *
   * Deliberately generous about what counts: a location, a farm, or anything saved on the role
   * questionnaire. The point of the state is to distinguish somebody who has begun from somebody
   * who signed up and stopped, and all three are beginning.
   */
  if (basics && (facts.roleProfileStarted || facts.hasLocation || facts.hasFarm)) {
    return 'PROFILE_STARTED'
  }

  if (hasRole && facts.phoneVerified) return 'ROLE_SELECTED'
  if (facts.phoneVerified) return 'PHONE_VERIFIED'
  return 'REGISTERED'
}

/**
 * The value to store, given what is already stored.
 *
 * Monotone: the higher of the two wins. See the note at the top about why demotion is wrong.
 */
export function advanceOnboardingState(
  stored: OnboardingState,
  earned: OnboardingState,
): OnboardingState {
  return onboardingRank(earned) > onboardingRank(stored) ? earned : stored
}

/**
 * Map a value stored under the old four-state vocabulary onto the new one.
 *
 * `PROFILE_COMPLETE` and `READY` were the previous spellings. Kept as a function rather than
 * done once in a migration because a row written by an older deployment mid-rollout must still
 * read correctly, and because it makes the mapping testable.
 */
export function migrateLegacyState(value: string): OnboardingState {
  switch (value) {
    case 'PROFILE_COMPLETE':
      return 'PROFILE_COMPLETED'
    case 'READY':
      return 'FULLY_ONBOARDED'
    default:
      return isOnboardingState(value) ? value : 'REGISTERED'
  }
}
