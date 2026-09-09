/**
 * Onboarding use-case tests.
 *
 * The domain tests prove the step table and the arithmetic. These prove the two things only this
 * layer can get wrong: that a stored state never pulls somebody backwards, and that the cached
 * column is written when it should be and left alone when it should not.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor, type Role } from '@langgol/domain/policy'
import { NO_PROGRESS, type OnboardingFacts } from '@langgol/domain/onboarding'
import { isErr, isOk } from '@langgol/shared'
import { myOnboarding, refreshOnboardingState, type OnboardingDeps } from './onboarding.js'

const ME = 'a0000000-0000-4000-8000-00000000000a'

const actor = (...roles: Role[]): Actor => ({ userId: ME, roles, status: 'ACTIVE' })

const facts = (overrides: Partial<OnboardingFacts> = {}): OnboardingFacts => ({
  ...NO_PROGRESS,
  ...overrides,
})

function harness(value: OnboardingFacts | null = facts()) {
  const recordState = vi.fn(async (_userId: string, _state: string) => undefined)
  const factsForUser = vi.fn(async (userId: string) => (userId === ME ? value : null))

  return {
    recordState,
    factsForUser,
    deps: { onboarding: { factsForUser, recordState } } as unknown as OnboardingDeps,
  }
}

let h: ReturnType<typeof harness>
beforeEach(() => {
  h = harness()
})

describe('reading your own onboarding position', () => {
  it('refuses an anonymous caller', async () => {
    expect(isErr(await myOnboarding(ANONYMOUS, h.deps))).toBe(true)
  })

  it('takes no subject, so it cannot describe somebody else', () => {
    // How much of an account a stranger has filled in is a small disclosure, and the guarantee is
    // that there is no argument to make it with.
    expect(myOnboarding).toHaveLength(3)
  })

  it('reports nothing for a caller with no account behind them', async () => {
    const missing = harness(null)
    expect(isErr(await myOnboarding(actor('FARMER'), missing.deps))).toBe(true)
  })

  it('returns a state, a percentage and something to do', async () => {
    const result = await myOnboarding(actor('FARMER'), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(result.value.state).toBe('REGISTERED')
    expect(result.value.completion.percent).toBe(0)
    expect(result.value.prompts.length).toBeGreaterThan(0)
  })
})

describe('the stored state never pulls somebody backwards', () => {
  it('keeps the higher of stored and derived', async () => {
    /*
     * The KYC flow can carry a user to KYC_VERIFIED. If they later clear an optional field, the
     * derivation drops — and demoting them would re-trigger a flow they finished.
     */
    const barely = harness(facts({ phoneVerified: true }))
    const result = await myOnboarding(actor('FARMER'), barely.deps, 'KYC_VERIFIED')

    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.state).toBe('KYC_VERIFIED')
  })

  it('advances when the derivation is further along', async () => {
    const ahead = harness(facts({ phoneVerified: true, roles: ['FARMER'] }))
    const result = await myOnboarding(actor('FARMER'), ahead.deps, 'REGISTERED')

    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.state).toBe('ROLE_SELECTED')
  })

  it('reads a row written under the vocabulary this phase replaced', async () => {
    // `READY` was the old spelling of the final milestone. A row written by an older deployment
    // mid-rollout must not read as an unknown value and silently reset somebody to the start.
    const ahead = harness(facts({ phoneVerified: true }))
    const result = await myOnboarding(actor('FARMER'), ahead.deps, 'READY')

    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.state).toBe('FULLY_ONBOARDED')
  })

  it('falls back to the derivation for a value it cannot read at all', async () => {
    const ahead = harness(facts({ phoneVerified: true }))
    const result = await myOnboarding(actor('FARMER'), ahead.deps, 'NONSENSE')

    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.state).toBe('PHONE_VERIFIED')
  })
})

describe('refreshing the cached state', () => {
  it('writes when the user has moved along', async () => {
    const moved = harness(facts({ phoneVerified: true, roles: ['FARMER'] }))
    const result = await refreshOnboardingState(actor('FARMER'), moved.deps, 'REGISTERED')

    expect(isOk(result)).toBe(true)
    expect(moved.recordState).toHaveBeenCalledWith(ME, 'ROLE_SELECTED')
  })

  it('writes nothing when they have not', async () => {
    // A no-op write is a row version, an audit trigger and a replication event for nothing.
    const same = harness(facts({ phoneVerified: true }))
    await refreshOnboardingState(actor('FARMER'), same.deps, 'PHONE_VERIFIED')

    expect(same.recordState).not.toHaveBeenCalled()
  })

  it('writes nothing when the stored value is already further along', async () => {
    const behind = harness(facts({ phoneVerified: true }))
    await refreshOnboardingState(actor('FARMER'), behind.deps, 'FULLY_ONBOARDED')

    expect(behind.recordState).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller', async () => {
    expect(isErr(await refreshOnboardingState(ANONYMOUS, h.deps, 'REGISTERED'))).toBe(true)
  })
})

describe('what the platform does with the answer', () => {
  it('says an account is usable long before it is complete', async () => {
    /*
     * The claim this whole phase rests on. A user with the three required steps done can use
     * everything; nothing in the platform reads `state` or `percent` to decide otherwise.
     */
    const ready = harness(facts({ hasConfirmedName: true, phoneVerified: true, roles: ['FARMER'] }))
    const result = await myOnboarding(actor('FARMER'), ready.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(result.value.completion.readyToUse).toBe(true)
    expect(result.value.completion.complete).toBe(false)
    expect(result.value.completion.percent).toBeLessThan(100)
  })

  it('offers a farmer the farm prompt once the basics are done', async () => {
    const ready = harness(facts({ hasConfirmedName: true, phoneVerified: true, roles: ['FARMER'] }))
    const result = await myOnboarding(actor('FARMER'), ready.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(result.value.prompts.map((prompt) => prompt.step)).toContain('FARM')
  })

  it('falls silent once there is nothing left to suggest', async () => {
    const done = harness(
      facts({
        hasConfirmedName: true,
        phoneVerified: true,
        roles: ['FARMER'],
        hasLocation: true,
        hasFarm: true,
        hasCurrentCrop: true,
        roleProfileComplete: true,
        kycStatus: 'VERIFIED',
      }),
    )
    const result = await myOnboarding(actor('FARMER'), done.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(result.value.prompts).toHaveLength(0)
    expect(result.value.state).toBe('FULLY_ONBOARDED')
    expect(result.value.completion.percent).toBe(100)
  })
})
