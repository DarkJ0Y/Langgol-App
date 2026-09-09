/**
 * Profile completion, calculated so the number means something.
 *
 * A percentage on a dashboard is a promise: it says "this much of what matters is done". Most
 * implementations break that promise in one of four ways, and each is a real bug rather than a
 * matter of taste. They are listed here because the code below exists to prevent them, and
 * because a future edit that reintroduces one should be recognisable as a regression.
 *
 * ## 1. Counting steps that do not apply
 *
 * The commonest and the worst. A consumer measured against "add your farm" is permanently stuck
 * below full, having done everything asked of them, with no action available that would move the
 * number. Only `applicableSteps` are counted, so every user has a reachable hundred.
 *
 * ## 2. Weighting every step the same
 *
 * If a national identity check and a preferred-language setting each move the bar by the same
 * amount, the bar is measuring form fields rather than readiness. Tiers carry weights, so
 * verifying a phone number counts for more than ticking an optional box — which is also the
 * honest incentive, because it is genuinely more useful.
 *
 * ## 3. Reaching a hundred with something required outstanding
 *
 * A rounding artefact is enough to do it: 99.6 per cent displays as 100 while the phone number is
 * still unverified. The number is clamped so that full means full.
 *
 * ## 4. Going down
 *
 * A percentage that falls when a user adds information is a percentage nobody trusts again. Every
 * satisfied step only ever adds weight, so the figure is monotone in progress by construction.
 *
 * Refs: docs/01_MVP_REQUIREMENTS.md §79
 */

import {
  STEP_TIERS,
  applicableSteps,
  type OnboardingFacts,
  type OnboardingStep,
  type StepDescriptor,
  type StepTier,
} from './steps.js'

/**
 * What each tier is worth.
 *
 * The ratios matter, not the absolute numbers. Required is worth five times an optional step
 * because it is the difference between an account that works and one that does not; recommended
 * sits between because it is the difference between working and working well.
 *
 * A consequence worth stating: doing every optional step while leaving a required one undone
 * cannot reach full, whatever the mix. That is arithmetic rather than a special case, and the
 * clamp below is belt to its braces.
 */
const TIER_WEIGHT: Record<StepTier, number> = {
  REQUIRED: 5,
  RECOMMENDED: 3,
  OPTIONAL: 1,
}

/** One step, as a screen renders it. */
export interface StepStatus {
  readonly step: OnboardingStep
  readonly tier: StepTier
  readonly done: boolean
  readonly href: string
}

export interface TierProgress {
  readonly tier: StepTier
  readonly done: number
  readonly total: number
}

export interface OnboardingCompletion {
  /** The headline figure. Never 100 while anything required is outstanding. */
  readonly percent: number
  /** Steps that apply to this user, done and not. */
  readonly steps: readonly StepStatus[]
  readonly completed: readonly StepStatus[]
  readonly recommended: readonly StepStatus[]
  readonly optional: readonly StepStatus[]
  readonly byTier: readonly TierProgress[]
  /**
   * Every REQUIRED step is done.
   *
   * The only flag in this module that could sensibly gate anything, and nothing uses it that way.
   * It exists so a screen can say "your account is ready" honestly while the percentage is still
   * well short of full.
   */
  readonly readyToUse: boolean
  /** Nothing applicable is outstanding. */
  readonly complete: boolean
}

function statusOf(descriptor: StepDescriptor, facts: OnboardingFacts): StepStatus {
  return {
    step: descriptor.step,
    tier: descriptor.tier,
    done: descriptor.satisfiedBy(facts),
    href: descriptor.href,
  }
}

/**
 * Work out how far along somebody is.
 *
 * Pure and total: every user, including one who has just registered and one holding no role at
 * all, gets a defined answer. A user with no roles is measured only against the steps that apply
 * to everybody, which is exactly the three required ones.
 */
export function onboardingCompletion(facts: OnboardingFacts): OnboardingCompletion {
  const descriptors = applicableSteps(facts.roles)
  const steps = descriptors.map((descriptor) => statusOf(descriptor, facts))

  let earned = 0
  let available = 0
  for (const status of steps) {
    const weight = TIER_WEIGHT[status.tier]
    available += weight
    if (status.done) earned += weight
  }

  const requiredOutstanding = steps.some((status) => status.tier === 'REQUIRED' && !status.done)
  const allDone = steps.every((status) => status.done)

  /*
   * `available` is zero only if the step table ever became empty for some role. Reporting zero
   * rather than dividing is the honest answer, and it is a defined one.
   */
  const raw = available === 0 ? 0 : Math.round((earned / available) * 100)

  /*
   * A hundred means finished, and nothing else does.
   *
   * Both directions are pinned. A complete set reports exactly 100 rather than whatever the
   * weights happen to round to, because telling somebody who has done everything that they are at
   * 99 per cent is a bar they can never clear. An incomplete set is held below 100 rather than
   * rounding up to it, because a full bar with the phone number still unverified is a lie the
   * user acts on.
   */
  const percent = allDone ? 100 : Math.min(raw, 99)

  return {
    percent,
    steps,
    completed: steps.filter((status) => status.done),
    // Outstanding only. A screen showing "recommended" wants the things still to do, not a list
    // that mixes them with what is already ticked.
    recommended: steps.filter((status) => !status.done && status.tier !== 'OPTIONAL'),
    optional: steps.filter((status) => !status.done && status.tier === 'OPTIONAL'),
    byTier: STEP_TIERS.map((tier) => ({
      tier,
      done: steps.filter((status) => status.tier === tier && status.done).length,
      total: steps.filter((status) => status.tier === tier).length,
    })),
    readyToUse: !requiredOutstanding,
    complete: allDone,
  }
}
