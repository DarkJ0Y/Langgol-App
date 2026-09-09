/**
 * Where somebody is in onboarding, and what is worth doing next.
 *
 * ## This use case grants nothing and withholds nothing
 *
 * It reads. There is no branch anywhere in the platform that consults the result to decide whether
 * an action is permitted, and adding one would undo the entire point of a progressive flow. The
 * policy engine decides what a user may do, from roles and ownership; this decides what to
 * suggest.
 *
 * ## Save-and-continue is the absence of a wizard
 *
 * Nothing here holds partial state, because there is no partial state to hold. Every step is an
 * ordinary form that saves on its own — the address book, the farmer questionnaire, the role
 * profile, the identity submission — and the checklist is a view over what those forms have
 * already stored. Somebody who fills in two fields and closes the browser has saved two fields.
 *
 * That is worth stating because the usual implementation is the opposite: a multi-page wizard
 * holding a draft, which loses everything when a farmer's connection drops between page three and
 * page four. Here there is no draft to lose.
 *
 * Refs: docs/01_MVP_REQUIREMENTS.md §79; docs/03_ARCHITECTURE.md §4
 */

import {
  advanceOnboardingState,
  deriveOnboardingState,
  isOnboardingState,
  migrateLegacyState,
  onboardingCompletion,
  onboardingPrompts,
  type OnboardingCompletion,
  type OnboardingPrompt,
  type OnboardingState,
} from '@langgol/domain/onboarding'
import { isActor, type MaybeActor } from '@langgol/domain/policy'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { OnboardingRepository } from '../../ports/index.js'

export interface OnboardingDeps {
  readonly onboarding: OnboardingRepository
}

export interface OnboardingView {
  readonly state: OnboardingState
  readonly completion: OnboardingCompletion
  readonly prompts: readonly OnboardingPrompt[]
}

/**
 * The caller's own onboarding position.
 *
 * Takes no subject. The person being described is the signed-in actor, so there is no argument
 * that could be pointed at somebody else's progress — which would be a small disclosure of how
 * much of their account a stranger had filled in.
 *
 * No permission check beyond authentication, deliberately. There is no `onboarding:read-own`
 * action because the alternative is an action that can only ever be granted to everybody, and the
 * policy vocabulary is more useful when every entry in it can meaningfully be refused.
 */
export async function myOnboarding(
  actor: MaybeActor,
  deps: OnboardingDeps,
  storedState?: string,
): Promise<Result<OnboardingView, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const facts = await deps.onboarding.factsForUser(actor.userId)
  if (facts === null) return err(Errors.notFound('Account'))

  const derived = deriveOnboardingState(facts)

  /*
   * The stored value only ever raises the answer, never lowers it.
   *
   * Somebody who verified their identity and later cleared an optional field has not become less
   * onboarded, and a screen that said so would re-trigger a flow they finished. `migrateLegacyState`
   * handles a row written under the four-state vocabulary this phase replaced.
   */
  const state =
    storedState === undefined
      ? derived
      : advanceOnboardingState(
          isOnboardingState(storedState) ? storedState : migrateLegacyState(storedState),
          derived,
        )

  return ok({
    state,
    completion: onboardingCompletion(facts),
    prompts: onboardingPrompts(facts),
  })
}

/**
 * Refresh the cached state on the user row.
 *
 * Called after something that plausibly moved somebody along. Best-effort by design: the stored
 * column is a convenience for querying, and failing to update it must never fail the action that
 * triggered it. A farmer who has just added a farm should not see an error because a progress
 * counter could not be written.
 */
export async function refreshOnboardingState(
  actor: MaybeActor,
  deps: OnboardingDeps,
  storedState: string,
): Promise<Result<OnboardingState, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const facts = await deps.onboarding.factsForUser(actor.userId)
  if (facts === null) return err(Errors.notFound('Account'))

  const previous = isOnboardingState(storedState) ? storedState : migrateLegacyState(storedState)
  const next = advanceOnboardingState(previous, deriveOnboardingState(facts))

  if (next !== previous) await deps.onboarding.recordState(actor.userId, next)

  return ok(next)
}
