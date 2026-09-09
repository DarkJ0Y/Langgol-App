/**
 * What to suggest next, and why it is worth doing.
 *
 * ## Every prompt names a benefit, never a deficiency
 *
 * "Add your farm to receive crop advice for your area" and "Your profile is 40% complete" are the
 * same fact and completely different messages. The first offers something; the second withholds
 * approval. On a platform whose users are being asked to hand over information about their land
 * and their livelihood, the difference decides whether they do.
 *
 * So a prompt is a promise the platform then has to keep. Nothing is listed here whose benefit is
 * vague or invented — a step earns a prompt by unlocking something specific and real, and if it
 * does not, it should not be prompted at all.
 *
 * ## Few, and in the right order
 *
 * A dashboard with seven suggestions is a dashboard with none. Prompts come out ordered by tier
 * and capped, so what somebody sees is the next useful thing rather than a backlog. The rest stay
 * on the checklist, where a person who wants the whole list can find it.
 *
 * The words themselves live in the i18n catalogues, keyed by step, because this module owns which
 * benefit is true and the interface owns how to say it in Bangla.
 */

import { onboardingCompletion, type StepStatus } from './completion.js'
import type { OnboardingFacts, OnboardingStep, StepTier } from './steps.js'

export interface OnboardingPrompt {
  readonly step: OnboardingStep
  readonly tier: StepTier
  readonly href: string
  /**
   * The i18n key for the benefit sentence.
   *
   * `onboarding.prompt<Step>` by convention, so a step added to the table gets a prompt by adding
   * a translation rather than by editing this file.
   */
  readonly messageKey: string
}

/**
 * How many to show at once.
 *
 * Three is enough to offer a choice and few enough to read. A person who has done nothing sees
 * their three required steps; a person nearly finished sees whatever is genuinely left.
 */
export const MAX_PROMPTS = 3

const TIER_ORDER: Record<StepTier, number> = { REQUIRED: 0, RECOMMENDED: 1, OPTIONAL: 2 }

const messageKeyFor = (step: OnboardingStep): string => {
  const camel = step
    .split('_')
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : `${part.charAt(0)}${part.slice(1).toLowerCase()}`,
    )
    .join('')
  return `onboarding.prompt${camel.charAt(0).toUpperCase()}${camel.slice(1)}`
}

function toPrompt(status: StepStatus): OnboardingPrompt {
  return {
    step: status.step,
    tier: status.tier,
    href: status.href,
    messageKey: messageKeyFor(status.step),
  }
}

/**
 * The next things worth doing.
 *
 * Sorted by tier and then by the order the step table declares, which is the order the flow
 * itself presents them — so somebody working down the list is following the same path as somebody
 * going through onboarding for the first time.
 *
 * A KYC submission that is still being reviewed produces NO prompt. Telling somebody to verify
 * their identity when they already have, and are waiting, is the message that makes a product
 * feel like it is not listening.
 */
export function onboardingPrompts(
  facts: OnboardingFacts,
  limit: number = MAX_PROMPTS,
): readonly OnboardingPrompt[] {
  const { steps } = onboardingCompletion(facts)

  const outstanding = steps
    .filter((status) => !status.done)
    .filter((status) => !(status.step === 'KYC' && facts.kycStatus === 'PENDING'))

  // A stable sort by tier alone preserves the table's own order within each tier, which is the
  // flow order. No secondary comparison is needed, and adding one would be a second place for the
  // ordering to be decided.
  const ordered = [...outstanding].sort(
    (left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier],
  )

  return ordered.slice(0, Math.max(limit, 0)).map(toPrompt)
}

/**
 * The single most useful next thing, or null when there is nothing left.
 *
 * For surfaces with room for one line — a banner, a notification, the top of a dashboard.
 */
export function nextBestAction(facts: OnboardingFacts): OnboardingPrompt | null {
  return onboardingPrompts(facts, 1)[0] ?? null
}
