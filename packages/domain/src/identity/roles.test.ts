/**
 * Role catalogue tests.
 *
 * The property that matters most is that the vocabulary cannot drift. Three places name roles —
 * the Prisma enum, `ROLES`, and `ROLE_CATALOGUE` — and a role present in one but missing from
 * another is a role that can be held but never labelled, or labelled but never granted.
 */

import { describe, expect, it } from 'vitest'
import {
  CONTROLLED_ROLES,
  PRIVILEGED_ROLES,
  ROLES,
  ROLE_CATALOGUE,
  SELF_SELECTABLE_ROLES,
  isControlledRole,
  isPrivilegedRole,
  isRole,
  isSelfSelectableRole,
  roleDescriptor,
  roleLabel,
} from './roles.js'

describe('the role vocabulary', () => {
  it('contains every persona the platform serves', () => {
    expect([...ROLES]).toEqual([
      'FARMER',
      'CONSUMER',
      'RETAILER',
      'WHOLESALER',
      'SUPPLIER',
      'AGRICULTURAL_EXPERT',
      'LOGISTICS_PROVIDER',
      'OPS_AGENT',
      'ADMIN',
    ])
  })

  it('has no duplicates', () => {
    expect(new Set(ROLES).size).toBe(ROLES.length)
  })

  it('recognises its own members and nothing else', () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true)
    expect(isRole('SUPERUSER')).toBe(false)
    expect(isRole('farmer')).toBe(false)
  })

  it('describes every role exactly once', () => {
    // A role without a catalogue entry renders as a blank menu item; a duplicate entry means the
    // label depends on array order.
    expect(ROLE_CATALOGUE).toHaveLength(ROLES.length)
    expect(new Set(ROLE_CATALOGUE.map((entry) => entry.role)).size).toBe(ROLES.length)
    for (const role of ROLES) {
      expect(() => roleDescriptor(role)).not.toThrow()
    }
  })

  it('labels every role in both languages', () => {
    for (const role of ROLES) {
      const bn = roleLabel(role, 'bn')
      const en = roleLabel(role, 'en')
      expect(bn.name.length).toBeGreaterThan(0)
      expect(en.name.length).toBeGreaterThan(0)
      // Bangla-first means the Bangla label is a real translation, not the English one copied.
      expect(bn.name).not.toBe(en.name)
      expect(bn.name).toMatch(/[ঀ-৿]/)
    }
  })

  it('keeps the catalogue flags consistent with the derived lists', () => {
    for (const entry of ROLE_CATALOGUE) {
      expect(entry.selfSelectable).toBe(isSelfSelectableRole(entry.role))
      expect(entry.privileged).toBe(isPrivilegedRole(entry.role))
    }
  })
})

describe('self-selection is a closed list', () => {
  it('permits only the three ordinary trading roles', () => {
    expect([...SELF_SELECTABLE_ROLES]).toEqual(['FARMER', 'CONSUMER', 'RETAILER'])
  })

  it('refuses privileged roles', () => {
    // The single most important assertion in this file: a request naming ADMIN must not be
    // self-selectable, whatever the UI offers.
    expect(isSelfSelectableRole('ADMIN')).toBe(false)
    expect(isSelfSelectableRole('OPS_AGENT')).toBe(false)
  })

  it('refuses roles that need verification before they mean anything', () => {
    // A wholesaler or supplier claiming the role unverified puts an unlicensed seller in front
    // of buyers.
    expect(isSelfSelectableRole('WHOLESALER')).toBe(false)
    expect(isSelfSelectableRole('SUPPLIER')).toBe(false)
    expect(isSelfSelectableRole('AGRICULTURAL_EXPERT')).toBe(false)
    expect(isSelfSelectableRole('LOGISTICS_PROVIDER')).toBe(false)
  })

  it('treats everything not self-selectable as controlled — failing closed', () => {
    for (const role of ROLES) {
      expect(isControlledRole(role)).toBe(!isSelfSelectableRole(role))
    }
    expect(CONTROLLED_ROLES).toHaveLength(ROLES.length - SELF_SELECTABLE_ROLES.length)
  })
})

describe('privilege', () => {
  it('is limited to the two roles with power over other users', () => {
    expect([...PRIVILEGED_ROLES]).toEqual(['ADMIN', 'OPS_AGENT'])
  })

  it('does not treat a commercial role as privileged', () => {
    // WHOLESALER is controlled because it needs verification, NOT because it confers power.
    // Conflating the two would put an ordinary trader behind an admin-approval flow.
    expect(isPrivilegedRole('WHOLESALER')).toBe(false)
    expect(isControlledRole('WHOLESALER')).toBe(true)
  })
})
