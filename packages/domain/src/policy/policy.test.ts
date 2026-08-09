import { describe, expect, it } from 'vitest'
import { ANONYMOUS, can, allowed, hasRole, isActor, type Actor } from './index.js'

const actor = (over: Partial<Actor> = {}): Actor => ({
  userId: 'user-1',
  roles: ['CONSUMER'],
  status: 'ACTIVE',
  ...over,
})

const ownedBy = (ownerUserId: string) => ({ ownerUserId })

describe('failing closed', () => {
  it('denies anonymous everything', () => {
    expect(can(ANONYMOUS, 'user:read-self').allowed).toBe(false)
    expect(can(ANONYMOUS, 'address:create').allowed).toBe(false)
    expect(can(ANONYMOUS, 'admin:access').allowed).toBe(false)
    expect(can(ANONYMOUS, 'user:read-self')).toEqual({ allowed: false, reason: 'ANONYMOUS' })
  })

  it('denies a suspended or deactivated account, whatever its roles', () => {
    for (const status of ['SUSPENDED', 'DEACTIVATED'] as const) {
      const blocked = actor({ status, roles: ['ADMIN'] })
      expect(can(blocked, 'admin:access')).toEqual({
        allowed: false,
        reason: 'ACCOUNT_NOT_ACTIVE',
      })
      expect(can(blocked, 'user:read-self').allowed).toBe(false)
    }
  })

  it('denies an action that has a resource rule but was given no resource', () => {
    // The failure mode of a forgotten argument must be denial, never silent permission.
    expect(can(actor(), 'address:update')).toEqual({
      allowed: false,
      reason: 'RESOURCE_REQUIRED',
    })
    expect(can(actor(), 'address:read').allowed).toBe(false)
  })
})

describe('ownership', () => {
  it('allows the owner and refuses everyone else', () => {
    expect(allowed(actor(), 'address:update', ownedBy('user-1'))).toBe(true)
    expect(allowed(actor(), 'address:update', ownedBy('user-2'))).toBe(false)
    expect(can(actor(), 'address:delete', ownedBy('user-2'))).toEqual({
      allowed: false,
      reason: 'NOT_OWNER',
    })
  })

  it('lets an admin read another user\u2019s address but not silently edit it', () => {
    const admin = actor({ userId: 'admin-1', roles: ['ADMIN'] })
    expect(allowed(admin, 'address:read', ownedBy('user-2'))).toBe(true)
    expect(allowed(admin, 'address:update', ownedBy('user-2'))).toBe(false)
  })

  it('does NOT let a field agent reach another user\u2019s address', () => {
    // Agents act for farmers during onboarding, but an agent with access to arbitrary user
    // records is an insider-risk surface. docs/07_SECURITY.md T15, §8.4
    const agent = actor({ userId: 'agent-1', roles: ['OPS_AGENT'] })
    expect(allowed(agent, 'address:read', ownedBy('user-2'))).toBe(false)
    expect(allowed(agent, 'address:update', ownedBy('user-2'))).toBe(false)
  })
})

describe('roles', () => {
  it('gates the admin surface', () => {
    expect(allowed(actor({ roles: ['ADMIN'] }), 'admin:access')).toBe(true)
    expect(allowed(actor({ roles: ['OPS_AGENT'] }), 'admin:access')).toBe(false)
    expect(allowed(actor({ roles: ['FARMER'] }), 'admin:access')).toBe(false)
  })

  it('lets ops into the ops surface but not into privileged administration', () => {
    const agent = actor({ roles: ['OPS_AGENT'] })
    expect(allowed(agent, 'ops:access')).toBe(true)
    expect(allowed(agent, 'admin:user-read')).toBe(true)
    expect(allowed(agent, 'admin:user-suspend')).toBe(false)
    expect(allowed(agent, 'admin:role-grant')).toBe(false)
    expect(allowed(agent, 'admin:audit-read')).toBe(false)
  })

  it('restricts configuration writes to admins — a rate change is an audited decision', () => {
    expect(allowed(actor({ roles: ['ADMIN'] }), 'config:write')).toBe(true)
    expect(allowed(actor({ roles: ['OPS_AGENT'] }), 'config:write')).toBe(false)
    expect(allowed(actor({ roles: ['FARMER'] }), 'config:write')).toBe(false)
    expect(allowed(actor({ roles: ['FARMER'] }), 'config:read')).toBe(true)
  })

  it('honours multiple roles on one account', () => {
    const both = actor({ roles: ['FARMER', 'CONSUMER'] })
    expect(hasRole(both, 'FARMER')).toBe(true)
    expect(hasRole(both, 'ADMIN')).toBe(false)
    expect(hasRole(both, 'ADMIN', 'CONSUMER')).toBe(true)
    expect(allowed(both, 'address:create')).toBe(true)
  })

  it('treats an account with no roles as authenticated but unprivileged', () => {
    const roleless = actor({ roles: [] })
    expect(allowed(roleless, 'user:read-self')).toBe(true)
    expect(allowed(roleless, 'admin:access')).toBe(false)
  })
})

describe('actor discrimination', () => {
  it('distinguishes anonymous from an actor', () => {
    expect(isActor(ANONYMOUS)).toBe(false)
    expect(isActor(actor())).toBe(true)
  })
})
