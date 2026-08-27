/**
 * Farmer profile use-case tests.
 *
 * The interesting cases are the authorization ones. A farmer profile is the one resource in the
 * system whose very existence depends on holding a role, so "a consumer asks for /farmers/me" is
 * not an exotic edge — it is what happens the first time somebody shares a link.
 *
 * The audit assertions matter as much as the happy path: an audit line naming a field the farmer
 * did not touch is a false statement in the record, and nothing downstream can detect it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import { EMPTY_FARMING_FIELDS } from '@langgol/domain/farming'
import { isErr, isOk } from '@langgol/shared'
import {
  getMyFarmerProfile,
  updateMyFarmerProfile,
  type FarmerProfileDeps,
} from './farmer-profile.js'
import type { FarmerProfileRecord } from '../../ports/farming.js'

const FARMER_ID = 'a0000000-0000-4000-8000-000000000001'

const farmer: Actor = { userId: FARMER_ID, roles: ['FARMER'], status: 'ACTIVE' }
const consumer: Actor = { userId: FARMER_ID, roles: ['CONSUMER'], status: 'ACTIVE' }
const admin: Actor = {
  userId: 'b0000000-0000-4000-8000-000000000002',
  roles: ['ADMIN'],
  status: 'ACTIVE',
}

const NOW = new Date('2026-08-27T09:00:00.000Z')

function record(over: Partial<FarmerProfileRecord> = {}): FarmerProfileRecord {
  return {
    ...EMPTY_FARMING_FIELDS,
    id: 'c0000000-0000-4000-8000-000000000003',
    userId: FARMER_ID,
    displayName: 'করিম মিয়া',
    bio: null,
    verificationStatus: 'UNVERIFIED',
    verifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

interface Harness {
  readonly deps: FarmerProfileDeps
  readonly audit: ReturnType<typeof vi.fn>
  readonly update: ReturnType<typeof vi.fn>
  readonly ensure: ReturnType<typeof vi.fn>
}

function harness(stored: FarmerProfileRecord | null): Harness {
  const audit = vi.fn(async () => undefined)
  const ensure = vi.fn(async () => record())
  const update = vi.fn(async (_userId: string, changes: Partial<FarmerProfileRecord>) =>
    record({ ...(stored ?? {}), ...changes }),
  )

  return {
    audit,
    ensure,
    update,
    deps: {
      clock: { now: () => NOW },
      audit: { record: audit },
      farmers: {
        findByUserId: async () => stored,
        ensureForUser: ensure,
        updateForUser: update,
      },
    } as unknown as FarmerProfileDeps,
  }
}

let h: Harness
beforeEach(() => {
  h = harness(record())
})

describe('reading my farmer profile', () => {
  it('returns the profile and how complete it is', async () => {
    const result = await getMyFarmerProfile(farmer, h.deps)
    expect(isOk(result)).toBe(true)
    if (!isOk(result)) return
    expect(result.value.profile.userId).toBe(FARMER_ID)
    expect(result.value.completion.percent).toBe(0)
  })

  it('creates an empty profile the first time, rather than 404ing a real farmer', async () => {
    /*
     * The FARMER role is granted in several places — signup, /auth/role, an admin grant, a seed.
     * Requiring each of them to remember to insert a profile row means the one that forgets
     * produces a farmer who cannot open their own dashboard.
     */
    const fresh = harness(null)
    const result = await getMyFarmerProfile(farmer, fresh.deps)

    expect(isOk(result)).toBe(true)
    expect(fresh.ensure).toHaveBeenCalledWith({ userId: FARMER_ID, now: NOW })
  })

  it('creates a profile that claims nothing about the farmer', async () => {
    // An auto-created row must not assert answers nobody gave.
    const fresh = harness(null)
    const result = await getMyFarmerProfile(farmer, fresh.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(result.value.profile.farmingExperienceYears).toBeNull()
    expect(result.value.profile.irrigationAvailable).toBeNull()
    expect(result.value.completion.percent).toBe(0)
  })

  it('refuses an anonymous caller', async () => {
    const result = await getMyFarmerProfile(ANONYMOUS, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('refuses a signed-in user who is not a farmer', async () => {
    // A consumer has no farmer profile. Answering with an empty one would quietly raise the
    // question of what happens when they PATCH it.
    const result = await getMyFarmerProfile(consumer, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses an admin, because /farmers/me means the caller', async () => {
    /*
     * There is no `farmer:read-any` action, so an administrator has nothing to reach another
     * farmer's profile WITH. That is the guarantee — an absent action rather than a check
     * somewhere that could be forgotten.
     */
    const result = await getMyFarmerProfile(admin, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses a suspended farmer', async () => {
    const suspended: Actor = { ...farmer, status: 'SUSPENDED' }
    const result = await getMyFarmerProfile(suspended, h.deps)
    expect(isErr(result)).toBe(true)
  })
})

describe('updating my farmer profile', () => {
  it('saves a valid change', async () => {
    const result = await updateMyFarmerProfile(farmer, { farmingExperienceYears: 12 }, h.deps)

    expect(isOk(result)).toBe(true)
    expect(h.update).toHaveBeenCalledWith(FARMER_ID, { farmingExperienceYears: 12 })
  })

  it('rejects a value outside the vocabulary', async () => {
    const result = await updateMyFarmerProfile(farmer, { farmerType: 'TRACTOR' }, h.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('rejects an implausible experience', async () => {
    const result = await updateMyFarmerProfile(farmer, { farmingExperienceYears: 1975 }, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('rejects a contradiction that spans this edit and the stored one', async () => {
    /*
     * Validation runs against the merged state, so saving DRIP and then switching irrigation off
     * cannot reach, in two legal-looking steps, a state neither step could reach directly.
     */
    const stored = harness(record({ irrigationAvailable: true, irrigationMethod: 'DRIP' }))
    const result = await updateMyFarmerProfile(farmer, { irrigationAvailable: false }, stored.deps)

    expect(isErr(result)).toBe(true)
    expect(stored.update).not.toHaveBeenCalled()
  })

  it('refuses a non-farmer', async () => {
    const result = await updateMyFarmerProfile(consumer, { farmingExperienceYears: 3 }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses an anonymous caller', async () => {
    const result = await updateMyFarmerProfile(ANONYMOUS, { farmingExperienceYears: 3 }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('says not-found rather than creating a profile on write', async () => {
    // Read is total; write is not. A PATCH against a profile that does not exist is a caller
    // that skipped the read, and inventing a row to satisfy it would hide that.
    const missing = harness(null)
    const result = await updateMyFarmerProfile(farmer, { farmingExperienceYears: 3 }, missing.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('what the audit log records', () => {
  it('names only the fields that actually changed', async () => {
    /*
     * The form posts every question on every save. Recording the submitted set would put a line
     * in the audit log saying a farmer edited their land area when they only picked an
     * irrigation method — and an investigator would read that as a true statement.
     */
    const stored = harness(
      record({ farmingExperienceYears: 12, totalLandAmountMilli: 2000, landUnit: 'BIGHA' }),
    )

    await updateMyFarmerProfile(
      farmer,
      {
        farmingExperienceYears: 12,
        totalLandAmountMilli: 2000,
        landUnit: 'BIGHA',
        farmingMethod: 'ORGANIC',
      },
      stored.deps,
    )

    expect(stored.audit).toHaveBeenCalledTimes(1)
    expect(stored.audit.mock.calls[0]?.[0]).toMatchObject({ reason: 'farmingMethod' })
  })

  it('never copies the values into the audit row', async () => {
    // Field names are what an investigation needs; the figures belong to a table with a
    // different retention policy.
    await updateMyFarmerProfile(farmer, { totalLandAmountMilli: 2500, landUnit: 'BIGHA' }, h.deps)

    expect(JSON.stringify(h.audit.mock.calls[0]?.[0])).not.toContain('2500')
  })

  it('writes nothing at all when the form was submitted unchanged', async () => {
    const stored = harness(record({ farmingExperienceYears: 12 }))
    const result = await updateMyFarmerProfile(farmer, { farmingExperienceYears: 12 }, stored.deps)

    expect(isOk(result)).toBe(true)
    expect(stored.update).not.toHaveBeenCalled()
    expect(stored.audit).not.toHaveBeenCalled()
  })
})
