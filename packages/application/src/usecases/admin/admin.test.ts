/**
 * Back-office security tests.
 *
 * Organised around the question the phase turns on: **does holding the ADMIN role, and nothing
 * else, get you anything?** It must not. Every capability is exercised three times — by an
 * anonymous caller, by an administrator with an empty permission set, and by one holding exactly
 * the right permission — and the middle case is the one that would have passed before this phase.
 *
 * The second theme is that permissions do not bleed. Holding the permission that reads the KYC
 * queue must not carry the one that decrypts a national identity number, and the test that proves
 * it walks every permission against every capability rather than checking a representative pair.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor, type Role } from '@langgol/domain/policy'
import { ADMIN_PERMISSIONS, type AdminPermission } from '@langgol/domain/admin'
import { isErr, isOk } from '@langgol/shared'
import {
  grantAdminPermission,
  listAuditLog,
  restoreAccount,
  revokeAdminPermission,
  searchUsers,
  suspendAccount,
  viewUser,
  type AdminDeps,
} from './admin.js'

const ME = 'a0000000-0000-4000-8000-00000000000a'
const TARGET = 'b0000000-0000-4000-8000-00000000000b'
const NOW = new Date('2026-09-07T09:00:00.000Z')

/** An administrator holding exactly the listed permissions, and nothing implied. */
const admin = (...permissions: AdminPermission[]): Actor => ({
  userId: ME,
  roles: ['ADMIN'],
  status: 'ACTIVE',
  permissions,
})

const plainUser = (...roles: Role[]): Actor => ({ userId: ME, roles, status: 'ACTIVE' })

const REASON = 'Repeated fraudulent listings reported by three buyers'

function harness() {
  const audit = vi.fn(async (_line: Record<string, unknown>) => undefined)
  const setUserStatus = vi.fn(async () => true)
  const grantPermission = vi.fn(async () => true)
  const revokePermission = vi.fn(async () => true)

  const searchUsersFn = vi.fn(async (filter: { limit?: number; offset?: number }) => ({
    items: [],
    total: 0,
    limit: filter.limit ?? 20,
    offset: filter.offset ?? 0,
  }))

  // The filter is declared even though the fake ignores it, so a test can assert what the use
  // case actually passed down — the page cap is only provable by looking at the argument.
  const auditLog = vi.fn(async (filter: { limit?: number; offset?: number }) => ({
    items: [],
    total: 0,
    limit: filter.limit ?? 20,
    offset: filter.offset ?? 0,
  }))

  const userDetail = vi.fn(async (userId: string) =>
    userId === TARGET
      ? {
          userId: TARGET,
          fullName: 'Rahim Uddin',
          phoneMasked: '+880171****5678',
          status: 'ACTIVE',
          onboardingStatus: 'ROLE_SELECTED',
          roles: ['FARMER'],
          createdAt: NOW,
          phoneVerified: true,
          emailVerified: false,
          verifications: [{ type: 'IDENTITY', status: 'PENDING' }],
          permissions: [],
          suspendedReason: null,
        }
      : null,
  )

  return {
    audit,
    setUserStatus,
    grantPermission,
    revokePermission,
    searchUsers: searchUsersFn,
    auditLog,
    userDetail,
    deps: {
      clock: { now: () => NOW },
      audit: { record: audit },
      admin: {
        searchUsers: searchUsersFn,
        userDetail,
        setUserStatus,
        permissionsFor: async () => [],
        grantPermission,
        revokePermission,
        auditLog,
      },
    } as unknown as AdminDeps,
  }
}

let h: ReturnType<typeof harness>
beforeEach(() => {
  h = harness()
})

/* ============================================ the role alone grants nothing */

describe('holding the ADMIN role and no permissions', () => {
  /*
   * The property this phase exists for. Before P13 every one of these succeeded, because the role
   * was the key; now the role is only the door.
   */
  const bare = () => admin()

  it('cannot search users', async () => {
    const result = await searchUsers(bare(), {}, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.searchUsers).not.toHaveBeenCalled()
  })

  it('cannot open a user', async () => {
    expect(isErr(await viewUser(bare(), TARGET, h.deps))).toBe(true)
  })

  it('cannot suspend an account', async () => {
    const result = await suspendAccount(bare(), TARGET, REASON, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.setUserStatus).not.toHaveBeenCalled()
  })

  it('cannot restore an account', async () => {
    expect(isErr(await restoreAccount(bare(), TARGET, REASON, h.deps))).toBe(true)
  })

  it('cannot grant a permission — least of all to itself', async () => {
    const result = await grantAdminPermission(bare(), TARGET, 'ROLE_MANAGE', h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.grantPermission).not.toHaveBeenCalled()
  })

  it('cannot read the audit log', async () => {
    expect(isErr(await listAuditLog(bare(), {}, h.deps))).toBe(true)
  })

  it('is refused for the right reason, so the right thing gets granted', async () => {
    // A denial that said MISSING_ROLE would have somebody handed ADMIN when they needed a checkbox.
    const result = await searchUsers(bare(), {}, h.deps)
    if (!isErr(result)) throw new Error('expected refusal')
    expect(result.error.code).toBe('FORBIDDEN')
  })
})

describe('holding no role at all', () => {
  it('refuses an anonymous caller everywhere', async () => {
    expect(isErr(await searchUsers(ANONYMOUS, {}, h.deps))).toBe(true)
    expect(isErr(await viewUser(ANONYMOUS, TARGET, h.deps))).toBe(true)
    expect(isErr(await suspendAccount(ANONYMOUS, TARGET, REASON, h.deps))).toBe(true)
    expect(isErr(await restoreAccount(ANONYMOUS, TARGET, REASON, h.deps))).toBe(true)
    expect(isErr(await grantAdminPermission(ANONYMOUS, TARGET, 'USER_VIEW', h.deps))).toBe(true)
    expect(isErr(await listAuditLog(ANONYMOUS, {}, h.deps))).toBe(true)
  })

  it('refuses an ordinary user carrying every permission they invented', async () => {
    /*
     * A farmer whose actor somehow claims permissions. The role check runs first, so the claim is
     * worth nothing — which matters because permissions are the sort of field a future client
     * might be tempted to send.
     */
    const impostor: Actor = {
      userId: ME,
      roles: ['FARMER'],
      status: 'ACTIVE',
      permissions: [...ADMIN_PERMISSIONS],
    }

    expect(isErr(await searchUsers(impostor, {}, h.deps))).toBe(true)
    expect(isErr(await suspendAccount(impostor, TARGET, REASON, h.deps))).toBe(true)
    expect(isErr(await listAuditLog(impostor, {}, h.deps))).toBe(true)
  })

  it('refuses a suspended administrator holding every permission', async () => {
    // Suspension is checked before any rule runs, so an operator who was themselves suspended
    // cannot keep working — including to unsuspend themselves.
    const suspended: Actor = {
      userId: ME,
      roles: ['ADMIN'],
      status: 'SUSPENDED',
      permissions: [...ADMIN_PERMISSIONS],
    }
    expect(isErr(await restoreAccount(suspended, ME, REASON, h.deps))).toBe(true)
  })

  it('refuses a field agent the administrative capabilities', async () => {
    const agent = plainUser('OPS_AGENT')
    expect(isErr(await suspendAccount(agent, TARGET, REASON, h.deps))).toBe(true)
    expect(isErr(await listAuditLog(agent, {}, h.deps))).toBe(true)
    expect(isErr(await grantAdminPermission(agent, TARGET, 'USER_VIEW', h.deps))).toBe(true)
  })
})

/* ================================================== permissions do not bleed */

describe('one permission never carries another', () => {
  /**
   * Each capability, and the single permission that unlocks it.
   *
   * Walked exhaustively below: every permission is tried against every capability, and exactly one
   * pairing may succeed. A change that made one permission imply another fails here rather than
   * being noticed after an operator did something they should not have been able to.
   */
  const capabilities: readonly {
    readonly name: string
    readonly needs: AdminPermission
    readonly run: (actor: Actor, deps: AdminDeps) => Promise<{ ok: boolean }>
  }[] = [
    {
      name: 'searchUsers',
      needs: 'USER_VIEW',
      run: async (actor, deps) => ({ ok: isOk(await searchUsers(actor, {}, deps)) }),
    },
    {
      name: 'suspendAccount',
      needs: 'ACCOUNT_SUSPEND',
      run: async (actor, deps) => ({ ok: isOk(await suspendAccount(actor, TARGET, REASON, deps)) }),
    },
    {
      name: 'grantAdminPermission',
      needs: 'ROLE_MANAGE',
      run: async (actor, deps) => ({
        ok: isOk(await grantAdminPermission(actor, TARGET, 'USER_VIEW', deps)),
      }),
    },
    {
      name: 'listAuditLog',
      needs: 'AUDIT_VIEW',
      run: async (actor, deps) => ({ ok: isOk(await listAuditLog(actor, {}, deps)) }),
    },
  ]

  it('unlocks exactly the capability it names and no other', async () => {
    for (const capability of capabilities) {
      for (const permission of ADMIN_PERMISSIONS) {
        const fresh = harness()
        const { ok } = await capability.run(admin(permission), fresh.deps)
        const expected = permission === capability.needs

        expect(ok, `${permission} against ${capability.name}`).toBe(expected)
      }
    }
  })
})

/* ================================================================ behaviour */

describe('what an authorised administrator can do', () => {
  it('searches users', async () => {
    const result = await searchUsers(admin('USER_VIEW'), { search: 'Rahim' }, h.deps)
    expect(isOk(result)).toBe(true)
  })

  it('caps the page size however large a number is asked for', async () => {
    // An unbounded admin query is one SELECT away from pulling the user table into a page render.
    await searchUsers(admin('USER_VIEW'), { limit: 100_000 }, h.deps)
    const passed = h.searchUsers.mock.calls[0]?.[0] as { limit: number }
    expect(passed.limit).toBeLessThanOrEqual(50)
  })

  it('refuses a negative offset rather than passing it to the database', async () => {
    await searchUsers(admin('USER_VIEW'), { offset: -5 }, h.deps)
    const passed = h.searchUsers.mock.calls[0]?.[0] as { offset: number }
    expect(passed.offset).toBe(0)
  })

  it('records that a user record was opened', async () => {
    /*
     * "Who looked at this account?" is a question a data-subject request can ask, and a read
     * nobody logged is a read nobody can answer for.
     */
    await viewUser(admin('USER_VIEW'), TARGET, h.deps)
    const actions = h.audit.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('ADMIN_USER_VIEWED')
  })

  it('says not found for a user who does not exist', async () => {
    const result = await viewUser(admin('USER_VIEW'), 'nobody', h.deps)
    expect(isErr(result)).toBe(true)
  })
})

describe('suspending an account', () => {
  it('works with the permission and a reason', async () => {
    const result = await suspendAccount(admin('ACCOUNT_SUSPEND'), TARGET, REASON, h.deps)
    expect(isOk(result)).toBe(true)
    expect(h.setUserStatus).toHaveBeenCalled()
  })

  it('refuses without a reason worth reading', async () => {
    /*
     * A suspension can stop a farmer selling, which is their income. "spam" is not an explanation
     * anybody can act on a month later.
     */
    for (const bad of ['', '   ', 'spam']) {
      const fresh = harness()
      const result = await suspendAccount(admin('ACCOUNT_SUSPEND'), TARGET, bad, fresh.deps)
      expect(isErr(result), bad).toBe(true)
      expect(fresh.setUserStatus).not.toHaveBeenCalled()
    }
  })

  it('refuses to suspend the operator’s own account', async () => {
    /*
     * Not a courtesy. A self-suspension locks the account holding ACCOUNT_SUSPEND out of the tool
     * needed to undo it, and on a small team that can be the only such account.
     */
    const result = await suspendAccount(admin('ACCOUNT_SUSPEND'), ME, REASON, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.setUserStatus).not.toHaveBeenCalled()
  })

  it('records the reason the operator gave', async () => {
    await suspendAccount(admin('ACCOUNT_SUSPEND'), TARGET, REASON, h.deps)
    const reasons = h.audit.mock.calls.map((call) => (call[0] as { reason?: string }).reason)
    expect(reasons).toContain(REASON)
  })

  it('reports a conflict rather than claiming success when nothing changed', async () => {
    const stubborn = harness()
    stubborn.setUserStatus.mockResolvedValue(false)

    const result = await suspendAccount(admin('ACCOUNT_SUSPEND'), TARGET, REASON, stubborn.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('CONFLICT')
    // And nothing is written down about a thing that did not happen.
    const actions = stubborn.audit.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).not.toContain('ACCOUNT_SUSPENDED')
  })

  it('restores under the same permission', async () => {
    expect(isOk(await restoreAccount(admin('ACCOUNT_SUSPEND'), TARGET, REASON, h.deps))).toBe(true)
  })
})

describe('managing another administrator’s permissions', () => {
  it('grants with ROLE_MANAGE', async () => {
    const result = await grantAdminPermission(admin('ROLE_MANAGE'), TARGET, 'KYC_VIEW', h.deps)
    expect(isOk(result)).toBe(true)
  })

  it('refuses to grant to yourself', async () => {
    /*
     * ROLE_MANAGE is self-amplifying: a holder could otherwise grant themselves the other nine.
     * Requiring a second person is what stops one compromised session escalating quietly, and the
     * database carries the same rule as a CHECK.
     */
    const result = await grantAdminPermission(admin('ROLE_MANAGE'), ME, 'KYC_REVIEW', h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.grantPermission).not.toHaveBeenCalled()
  })

  it('refuses a permission nobody has heard of', async () => {
    const result = await grantAdminPermission(admin('ROLE_MANAGE'), TARGET, 'EVERYTHING', h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.grantPermission).not.toHaveBeenCalled()
  })

  it('names the permission in the audit line', async () => {
    await grantAdminPermission(admin('ROLE_MANAGE'), TARGET, 'KYC_REVIEW', h.deps)
    expect(JSON.stringify(h.audit.mock.calls)).toContain('KYC_REVIEW')
  })

  it('lets somebody stand down from their own permission', async () => {
    /*
     * The asymmetry is deliberate: acquiring privilege needs a second person, shedding it does
     * not. Standing down from something you no longer need is good practice.
     */
    const result = await revokeAdminPermission(
      admin('ROLE_MANAGE'),
      ME,
      'KYC_REVIEW',
      'No longer reviewing identity documents',
      h.deps,
    )
    expect(isOk(result)).toBe(true)
  })

  it('refuses a revocation with no reason', async () => {
    const result = await revokeAdminPermission(
      admin('ROLE_MANAGE'),
      TARGET,
      'KYC_VIEW',
      'x',
      h.deps,
    )
    expect(isErr(result)).toBe(true)
    expect(h.revokePermission).not.toHaveBeenCalled()
  })
})

describe('the audit log', () => {
  it('is readable with AUDIT_VIEW', async () => {
    expect(isOk(await listAuditLog(admin('AUDIT_VIEW'), {}, h.deps))).toBe(true)
  })

  it('is paged like everything else', async () => {
    await listAuditLog(admin('AUDIT_VIEW'), { limit: 5000 }, h.deps)
    const passed = h.auditLog.mock.calls[0]?.[0] as { limit: number }
    expect(passed.limit).toBeLessThanOrEqual(50)
  })

  it('does not record that it was read', async () => {
    /*
     * Deliberate. An audit table recording reads of itself grows without bound, and each read
     * produces an entry that produces an entry the next time somebody looks.
     */
    await listAuditLog(admin('AUDIT_VIEW'), {}, h.deps)
    expect(h.audit).not.toHaveBeenCalled()
  })
})
