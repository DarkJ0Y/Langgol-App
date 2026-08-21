/**
 * Account and role use-case tests.
 *
 * These assert the behaviours Phase 1 exists to guarantee: a user holds many roles, only an
 * administrator changes them, a removal is explained, and nobody edits anyone else's profile.
 *
 * The in-memory `FakeAccounts` reproduces the real adapter's *semantics* — revocation keeps
 * history rather than deleting, re-granting reactivates, and every read filters revoked rows.
 * A permissive fake would let these tests pass while the invariant that matters went untested.
 */

import { describe, expect, it } from 'vitest'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import type {
  AccountRepository,
  AuditPort,
  Clock,
  RoleAssignmentRecord,
  RoleDefinitionRecord,
  UserProfileRecord,
} from '../../ports/index.js'
import { getCurrentUser, updateCurrentUser } from './profile.js'
import { assignRole, getUserRoles, listRoles, removeRole } from './roles.js'

const NOW = new Date('2026-08-20T10:00:00.000Z')
const clock: Clock = { now: () => NOW }

const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const FARMER_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'

function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: FARMER_ID, roles: ['FARMER'], status: 'ACTIVE', ...overrides }
}

const admin = actor({ userId: ADMIN_ID, roles: ['ADMIN'] })

/* ------------------------------------------------------------------- fakes */

interface Assignment {
  role: string
  grantedAt: Date
  grantedById: string | null
  revokedAt: Date | null
  revokedById: string | null
  revokeReason: string | null
}

class FakeAccounts implements AccountRepository {
  readonly assignments = new Map<string, Assignment[]>()
  readonly profiles = new Map<string, UserProfileRecord>()

  constructor() {
    this.profiles.set(FARMER_ID, {
      id: FARMER_ID,
      phone: '+8801700000001',
      phoneVerifiedAt: NOW,
      email: null,
      emailVerifiedAt: null,
      fullName: 'Rahim Uddin',
      preferredLanguage: 'BN',
      status: 'ACTIVE',
      onboardingStatus: 'ROLE_SELECTED',
      profilePhotoKey: null,
      dateOfBirth: null,
      gender: null,
      roles: ['FARMER'],
      lastLoginAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })
    this.assignments.set(FARMER_ID, [
      {
        role: 'FARMER',
        grantedAt: NOW,
        grantedById: null,
        revokedAt: null,
        revokedById: null,
        revokeReason: null,
      },
    ])
  }

  private live(userId: string): Assignment[] {
    return (this.assignments.get(userId) ?? []).filter((entry) => entry.revokedAt === null)
  }

  findProfile(userId: string): Promise<UserProfileRecord | null> {
    const profile = this.profiles.get(userId)
    if (!profile) return Promise.resolve(null)
    return Promise.resolve({ ...profile, roles: this.live(userId).map((entry) => entry.role) })
  }

  markEmailVerified({
    userId,
    email,
    at,
  }: Parameters<AccountRepository['markEmailVerified']>[0]): Promise<boolean> {
    const profile = this.profiles.get(userId)
    // Conditional on the address still matching, exactly as the SQL is.
    if (!profile || profile.email !== email) return Promise.resolve(false)
    this.profiles.set(userId, { ...profile, emailVerifiedAt: at })
    return Promise.resolve(true)
  }

  updateProfile(
    userId: string,
    changes: Parameters<AccountRepository['updateProfile']>[1],
  ): Promise<UserProfileRecord | null> {
    const profile = this.profiles.get(userId)
    if (!profile) return Promise.resolve(null)
    const updated: UserProfileRecord = {
      ...profile,
      ...(changes.fullName !== undefined ? { fullName: changes.fullName } : {}),
      ...(changes.email !== undefined ? { email: changes.email, emailVerifiedAt: null } : {}),
      ...(changes.preferredLanguage !== undefined
        ? { preferredLanguage: changes.preferredLanguage }
        : {}),
      ...(changes.dateOfBirth !== undefined ? { dateOfBirth: changes.dateOfBirth } : {}),
      ...(changes.gender !== undefined ? { gender: changes.gender } : {}),
      ...(changes.profilePhotoKey !== undefined
        ? { profilePhotoKey: changes.profilePhotoKey }
        : {}),
      ...(changes.onboardingStatus !== undefined
        ? { onboardingStatus: changes.onboardingStatus }
        : {}),
      updatedAt: NOW,
    }
    this.profiles.set(userId, updated)
    return Promise.resolve(updated)
  }

  listRoleDefinitions(): Promise<readonly RoleDefinitionRecord[]> {
    return Promise.resolve([
      {
        role: 'FARMER',
        nameBn: 'কৃষক',
        nameEn: 'Farmer',
        descriptionBn: '',
        descriptionEn: '',
        selfSelectable: true,
        privileged: false,
        sortOrder: 10,
      },
      {
        role: 'WHOLESALER',
        nameBn: 'পাইকার',
        nameEn: 'Wholesaler',
        descriptionBn: '',
        descriptionEn: '',
        selfSelectable: false,
        privileged: false,
        sortOrder: 40,
      },
      {
        role: 'ADMIN',
        nameBn: 'প্রশাসক',
        nameEn: 'Administrator',
        descriptionBn: '',
        descriptionEn: '',
        selfSelectable: false,
        privileged: true,
        sortOrder: 90,
      },
    ])
  }

  listRolesFor(userId: string): Promise<readonly RoleAssignmentRecord[]> {
    return Promise.resolve(
      this.live(userId).map((entry) => ({
        role: entry.role,
        grantedAt: entry.grantedAt,
        grantedById: entry.grantedById,
        selfSelected: entry.grantedById === null,
      })),
    )
  }

  assignRole(input: Parameters<AccountRepository['assignRole']>[0]) {
    const rows = this.assignments.get(input.userId) ?? []
    const existing = rows.find((entry) => entry.role === input.role)

    let added = false
    if (!existing) {
      rows.push({
        role: input.role,
        grantedAt: input.at,
        grantedById: input.grantedById,
        revokedAt: null,
        revokedById: null,
        revokeReason: null,
      })
      added = true
    } else if (existing.revokedAt !== null) {
      // Reactivate the same row, exactly as the Prisma adapter does.
      existing.revokedAt = null
      existing.revokedById = null
      existing.revokeReason = null
      existing.grantedById = input.grantedById
      existing.grantedAt = input.at
      added = true
    }

    this.assignments.set(input.userId, rows)
    return Promise.resolve({ roles: this.live(input.userId).map((e) => e.role), added })
  }

  revokeRole(input: Parameters<AccountRepository['revokeRole']>[0]) {
    const rows = this.assignments.get(input.userId) ?? []
    const target = rows.find((entry) => entry.role === input.role && entry.revokedAt === null)

    if (target) {
      target.revokedAt = input.at
      target.revokedById = input.revokedById
      target.revokeReason = input.reason
    }

    return Promise.resolve({
      roles: this.live(input.userId).map((e) => e.role),
      removed: target !== undefined,
    })
  }
}

class FakeAudit implements AuditPort {
  readonly entries: { action: string; entityId: string; reason?: string }[] = []
  record(input: Parameters<AuditPort['record']>[0]): Promise<void> {
    this.entries.push({
      action: input.action,
      entityId: input.entityId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    })
    return Promise.resolve()
  }
}

function harness() {
  const accounts = new FakeAccounts()
  const audit = new FakeAudit()
  return { accounts, audit, deps: { clock, accounts, audit } }
}

/* ------------------------------------------------------------------- tests */

describe('role creation and listing', () => {
  it('lists the catalogue for any signed-in user', async () => {
    const { deps } = harness()
    const result = await listRoles(actor(), deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.definitions).toHaveLength(3)
  })

  it('separates the roles a user may pick from the ones they may not', async () => {
    const { deps } = harness()
    const result = await listRoles(actor(), deps)
    if (!result.ok) return

    expect(result.value.selfSelectable.map((d) => d.role)).toEqual(['FARMER'])
    // ADMIN and WHOLESALER are in the catalogue but must never be offered as a choice.
    expect(result.value.selfSelectable.map((d) => d.role)).not.toContain('ADMIN')
    expect(result.value.selfSelectable.map((d) => d.role)).not.toContain('WHOLESALER')
  })

  it('refuses an anonymous caller', async () => {
    const { deps } = harness()
    const result = await listRoles(ANONYMOUS, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNAUTHENTICATED')
  })
})

describe('role assignment', () => {
  it('lets an administrator grant a role', async () => {
    const { deps } = harness()
    const result = await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.added).toBe(true)
    expect(result.value.roles).toContain('WHOLESALER')
  })

  it('records who granted it', async () => {
    const { deps, accounts } = harness()
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)

    const roles = await accounts.listRolesFor(FARMER_ID)
    const granted = roles.find((entry) => entry.role === 'WHOLESALER')
    expect(granted?.grantedById).toBe(ADMIN_ID)
    // The original FARMER role was self-selected, and stays distinguishable from a granted one.
    expect(roles.find((entry) => entry.role === 'FARMER')?.selfSelected).toBe(true)
  })

  it('is idempotent — granting twice is not an error', async () => {
    const { deps } = harness()
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)
    const second = await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.added).toBe(false)
    expect(second.value.roles.filter((r) => r === 'WHOLESALER')).toHaveLength(1)
  })

  it('audits the grant', async () => {
    const { deps, audit } = harness()
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)
    expect(audit.entries.map((e) => e.action)).toContain('ROLE_ASSIGNED')
  })

  it('refuses a role the platform does not recognise', async () => {
    const { deps } = harness()
    const result = await assignRole(admin, { targetUserId: FARMER_ID, role: 'SUPERUSER' }, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('a user holds many roles', () => {
  it('accumulates roles rather than replacing them', async () => {
    // The requirement that rules out a single `user.role` column.
    const { deps } = harness()
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'AGRICULTURAL_EXPERT' }, deps)
    const result = await assignRole(
      admin,
      { targetUserId: FARMER_ID, role: 'LOGISTICS_PROVIDER' },
      deps,
    )

    if (!result.ok) return
    expect([...result.value.roles].sort()).toEqual([
      'AGRICULTURAL_EXPERT',
      'FARMER',
      'LOGISTICS_PROVIDER',
      'WHOLESALER',
    ])
  })

  it('reports every held role through getUserRoles', async () => {
    const { deps } = harness()
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'SUPPLIER' }, deps)

    const result = await getUserRoles(actor(), FARMER_ID, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.roles.map((r) => r.role).sort()).toEqual(['FARMER', 'SUPPLIER'])
  })
})

describe('role removal', () => {
  it('removes a role and keeps the rest', async () => {
    const { deps } = harness()
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)

    const result = await removeRole(
      admin,
      { targetUserId: FARMER_ID, role: 'WHOLESALER', reason: 'Trade licence expired' },
      deps,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.removed).toBe(true)
    expect(result.value.roles).toEqual(['FARMER'])
  })

  it('requires a reason — an unexplained revocation can lock a farmer out', async () => {
    const { deps } = harness()
    const result = await removeRole(
      admin,
      { targetUserId: FARMER_ID, role: 'FARMER', reason: '   ' },
      deps,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('is idempotent — removing a role they do not hold is not an error', async () => {
    const { deps } = harness()
    const result = await removeRole(
      admin,
      { targetUserId: FARMER_ID, role: 'SUPPLIER', reason: 'Never held' },
      deps,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.removed).toBe(false)
  })

  it('keeps history: a re-granted role reactivates rather than duplicating', async () => {
    const { deps, accounts } = harness()
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)
    await removeRole(
      admin,
      { targetUserId: FARMER_ID, role: 'WHOLESALER', reason: 'Suspended' },
      deps,
    )
    await assignRole(admin, { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)

    const rows = accounts.assignments.get(FARMER_ID) ?? []
    expect(rows.filter((r) => r.role === 'WHOLESALER')).toHaveLength(1)
    const roles = await accounts.listRolesFor(FARMER_ID)
    expect(roles.map((r) => r.role)).toContain('WHOLESALER')
  })

  it('refuses an administrator removing their OWN privileged role', async () => {
    // The last administrator revoking their own ADMIN locks everyone out of the platform.
    const { deps } = harness()
    const result = await removeRole(
      admin,
      { targetUserId: ADMIN_ID, role: 'ADMIN', reason: 'Stepping down' },
      deps,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
  })
})

describe('unauthorized role modification', () => {
  it('refuses a farmer granting themselves a role', async () => {
    const { deps } = harness()
    const result = await assignRole(actor(), { targetUserId: FARMER_ID, role: 'WHOLESALER' }, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses a farmer granting themselves ADMIN, and audits the attempt', async () => {
    // The single most important test here. A refused privilege grab is worth knowing about
    // precisely because it failed.
    const { deps, audit } = harness()
    const result = await assignRole(actor(), { targetUserId: FARMER_ID, role: 'ADMIN' }, deps)

    expect(result.ok).toBe(false)
    expect(audit.entries.map((e) => e.action)).toContain('ROLE_ASSIGN_REJECTED')
  })

  it('refuses an OPS_AGENT granting roles — assisting is not administering', async () => {
    const { deps } = harness()
    const ops = actor({ roles: ['OPS_AGENT'] })
    const result = await assignRole(ops, { targetUserId: OTHER_ID, role: 'FARMER' }, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses a farmer revoking someone else’s role', async () => {
    const { deps, audit } = harness()
    const result = await removeRole(
      actor(),
      { targetUserId: OTHER_ID, role: 'FARMER', reason: 'because' },
      deps,
    )

    expect(result.ok).toBe(false)
    expect(audit.entries.map((e) => e.action)).toContain('ROLE_REVOKE_REJECTED')
  })

  it('refuses a suspended administrator', async () => {
    // Suspension must revoke power immediately, not at next sign-in.
    const { deps } = harness()
    const suspended = actor({ userId: ADMIN_ID, roles: ['ADMIN'], status: 'SUSPENDED' })
    const result = await assignRole(suspended, { targetUserId: FARMER_ID, role: 'SUPPLIER' }, deps)

    expect(result.ok).toBe(false)
  })

  it('refuses a farmer reading another user’s roles', async () => {
    const { deps } = harness()
    const result = await getUserRoles(actor(), OTHER_ID, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FORBIDDEN')
  })

  it('lets an administrator read anyone’s roles', async () => {
    const { deps } = harness()
    const result = await getUserRoles(admin, FARMER_ID, deps)
    expect(result.ok).toBe(true)
  })
})

describe('profile', () => {
  it('returns the signed-in user', async () => {
    const { deps } = harness()
    const result = await getCurrentUser(actor(), deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe(FARMER_ID)
    expect(result.value.roles).toEqual(['FARMER'])
  })

  it('refuses an anonymous caller', async () => {
    const { deps } = harness()
    const result = await getCurrentUser(ANONYMOUS, deps)
    expect(result.ok).toBe(false)
  })

  it('updates only the supplied fields', async () => {
    const { deps } = harness()
    const result = await updateCurrentUser(actor(), { fullName: 'Rahim Uddin Ahmed' }, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.fullName).toBe('Rahim Uddin Ahmed')
    // Untouched fields survive.
    expect(result.value.preferredLanguage).toBe('BN')
  })

  it('parses a date of birth from the ISO string a form sends', async () => {
    const { deps } = harness()
    const result = await updateCurrentUser(actor(), { dateOfBirth: '1990-05-14' }, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dateOfBirth?.toISOString()).toBe('1990-05-14T00:00:00.000Z')
  })

  it('rejects an underage date of birth with a field the form can highlight', async () => {
    const { deps } = harness()
    const result = await updateCurrentUser(actor(), { dateOfBirth: '2020-01-01' }, deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.meta['field']).toBe('dateOfBirth')
  })

  it('advances onboarding status when the profile is confirmed', async () => {
    const { deps } = harness()
    const result = await updateCurrentUser(actor(), { fullName: 'Rahim Uddin' }, deps)

    if (!result.ok) return
    expect(result.value.onboardingStatus).toBe('PROFILE_COMPLETE')
  })

  it('audits WHICH fields changed, never their values', async () => {
    // A date of birth copied into an audit row spreads personal data into a table with a
    // different retention policy. docs/07 §7, §11
    const { deps, audit } = harness()
    await updateCurrentUser(actor(), { fullName: 'Secret Name', dateOfBirth: '1990-05-14' }, deps)

    const entry = audit.entries.find((e) => e.action === 'PROFILE_UPDATED')
    expect(entry?.reason).toBe('dateOfBirth,fullName')
    expect(entry?.reason).not.toContain('Secret Name')
    expect(entry?.reason).not.toContain('1990')
  })

  it('treats an unchanged submission as success, not an error', async () => {
    const { deps } = harness()
    const result = await updateCurrentUser(actor(), {}, deps)
    expect(result.ok).toBe(true)
  })

  it('audits what CHANGED, not what the form happened to post', async () => {
    /*
     * The form posts every field on every save. Auditing the submitted set would record that an
     * email was edited when the user only picked a date of birth — a false statement in the one
     * table that exists to be trusted.
     */
    const { deps, audit } = harness()
    await updateCurrentUser(
      actor(),
      {
        fullName: 'Rahim Uddin', // unchanged
        email: null, // unchanged, already null
        preferredLanguage: 'BN', // unchanged
        dateOfBirth: '1990-05-14', // the only real edit
      },
      deps,
    )

    const entry = audit.entries.find((e) => e.action === 'PROFILE_UPDATED')
    expect(entry?.reason).toBe('dateOfBirth')
  })

  it('writes nothing at all when every submitted field already matches', async () => {
    const { deps, audit, accounts } = harness()
    // Start from a profile that has already finished onboarding, so no status change is due.
    const before = accounts.profiles.get(FARMER_ID)
    accounts.profiles.set(FARMER_ID, { ...before!, onboardingStatus: 'READY' })

    const result = await updateCurrentUser(
      actor(),
      { fullName: 'Rahim Uddin', preferredLanguage: 'BN' },
      deps,
    )

    expect(result.ok).toBe(true)
    expect(audit.entries.filter((e) => e.action === 'PROFILE_UPDATED')).toHaveLength(0)
  })

  it('has no parameter by which one user could edit another', () => {
    // Structural, not behavioural: updateCurrentUser takes (actor, command, deps) and the command
    // carries no user id. There is no argument to tamper with.
    expect(updateCurrentUser.length).toBe(3)
  })
})
