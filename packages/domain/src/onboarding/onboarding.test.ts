/**
 * Progressive onboarding tests.
 *
 * The completion tests are written as invariants rather than as examples, because a percentage is
 * a promise and the ways it gets broken are structural: counting steps that do not apply,
 * weighting everything the same, rounding up to a full bar, or going down when somebody adds
 * information. Each has a test that exercises it across the whole space rather than at one point.
 *
 * The journey test at the bottom walks a farmer from registration to a complete profile one step
 * at a time, which is the thing a user actually experiences and the thing no unit test of a single
 * function would catch.
 */

import { describe, expect, it } from 'vitest'
import {
  NO_PROGRESS,
  ONBOARDING_STEPS,
  ROLES_AFFECTING_STEPS,
  STEP_DESCRIPTORS,
  STEP_TIERS,
  applicableSteps,
  type OnboardingFacts,
} from './steps.js'
import { onboardingCompletion } from './completion.js'
import {
  ONBOARDING_STATES,
  advanceOnboardingState,
  deriveOnboardingState,
  migrateLegacyState,
  onboardingRank,
} from './states.js'
import { nextBestAction, onboardingPrompts } from './prompts.js'

const facts = (overrides: Partial<OnboardingFacts> = {}): OnboardingFacts => ({
  ...NO_PROGRESS,
  ...overrides,
})

/** Every required step done, and nothing else. The state a usable account is in. */
const usable = (role: string): OnboardingFacts =>
  facts({ hasConfirmedName: true, phoneVerified: true, roles: [role] })

/** Everything applicable done, for a farmer. */
const farmerComplete: OnboardingFacts = facts({
  hasConfirmedName: true,
  phoneVerified: true,
  roles: ['FARMER'],
  hasLocation: true,
  hasFarm: true,
  hasCurrentCrop: true,
  roleProfileStarted: true,
  roleProfileComplete: true,
  kycStatus: 'VERIFIED',
})

/* ==================================================================== steps */

describe('the step table', () => {
  it('covers the steps the specification names', () => {
    expect([...ONBOARDING_STEPS]).toEqual([
      'BASIC_PROFILE',
      'PHONE_VERIFICATION',
      'ROLE',
      'LOCATION',
      'ROLE_PROFILE',
      'FARM',
      'CURRENT_CROP',
      'KYC',
    ])
  })

  it('gives every step a descriptor, so adding one cannot be half done', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(STEP_DESCRIPTORS[step], step).toBeDefined()
      expect(STEP_TIERS).toContain(STEP_DESCRIPTORS[step].tier)
    }
  })

  it('requires only three things, and they are the three an account cannot work without', () => {
    /*
     * The number that matters most in this phase. Every step marked REQUIRED is a step somebody
     * must complete before the platform is useful to them, and a fourth would be a wall.
     */
    const required = ONBOARDING_STEPS.filter((step) => STEP_DESCRIPTORS[step].tier === 'REQUIRED')
    expect([...required]).toEqual(['BASIC_PROFILE', 'PHONE_VERIFICATION', 'ROLE'])
  })

  it('never asks a consumer about a farm', () => {
    const steps = applicableSteps(['CONSUMER']).map((descriptor) => descriptor.step)
    expect(steps).not.toContain('FARM')
    expect(steps).not.toContain('CURRENT_CROP')
  })

  it('asks a farmer about a farm', () => {
    const steps = applicableSteps(['FARMER']).map((descriptor) => descriptor.step)
    expect(steps).toContain('FARM')
    expect(steps).toContain('CURRENT_CROP')
  })

  it('gives every role at least the required steps', () => {
    // A role whose applicable set was empty would divide by zero and report a meaningless figure.
    for (const role of ROLES_AFFECTING_STEPS) {
      const steps = applicableSteps([role])
      expect(steps.length, role).toBeGreaterThanOrEqual(3)
    }
  })

  it('does not count a submitted identity document as verified', () => {
    // Submitted is not proven. A checklist that ticked on submission would tell somebody they had
    // finished while a reviewer had not yet looked.
    expect(STEP_DESCRIPTORS.KYC.satisfiedBy(facts({ kycStatus: 'PENDING' }))).toBe(false)
    expect(STEP_DESCRIPTORS.KYC.satisfiedBy(facts({ kycStatus: 'VERIFIED' }))).toBe(true)
  })
})

/* =============================================================== completion */

describe('the completion percentage is logically correct', () => {
  it('is zero for somebody who has just registered', () => {
    expect(onboardingCompletion(NO_PROGRESS).percent).toBe(0)
  })

  it('reaches exactly a hundred when everything applicable is done', () => {
    expect(onboardingCompletion(farmerComplete).percent).toBe(100)
    expect(onboardingCompletion(farmerComplete).complete).toBe(true)
  })

  it('is reachable for every role, not only for farmers', () => {
    /*
     * The commonest bug in a completion bar: a consumer measured against a farm is stuck below
     * full having done everything asked of them, with no action that would move the number.
     */
    for (const role of ROLES_AFFECTING_STEPS) {
      const everything = facts({
        hasConfirmedName: true,
        phoneVerified: true,
        roles: [role],
        hasLocation: true,
        hasFarm: true,
        hasCurrentCrop: true,
        roleProfileStarted: true,
        roleProfileComplete: true,
        kycStatus: 'VERIFIED',
      })
      expect(onboardingCompletion(everything).percent, role).toBe(100)
    }
  })

  it('never reports a hundred while something required is outstanding', () => {
    /*
     * Exhaustive over every combination of the optional and recommended facts, with the phone
     * unverified throughout. Rounding must never round up into a full bar.
     */
    const flags = [true, false]
    for (const hasLocation of flags) {
      for (const hasFarm of flags) {
        for (const hasCurrentCrop of flags) {
          for (const roleProfileComplete of flags) {
            const value = onboardingCompletion(
              facts({
                hasConfirmedName: true,
                // The required step that is missing.
                phoneVerified: false,
                roles: ['FARMER'],
                hasLocation,
                hasFarm,
                hasCurrentCrop,
                roleProfileComplete,
                kycStatus: 'VERIFIED',
              }),
            )
            expect(value.percent).toBeLessThan(100)
            expect(value.complete).toBe(false)
            expect(value.readyToUse).toBe(false)
          }
        }
      }
    }
  })

  it('weights a required step above an optional one', () => {
    // Otherwise the bar measures form fields rather than readiness, and the incentive points the
    // wrong way: ticking an optional box would look like proving a phone number.
    const withRequired = onboardingCompletion(facts({ roles: ['FARMER'], hasConfirmedName: true }))
    const withOptional = onboardingCompletion(
      facts({ roles: ['FARMER'], hasCurrentCrop: true, kycStatus: 'VERIFIED' }),
    )
    expect(withRequired.percent).toBeGreaterThan(withOptional.percent)
  })

  it('never goes down when somebody adds information', () => {
    /*
     * Monotonicity, walked over the whole journey. A percentage that falls after a user fills
     * something in is a percentage nobody trusts again.
     */
    const journey: OnboardingFacts[] = [
      NO_PROGRESS,
      facts({ phoneVerified: true }),
      facts({ phoneVerified: true, hasConfirmedName: true }),
      facts({ phoneVerified: true, hasConfirmedName: true, roles: ['FARMER'] }),
      facts({ phoneVerified: true, hasConfirmedName: true, roles: ['FARMER'], hasLocation: true }),
      facts({
        phoneVerified: true,
        hasConfirmedName: true,
        roles: ['FARMER'],
        hasLocation: true,
        hasFarm: true,
      }),
      farmerComplete,
    ]

    let previous = -1
    for (const step of journey) {
      const percent = onboardingCompletion(step).percent
      expect(percent).toBeGreaterThanOrEqual(previous)
      previous = percent
    }
  })

  it('says an account is ready as soon as the required steps are done', () => {
    /*
     * The honest middle ground. Somebody with three of eight steps done is genuinely able to use
     * the platform, and the screen has to be able to say so without claiming they are finished.
     */
    const value = onboardingCompletion(usable('FARMER'))
    expect(value.readyToUse).toBe(true)
    expect(value.complete).toBe(false)
    expect(value.percent).toBeLessThan(100)
  })

  it('separates what is done from what is merely suggested', () => {
    const value = onboardingCompletion(usable('FARMER'))

    expect(value.completed.map((entry) => entry.step).sort()).toEqual([
      'BASIC_PROFILE',
      'PHONE_VERIFICATION',
      'ROLE',
    ])
    // Outstanding only — a "recommended" list that included finished steps would be a checklist
    // of things already ticked.
    expect(value.recommended.every((entry) => !entry.done)).toBe(true)
    expect(value.optional.every((entry) => entry.tier === 'OPTIONAL')).toBe(true)
  })

  it('counts each applicable step exactly once across the three buckets', () => {
    const value = onboardingCompletion(usable('FARMER'))
    const bucketed = value.completed.length + value.recommended.length + value.optional.length
    expect(bucketed).toBe(value.steps.length)
  })

  it('gives a defined answer for somebody holding no role at all', () => {
    /*
     * Reached between registering and choosing a role. A crash or a NaN here is a blank dashboard
     * on the very first screen somebody sees.
     *
     * They are measured against the role-independent steps: the three required ones, plus
     * location and identity, which apply to everybody whatever they do. The role-specific ones
     * are absent because no role has been chosen to make them apply.
     */
    const value = onboardingCompletion(facts({ phoneVerified: true }))

    expect(Number.isFinite(value.percent)).toBe(true)
    expect(value.steps.map((entry) => entry.step).sort()).toEqual([
      'BASIC_PROFILE',
      'KYC',
      'LOCATION',
      'PHONE_VERIFICATION',
      'ROLE',
    ])
    // And a role-specific step is not among them, so nobody is measured against a farm before
    // they have said they farm.
    expect(value.steps.map((entry) => entry.step)).not.toContain('FARM')
  })
})

/* =================================================================== states */

describe('onboarding states', () => {
  it('covers the eight the specification names', () => {
    expect([...ONBOARDING_STATES]).toEqual([
      'REGISTERED',
      'PHONE_VERIFIED',
      'ROLE_SELECTED',
      'PROFILE_STARTED',
      'PROFILE_COMPLETED',
      'KYC_PENDING',
      'KYC_VERIFIED',
      'FULLY_ONBOARDED',
    ])
  })

  it('starts at registered', () => {
    expect(deriveOnboardingState(NO_PROGRESS)).toBe('REGISTERED')
  })

  it('advances through the flow the specification describes', () => {
    expect(deriveOnboardingState(facts({ phoneVerified: true }))).toBe('PHONE_VERIFIED')

    expect(deriveOnboardingState(facts({ phoneVerified: true, roles: ['FARMER'] }))).toBe(
      'ROLE_SELECTED',
    )

    expect(
      deriveOnboardingState(
        facts({
          phoneVerified: true,
          hasConfirmedName: true,
          roles: ['FARMER'],
          hasLocation: true,
        }),
      ),
    ).toBe('PROFILE_STARTED')

    expect(
      deriveOnboardingState(
        facts({
          phoneVerified: true,
          hasConfirmedName: true,
          roles: ['FARMER'],
          roleProfileComplete: true,
        }),
      ),
    ).toBe('PROFILE_COMPLETED')

    expect(deriveOnboardingState(farmerComplete)).toBe('FULLY_ONBOARDED')
  })

  it('distinguishes a submitted document from a verified one', () => {
    const submitted = facts({
      phoneVerified: true,
      hasConfirmedName: true,
      roles: ['FARMER'],
      kycStatus: 'PENDING',
    })
    expect(deriveOnboardingState(submitted)).toBe('KYC_PENDING')

    expect(deriveOnboardingState({ ...submitted, kycStatus: 'VERIFIED' })).toBe('KYC_VERIFIED')
  })

  it('reaches fully onboarded only with the optional identity check done', () => {
    // The specification puts KYC_VERIFIED before FULLY_ONBOARDED, so full means everything —
    // including the step that is optional. Most healthy accounts will never reach it.
    const withoutKyc: OnboardingFacts = { ...farmerComplete, kycStatus: 'NONE' }
    expect(deriveOnboardingState(withoutKyc)).not.toBe('FULLY_ONBOARDED')
  })

  it('never moves an account backwards', () => {
    /*
     * Somebody who finished onboarding and later cleared an optional field has not become
     * un-onboarded, and demoting them would re-trigger a flow they already completed.
     */
    expect(advanceOnboardingState('FULLY_ONBOARDED', 'REGISTERED')).toBe('FULLY_ONBOARDED')
    expect(advanceOnboardingState('REGISTERED', 'ROLE_SELECTED')).toBe('ROLE_SELECTED')
    expect(advanceOnboardingState('KYC_VERIFIED', 'KYC_VERIFIED')).toBe('KYC_VERIFIED')
  })

  it('orders the states so monotonicity means something', () => {
    for (let index = 1; index < ONBOARDING_STATES.length; index += 1) {
      const previous = ONBOARDING_STATES[index - 1]
      const current = ONBOARDING_STATES[index]
      if (previous === undefined || current === undefined) throw new Error('fixture')
      expect(onboardingRank(current)).toBeGreaterThan(onboardingRank(previous))
    }
  })

  it('maps the four states that were stored before this phase', () => {
    // A row written by an older deployment mid-rollout must still read correctly.
    expect(migrateLegacyState('REGISTERED')).toBe('REGISTERED')
    expect(migrateLegacyState('ROLE_SELECTED')).toBe('ROLE_SELECTED')
    expect(migrateLegacyState('PROFILE_COMPLETE')).toBe('PROFILE_COMPLETED')
    expect(migrateLegacyState('READY')).toBe('FULLY_ONBOARDED')
  })

  it('falls back to registered for a value it does not recognise', () => {
    expect(migrateLegacyState('SOMETHING_ELSE')).toBe('REGISTERED')
  })
})

/* ================================================================== prompts */

describe('contextual prompts', () => {
  it('offers the required steps first', () => {
    const prompts = onboardingPrompts(NO_PROGRESS)
    expect(prompts.every((prompt) => prompt.tier === 'REQUIRED')).toBe(true)
  })

  it('names a benefit key for every step, so a prompt is never a bare deficiency', () => {
    const prompts = onboardingPrompts(usable('FARMER'), 10)
    for (const prompt of prompts) {
      expect(prompt.messageKey).toMatch(/^onboarding\.prompt[A-Z]/)
      expect(prompt.href.startsWith('/')).toBe(true)
    }
  })

  it('shows a farmer the farm and crop prompts once the basics are done', () => {
    const prompts = onboardingPrompts(usable('FARMER'), 10).map((prompt) => prompt.step)
    expect(prompts).toContain('FARM')
    expect(prompts).toContain('CURRENT_CROP')
  })

  it('never shows a consumer a farm prompt', () => {
    const prompts = onboardingPrompts(usable('CONSUMER'), 10).map((prompt) => prompt.step)
    expect(prompts).not.toContain('FARM')
    expect(prompts).not.toContain('CURRENT_CROP')
  })

  it('stops asking for an identity document that is already being reviewed', () => {
    /*
     * Telling somebody to verify their identity when they have and are waiting is the message
     * that makes a product feel like it is not listening.
     */
    const waiting = facts({
      hasConfirmedName: true,
      phoneVerified: true,
      roles: ['FARMER'],
      kycStatus: 'PENDING',
    })
    expect(onboardingPrompts(waiting, 10).map((prompt) => prompt.step)).not.toContain('KYC')
  })

  it('shows no more than three at once', () => {
    // A dashboard with seven suggestions is a dashboard with none.
    expect(onboardingPrompts(NO_PROGRESS).length).toBeLessThanOrEqual(3)
  })

  it('falls silent when there is nothing left to suggest', () => {
    expect(onboardingPrompts(farmerComplete)).toHaveLength(0)
    expect(nextBestAction(farmerComplete)).toBeNull()
  })

  it('offers the single most useful thing for a one-line surface', () => {
    const action = nextBestAction(NO_PROGRESS)
    expect(action?.tier).toBe('REQUIRED')
  })
})

/* ================================================================== journey */

describe('the complete onboarding journey', () => {
  /*
   * The flow the specification describes, walked one step at a time. Each stage asserts the three
   * things a user would notice: what state they are in, whether the platform is usable, and what
   * it is suggesting they do next.
   *
   * The property running through all of it is that `readyToUse` turns true a third of the way
   * along and never turns off again — everything after that point is genuinely optional.
   */
  it('takes a farmer from registration to a complete profile without ever blocking them', () => {
    let current: OnboardingFacts = NO_PROGRESS

    // 1. Registered. Nothing proved yet.
    expect(deriveOnboardingState(current)).toBe('REGISTERED')
    expect(onboardingCompletion(current).readyToUse).toBe(false)

    // 2. Phone verified.
    current = { ...current, phoneVerified: true }
    expect(deriveOnboardingState(current)).toBe('PHONE_VERIFIED')

    // 3. Basic profile — a name they confirmed rather than one defaulted.
    current = { ...current, hasConfirmedName: true }
    expect(onboardingCompletion(current).readyToUse).toBe(false)

    // 4. Role selected. This is the moment the account becomes usable.
    current = { ...current, roles: ['FARMER'] }
    expect(deriveOnboardingState(current)).toBe('ROLE_SELECTED')
    expect(onboardingCompletion(current).readyToUse).toBe(true)

    // From here nothing is required. Everything below only improves the experience.
    const readyPercent = onboardingCompletion(current).percent
    expect(readyPercent).toBeGreaterThan(0)
    expect(readyPercent).toBeLessThan(100)

    // 5. Location.
    current = { ...current, hasLocation: true }
    expect(deriveOnboardingState(current)).toBe('PROFILE_STARTED')
    expect(onboardingCompletion(current).percent).toBeGreaterThan(readyPercent)

    // 6. Farm.
    current = { ...current, hasFarm: true }
    expect(onboardingCompletion(current).readyToUse).toBe(true)

    // 7. Current crop — optional, and the platform worked without it throughout.
    current = { ...current, hasCurrentCrop: true }

    // 8. Optional identity check, submitted then approved.
    current = { ...current, kycStatus: 'PENDING' }
    expect(deriveOnboardingState(current)).toBe('KYC_PENDING')
    expect(onboardingCompletion(current).readyToUse).toBe(true)

    current = { ...current, kycStatus: 'VERIFIED', roleProfileComplete: true }
    expect(deriveOnboardingState(current)).toBe('FULLY_ONBOARDED')

    const finished = onboardingCompletion(current)
    expect(finished.percent).toBe(100)
    expect(finished.complete).toBe(true)
    expect(onboardingPrompts(current)).toHaveLength(0)
  })

  it('takes a consumer to a complete profile without ever mentioning a farm', () => {
    let current: OnboardingFacts = facts({ roles: ['CONSUMER'] })

    current = { ...current, phoneVerified: true, hasConfirmedName: true }
    expect(onboardingCompletion(current).readyToUse).toBe(true)

    current = { ...current, hasLocation: true, roleProfileComplete: true, kycStatus: 'VERIFIED' }

    const finished = onboardingCompletion(current)
    expect(finished.percent).toBe(100)
    expect(finished.steps.map((entry) => entry.step)).not.toContain('FARM')
  })
})
