/**
 * Role profile use-case tests.
 *
 * "Each role must only be able to manage its own profile" is two separate claims, and both are
 * tested here:
 *
 *  1. You may only touch a profile for a role you actually hold.
 *  2. You may only touch YOUR OWN — guaranteed by there being no subject parameter to abuse.
 *
 * Every one of the six roles is exercised, because a table-driven implementation fails in exactly
 * one place: the role somebody forgot to add to the table.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor, type Role } from '@langgol/domain/policy'
import { PROFILE_ROLES, type ProfileRole } from '@langgol/domain/profiles'
import { isErr, isOk } from '@langgol/shared'
import { getMyRoleProfile, updateMyRoleProfile, type RoleProfileDeps } from './role-profile.js'
import type { RoleProfileRecord } from '../../ports/role-profile.js'

const ME = 'a0000000-0000-4000-8000-00000000000a'
const NOW = new Date('2026-08-30T09:00:00.000Z')

/** An address in MY book, and one in somebody else's. Both are well-formed UUIDs. */
const MY_ADDRESS = 'b0000000-0000-4000-8000-00000000000b'
const THEIR_ADDRESS = 'c0000000-0000-4000-8000-00000000000c'

const actorWith = (...roles: Role[]): Actor => ({ userId: ME, roles, status: 'ACTIVE' })

function record(role: ProfileRole, fields: Record<string, unknown> = {}): RoleProfileRecord {
  return {
    id: `profile-${role}`,
    userId: ME,
    role,
    verificationStatus: 'UNVERIFIED',
    fields,
    serviceAreaIds: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function harness(stored: Partial<Record<ProfileRole, RoleProfileRecord>> = {}) {
  const audit = vi.fn(async (_line: { reason?: string; action?: string }) => undefined)
  const state = { ...stored }

  // Ownership is a database question, so the fake answers it the way the database would: my one
  // address is mine, and everything else — including a real address belonging to someone else —
  // is not.
  const ownsAddress = vi.fn(
    async (userId: string, addressId: string) => userId === ME && addressId === MY_ADDRESS,
  )

  const update = vi.fn(
    async (userId: string, role: ProfileRole, changes: Record<string, unknown>) => {
      const current = state[role]
      if (current === undefined || userId !== ME) return null
      const next = { ...current, fields: { ...current.fields, ...changes } }
      state[role] = next
      return next
    },
  )

  const replaceAreas = vi.fn(async (_u: string, role: ProfileRole, ids: readonly string[]) => {
    const current = state[role]
    if (current !== undefined) state[role] = { ...current, serviceAreaIds: [...ids] }
    return [...ids]
  })

  const ensure = vi.fn(async (_u: string, role: ProfileRole) => {
    const created = record(role)
    state[role] = created
    return created
  })

  return {
    audit,
    update,
    ensure,
    replaceAreas,
    ownsAddress,
    state,
    deps: {
      clock: { now: () => NOW },
      audit: { record: audit },
      profiles: {
        findForUser: async (userId: string, role: ProfileRole) =>
          userId === ME ? (state[role] ?? null) : null,
        ensureForUser: ensure,
        updateForUser: update,
        replaceServiceAreas: replaceAreas,
        ownsAddress,
      },
    } as unknown as RoleProfileDeps,
  }
}

let h: ReturnType<typeof harness>
beforeEach(() => {
  h = harness()
})

describe('every role can reach its own profile', () => {
  it.each(PROFILE_ROLES)('%s opens theirs', async (role) => {
    /*
     * Table-driven code fails at the entry somebody forgot, so every role is exercised rather
     * than a representative one.
     */
    const result = await getMyRoleProfile(actorWith(role as Role), role, h.deps)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.profile.role).toBe(role)
  })

  it('creates an empty profile on first read rather than 404ing a real user', async () => {
    // A role is granted from several places; requiring each to insert a row means the one that
    // forgets produces a user who cannot open their own settings.
    const result = await getMyRoleProfile(actorWith('SUPPLIER'), 'SUPPLIER', h.deps)
    expect(isOk(result)).toBe(true)
    expect(h.ensure).toHaveBeenCalledWith(ME, 'SUPPLIER', NOW)
  })

  it('reports completion against the role’s own fields', async () => {
    const result = await getMyRoleProfile(actorWith('CONSUMER'), 'CONSUMER', h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.completion.percent).toBe(0)
    expect(result.value.completion.total).toBeGreaterThan(0)
  })
})

describe('a role you do not hold is refused', () => {
  it('refuses a consumer asking for the wholesaler profile', async () => {
    /*
     * Not answered with an empty profile. Answering would quietly raise the question of what
     * happens when they PATCH it.
     */
    const result = await getMyRoleProfile(actorWith('CONSUMER'), 'WHOLESALER', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
    expect(h.ensure).not.toHaveBeenCalled()
  })

  it('refuses every role the actor does not hold', async () => {
    const consumer = actorWith('CONSUMER')
    for (const role of PROFILE_ROLES.filter((r) => r !== 'CONSUMER')) {
      expect(isErr(await getMyRoleProfile(consumer, role, h.deps))).toBe(true)
    }
  })

  it('refuses a write to a role the actor does not hold', async () => {
    const seeded = harness({ WHOLESALER: record('WHOLESALER') })
    const result = await updateMyRoleProfile(
      actorWith('CONSUMER'),
      'WHOLESALER',
      { fields: { businessName: 'Not mine' } },
      seeded.deps,
    )
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
    expect(seeded.update).not.toHaveBeenCalled()
  })

  it('checks the actor’s LIVE roles, not anything stored on the profile', async () => {
    /*
     * A retailer whose role was revoked this morning must not still be editing a retailer profile
     * this afternoon — so the gate reads the session's roles, not the row's existence.
     */
    const seeded = harness({ RETAILER: record('RETAILER', { businessName: 'Old Shop' }) })
    const revoked = actorWith('CONSUMER') // once a retailer, no longer

    expect(isErr(await getMyRoleProfile(revoked, 'RETAILER', seeded.deps))).toBe(true)
    expect(isErr(await updateMyRoleProfile(revoked, 'RETAILER', { fields: {} }, seeded.deps))).toBe(
      true,
    )
  })

  it('refuses an unknown role outright', async () => {
    const result = await getMyRoleProfile(actorWith('FARMER'), 'FARMER', h.deps)
    // FARMER has its own richer profile; it is not one of these six.
    expect(isErr(result)).toBe(true)
  })
})

describe('who may reach a profile at all', () => {
  it('refuses an anonymous caller', async () => {
    const result = await getMyRoleProfile(ANONYMOUS, 'CONSUMER', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('refuses a suspended account', async () => {
    const suspended: Actor = { userId: ME, roles: ['RETAILER'], status: 'SUSPENDED' }
    expect(isErr(await getMyRoleProfile(suspended, 'RETAILER', h.deps))).toBe(true)
  })

  it('gives an administrator no way to reach somebody else’s profile', async () => {
    /*
     * There is no subject parameter and no `profile:manage-any` action, so an admin holding only
     * ADMIN is refused every one of the six — the guarantee is an absent capability rather than a
     * check that could be forgotten.
     */
    const admin = actorWith('ADMIN')
    for (const role of PROFILE_ROLES) {
      expect(isErr(await getMyRoleProfile(admin, role, h.deps))).toBe(true)
    }
  })
})

describe('writing a profile', () => {
  it('saves a valid change', async () => {
    const seeded = harness({ RETAILER: record('RETAILER', { businessName: 'Old' }) })
    const result = await updateMyRoleProfile(
      actorWith('RETAILER'),
      'RETAILER',
      { fields: { businessName: 'Rahim Store', tin: '123456789012' } },
      seeded.deps,
    )

    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.value.profile.fields['businessName']).toBe('Rahim Store')
      expect(result.value.profile.fields['tin']).toBe('123456789012')
    }
  })

  it('rejects a malformed document without writing anything', async () => {
    const seeded = harness({ SUPPLIER: record('SUPPLIER', { companyName: 'Seed Co' }) })
    const result = await updateMyRoleProfile(
      actorWith('SUPPLIER'),
      'SUPPLIER',
      { fields: { tin: '999' } },
      seeded.deps,
    )

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(seeded.update).not.toHaveBeenCalled()
  })

  it('drops a field belonging to another role', async () => {
    // The descriptor table is the allowlist, so a retailer cannot write a consultation fee.
    const seeded = harness({ RETAILER: record('RETAILER', { businessName: 'Rahim Store' }) })
    await updateMyRoleProfile(
      actorWith('RETAILER'),
      'RETAILER',
      { fields: { businessType: 'GROCERY', consultationFeePoisha: '5000' } },
      seeded.deps,
    )

    const written = seeded.update.mock.calls[0]?.[2] ?? {}
    expect(Object.keys(written)).toEqual(['businessType'])
  })

  it('replaces service areas wholesale for a role that has them', async () => {
    const seeded = harness({ LOGISTICS_PROVIDER: record('LOGISTICS_PROVIDER') })
    const result = await updateMyRoleProfile(
      actorWith('LOGISTICS_PROVIDER'),
      'LOGISTICS_PROVIDER',
      { fields: {}, serviceAreaIds: ['area-1', 'area-2'] },
      seeded.deps,
    )

    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.profile.serviceAreaIds).toEqual(['area-1', 'area-2'])
  })

  it('says not-found rather than creating a profile on write', async () => {
    // Read is total; write is not. A PATCH with no profile is a caller that skipped the read.
    const result = await updateMyRoleProfile(
      actorWith('EXPERT' as Role, 'AGRICULTURAL_EXPERT'),
      'AGRICULTURAL_EXPERT',
      { fields: {} },
      h.deps,
    )
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('an address on a profile must be the caller’s own', () => {
  /*
   * The IDOR this closes: `default_address_id` and `address_id` are bare UUID columns that a form
   * can now write. Without an ownership check somebody could point their own profile at an
   * address id they guessed and read a stranger's recipient name and phone number straight back
   * out of their own settings screen.
   *
   * Tested at this layer because this is the layer that can answer it. The domain validates the
   * SHAPE of an id and has no database to ask whose it is.
   */

  it('accepts an address the caller owns', async () => {
    const h2 = harness({ CONSUMER: record('CONSUMER') })
    const result = await updateMyRoleProfile(
      actorWith('CONSUMER'),
      'CONSUMER',
      { fields: { defaultAddressId: MY_ADDRESS } },
      h2.deps,
    )

    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.profile.fields['defaultAddressId']).toBe(MY_ADDRESS)
  })

  it('refuses an address belonging to somebody else, and writes nothing', async () => {
    const h2 = harness({ CONSUMER: record('CONSUMER') })
    const result = await updateMyRoleProfile(
      actorWith('CONSUMER'),
      'CONSUMER',
      { fields: { defaultAddressId: THEIR_ADDRESS } },
      h2.deps,
    )

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error.code).toBe('VALIDATION_FAILED')
      expect(result.error.meta['field']).toBe('defaultAddressId')
    }
    // The refusal has to happen BEFORE the write, not be cleaned up after one.
    expect(h2.update).not.toHaveBeenCalled()
  })

  it('gives the same answer for a stranger’s address and a made-up one', async () => {
    /*
     * Distinguishing them would confirm that an id exists, which is exactly the question somebody
     * probing for other people's addresses is asking. Both come back as the same code.
     */
    const h2 = harness({ CONSUMER: record('CONSUMER') })
    const stranger = await updateMyRoleProfile(
      actorWith('CONSUMER'),
      'CONSUMER',
      { fields: { defaultAddressId: THEIR_ADDRESS } },
      h2.deps,
    )
    const nonsense = await updateMyRoleProfile(
      actorWith('CONSUMER'),
      'CONSUMER',
      { fields: { defaultAddressId: 'd0000000-0000-4000-8000-00000000000d' } },
      h2.deps,
    )

    if (!isErr(stranger) || !isErr(nonsense)) throw new Error('expected both to fail')
    expect(nonsense.error.meta['code']).toBe(stranger.error.meta['code'])
  })

  it('checks the address for every role that stores one', async () => {
    // Retailer, wholesaler and supplier all keep an address, and a table-driven check fails at
    // the entry somebody forgot.
    for (const role of ['RETAILER', 'WHOLESALER', 'SUPPLIER'] as const) {
      const h2 = harness({ [role]: record(role) })
      const result = await updateMyRoleProfile(
        actorWith(role as Role),
        role,
        { fields: { addressId: THEIR_ADDRESS } },
        h2.deps,
      )
      expect(isErr(result), `${role} accepted a stranger’s address`).toBe(true)
    }
  })

  it('leaves the address alone when the form does not mention it', async () => {
    // Clearing an address nobody asked to clear is the other half of the same bug.
    const h2 = harness({ RETAILER: record('RETAILER', { addressId: MY_ADDRESS }) })
    const result = await updateMyRoleProfile(
      actorWith('RETAILER'),
      'RETAILER',
      { fields: { businessName: 'Karim Store' } },
      h2.deps,
    )

    expect(isOk(result)).toBe(true)
    expect(h2.ownsAddress).not.toHaveBeenCalled()
    if (isOk(result)) expect(result.value.profile.fields['addressId']).toBe(MY_ADDRESS)
  })
})

describe('what reaches the audit log', () => {
  it('names the fields that changed, never their values', async () => {
    /*
     * A trade licence copied into an audit row would spread it into a table with a different
     * retention policy. The names are what an investigation needs.
     */
    const seeded = harness({ RETAILER: record('RETAILER', { businessName: 'Old' }) })
    await updateMyRoleProfile(
      actorWith('RETAILER'),
      'RETAILER',
      { fields: { tradeLicence: 'TRAD/DNCC/012345/2024' } },
      seeded.deps,
    )

    const line = JSON.stringify(seeded.audit.mock.calls[0]?.[0])
    expect(line).toContain('tradeLicence')
    expect(line).not.toContain('012345')
  })

  it('writes nothing when the form was submitted unchanged', async () => {
    const seeded = harness({ RETAILER: record('RETAILER', { businessName: 'Rahim Store' }) })
    await updateMyRoleProfile(
      actorWith('RETAILER'),
      'RETAILER',
      { fields: { businessName: 'Rahim Store' } },
      seeded.deps,
    )
    expect(seeded.audit).not.toHaveBeenCalled()
  })
})

describe('verification status', () => {
  it('cannot be set through the profile, whatever is submitted', async () => {
    // A self-attested verification is not a verification.
    const seeded = harness({ RETAILER: record('RETAILER', { businessName: 'Rahim Store' }) })
    const result = await updateMyRoleProfile(
      actorWith('RETAILER'),
      'RETAILER',
      { fields: { verificationStatus: 'VERIFIED' } },
      seeded.deps,
    )

    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.profile.verificationStatus).toBe('UNVERIFIED')
    expect(seeded.update).not.toHaveBeenCalled()
  })
})
