/**
 * Address book use-case tests.
 *
 * The fakes reproduce the real adapter's semantics rather than its signatures: ownership is part
 * of the lookup, the default flag moves atomically, and deletion is a soft delete that promotes a
 * replacement. A permissive fake would let the ownership tests pass while the property they name
 * went unenforced.
 *
 * Refs: docs/07_SECURITY.md §4.3
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import type { LocationPrecision } from '@langgol/domain/location'
import type {
  AddressBookRepository,
  AddressRecord,
  AddressWriteInput,
  AdminAreaRecord,
  AdminAreaRepository,
  AuditPort,
  Clock,
} from '../../ports/index.js'
import {
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from './addresses.js'
import { listAreaChildren, resolveAreaPath } from './areas.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-08-22T09:00:00.000Z')

const DIVISION: AdminAreaRecord = {
  id: 'division-1',
  level: 'DIVISION',
  parentId: null,
  nameBn: 'রাজশাহী',
  nameEn: 'Rajshahi',
  hasCentroid: false,
}
const DISTRICT: AdminAreaRecord = {
  id: 'district-1',
  level: 'DISTRICT',
  parentId: 'division-1',
  nameBn: 'বগুড়া',
  nameEn: 'Bogura',
  hasCentroid: false,
}
const UPAZILA: AdminAreaRecord = {
  id: 'upazila-1',
  level: 'UPAZILA',
  parentId: 'district-1',
  nameBn: 'শিবগঞ্জ',
  nameEn: 'Shibganj',
  hasCentroid: true,
}

function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: OWNER, roles: ['CONSUMER'], status: 'ACTIVE', ...overrides }
}

const VALID = {
  recipientName: 'Rahim Uddin',
  recipientPhone: '01712345678',
  adminAreaId: UPAZILA.id,
  addressLine: 'House 4, Road 2',
}

/* ------------------------------------------------------------------- doubles */

class FakeAreas implements AdminAreaRepository {
  nodes = new Map<string, AdminAreaRecord>([
    [DIVISION.id, DIVISION],
    [DISTRICT.id, DISTRICT],
    [UPAZILA.id, UPAZILA],
  ])

  listChildren(parentId: string | null): Promise<readonly AdminAreaRecord[]> {
    return Promise.resolve([...this.nodes.values()].filter((n) => n.parentId === parentId))
  }

  findById(areaId: string): Promise<AdminAreaRecord | null> {
    return Promise.resolve(this.nodes.get(areaId) ?? null)
  }

  resolvePath(areaId: string): Promise<readonly AdminAreaRecord[]> {
    const chain: AdminAreaRecord[] = []
    let cursor: string | null = areaId
    while (cursor !== null) {
      const node: AdminAreaRecord | undefined = this.nodes.get(cursor)
      if (node === undefined) break
      chain.push(node)
      cursor = node.parentId
    }
    return Promise.resolve(chain.reverse())
  }
}

type MutableAddress = { -readonly [K in keyof AddressRecord]: AddressRecord[K] } & {
  deletedAt: Date | null
}

class FakeAddresses implements AddressBookRepository {
  rows: MutableAddress[] = []
  private nextId = 1
  constructor(private areas: FakeAreas) {}

  private live(userId: string): MutableAddress[] {
    return this.rows.filter((r) => r.userId === userId && r.deletedAt === null)
  }

  private async withPath(row: MutableAddress): Promise<AddressRecord> {
    return { ...row, areaPath: await this.areas.resolvePath(row.adminAreaId) }
  }

  async listForUser(userId: string): Promise<readonly AddressRecord[]> {
    const sorted = [...this.live(userId)].sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
    return Promise.all(sorted.map(async (r) => this.withPath(r)))
  }

  // Ownership is part of the lookup, exactly as the SQL is. Someone else's row is not found.
  async findOwned(addressId: string, userId: string): Promise<AddressRecord | null> {
    const row = this.rows.find(
      (r) => r.id === addressId && r.userId === userId && r.deletedAt === null,
    )
    return row === undefined ? null : this.withPath(row)
  }

  countForUser(userId: string): Promise<number> {
    return Promise.resolve(this.live(userId).length)
  }

  async create(input: {
    userId: string
    address: AddressWriteInput
    makeDefault: boolean
  }): Promise<AddressRecord> {
    if (input.makeDefault) {
      for (const row of this.live(input.userId)) row.isDefault = false
    }
    const row: MutableAddress = {
      id: `address-${String(this.nextId++)}`,
      userId: input.userId,
      ...input.address,
      precision: input.address.precision,
      isDefault: input.makeDefault,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      areaPath: [],
    }
    this.rows.push(row)
    return this.withPath(row)
  }

  async update(input: {
    addressId: string
    userId: string
    changes: Partial<AddressWriteInput>
  }): Promise<AddressRecord | null> {
    const row = this.rows.find(
      (r) => r.id === input.addressId && r.userId === input.userId && r.deletedAt === null,
    )
    if (row === undefined) return null
    Object.assign(row, input.changes, { updatedAt: NOW })
    return this.withPath(row)
  }

  softDelete(input: {
    addressId: string
    userId: string
    at: Date
  }): Promise<{ deleted: boolean; promotedId: string | null }> {
    const row = this.rows.find(
      (r) => r.id === input.addressId && r.userId === input.userId && r.deletedAt === null,
    )
    if (row === undefined) return Promise.resolve({ deleted: false, promotedId: null })

    const wasDefault = row.isDefault
    row.deletedAt = input.at
    row.isDefault = false

    if (!wasDefault) return Promise.resolve({ deleted: true, promotedId: null })

    const replacement = this.live(input.userId)[0]
    if (replacement === undefined) return Promise.resolve({ deleted: true, promotedId: null })
    replacement.isDefault = true
    return Promise.resolve({ deleted: true, promotedId: replacement.id })
  }

  async setDefault(input: { addressId: string; userId: string }): Promise<AddressRecord | null> {
    const row = this.rows.find(
      (r) => r.id === input.addressId && r.userId === input.userId && r.deletedAt === null,
    )
    if (row === undefined) return null
    for (const other of this.live(input.userId)) other.isDefault = false
    row.isDefault = true
    return this.withPath(row)
  }
}

class FakeAudit implements AuditPort {
  entries: { action: string; entityId: string; reason?: string }[] = []
  record(input: Parameters<AuditPort['record']>[0]): Promise<void> {
    this.entries.push({
      action: input.action,
      entityId: input.entityId,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    })
    return Promise.resolve()
  }
  actions(): string[] {
    return this.entries.map((e) => e.action)
  }
}

function harness() {
  const areas = new FakeAreas()
  const addresses = new FakeAddresses(areas)
  const audit = new FakeAudit()
  const clock: Clock = { now: () => NOW }
  return { areas, addresses, audit, deps: { clock, addresses, areas, audit } }
}

/* -------------------------------------------------------------------- create */

describe('creating an address', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('saves a complete address with no coordinates', async () => {
    // The normal case. An address without a pin is a complete address here.
    const result = await createAddress(actor(), VALID, h.deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.latitude).toBeNull()
    expect(result.value.precision).toBe('AREA_CENTROID')
  })

  it('makes the FIRST address default without being asked', async () => {
    // One address and no default is a checkout that can preselect nothing, for no reason.
    const result = await createAddress(actor(), VALID, h.deps)
    if (!result.ok) return
    expect(result.value.isDefault).toBe(true)
  })

  it('does not make later addresses default unless asked', async () => {
    await createAddress(actor(), VALID, h.deps)
    const second = await createAddress(actor(), { ...VALID, label: 'Shop' }, h.deps)
    if (!second.ok) return
    expect(second.value.isDefault).toBe(false)
  })

  it('moves the default when a later address asks for it', async () => {
    const first = await createAddress(actor(), VALID, h.deps)
    await createAddress(actor(), { ...VALID, makeDefault: true }, h.deps)

    const list = await listAddresses(actor(), h.deps)
    if (!list.ok || !first.ok) return
    // Exactly one default, always — a partial unique index enforces it in the database.
    expect(list.value.filter((a) => a.isDefault)).toHaveLength(1)
    expect(list.value.find((a) => a.id === first.value.id)?.isDefault).toBe(false)
  })

  it('records a device fix as EXACT and a dragged pin as APPROXIMATE', async () => {
    const gps = await createAddress(
      actor(),
      { ...VALID, latitude: 24.37, longitude: 88.6, coordinateSource: 'DEVICE_GPS' },
      h.deps,
    )
    if (!gps.ok) return
    expect(gps.value.precision).toBe('EXACT')

    const pin = await createAddress(
      actor(),
      { ...VALID, latitude: 24.37, longitude: 88.6, coordinateSource: 'MAP_PIN' },
      h.deps,
    )
    if (!pin.ok) return
    expect(pin.value.precision satisfies LocationPrecision).toBe('APPROXIMATE')
  })

  it('never upgrades precision on the caller’s say-so alone', async () => {
    // No coordinates means AREA_CENTROID whatever the client claims the source was.
    const result = await createAddress(
      actor(),
      { ...VALID, coordinateSource: 'DEVICE_GPS' },
      h.deps,
    )
    if (!result.ok) return
    expect(result.value.precision).toBe('AREA_CENTROID')
  })

  it('refuses an area that is only a district', async () => {
    // A real id that would pass a foreign key, but "somewhere in Bogura" is not deliverable.
    const result = await createAddress(actor(), { ...VALID, adminAreaId: DISTRICT.id }, h.deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.meta['field']).toBe('adminAreaId')
  })

  it('refuses an area that does not exist', async () => {
    const result = await createAddress(actor(), { ...VALID, adminAreaId: 'made-up' }, h.deps)
    expect(result.ok).toBe(false)
  })

  it('refuses swapped coordinates rather than quoting a delivery across the bay', async () => {
    const result = await createAddress(
      actor(),
      { ...VALID, latitude: 88.6042, longitude: 24.3749, coordinateSource: 'MAP_PIN' },
      h.deps,
    )
    expect(result.ok).toBe(false)
  })

  it('audits the area and precision, never where the person lives', async () => {
    await createAddress(actor(), VALID, h.deps)

    const serialised = JSON.stringify(h.audit.entries)
    expect(h.audit.actions()).toContain('ADDRESS_CREATED')
    expect(serialised).not.toContain('House 4')
    expect(serialised).not.toContain('Rahim Uddin')
  })

  it('caps how many addresses one account can hoard', async () => {
    for (let index = 0; index < 30; index += 1) {
      await createAddress(actor(), VALID, h.deps)
    }
    const overflow = await createAddress(actor(), VALID, h.deps)
    expect(overflow.ok).toBe(false)
  })

  it('refuses an anonymous caller', async () => {
    const result = await createAddress(ANONYMOUS, VALID, h.deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNAUTHENTICATED')
  })
})

/* ---------------------------------------------------------------------- list */

describe('listing addresses', () => {
  it('returns only the caller’s own, default first', async () => {
    const h = harness()
    await createAddress(actor(), VALID, h.deps)
    await createAddress(actor({ userId: STRANGER }), VALID, h.deps)

    const result = await listAddresses(actor(), h.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
    expect(result.value[0]?.userId).toBe(OWNER)
    expect(result.value[0]?.isDefault).toBe(true)
  })

  it('carries the area path, so a caller can render it without a join', async () => {
    const h = harness()
    await createAddress(actor(), VALID, h.deps)

    const result = await listAddresses(actor(), h.deps)
    if (!result.ok) return
    expect(result.value[0]?.areaPath.map((a) => a.nameEn)).toEqual([
      'Rajshahi',
      'Bogura',
      'Shibganj',
    ])
  })

  it('refuses an anonymous caller', async () => {
    const h = harness()
    expect((await listAddresses(ANONYMOUS, h.deps)).ok).toBe(false)
  })
})

describe('reading one address', () => {
  it('returns the caller’s own, with its area path', async () => {
    const h = harness()
    const created = await createAddress(actor(), VALID, h.deps)
    if (!created.ok) return

    const result = await getAddress(actor(), created.value.id, h.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.id).toBe(created.value.id)
    expect(result.value.areaPath.map((a) => a.nameEn)).toEqual(['Rajshahi', 'Bogura', 'Shibganj'])
  })

  it('reports an id that never existed as not found', async () => {
    const h = harness()
    const result = await getAddress(actor(), 'no-such-address', h.deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('refuses an anonymous caller', async () => {
    const h = harness()
    expect((await getAddress(ANONYMOUS, 'anything', h.deps)).ok).toBe(false)
  })
})

/* -------------------------------------------------------- another user's data */

describe('another user’s addresses are unreachable', () => {
  let h: ReturnType<typeof harness>
  let strangersId: string

  beforeEach(async () => {
    h = harness()
    const created = await createAddress(actor({ userId: STRANGER }), VALID, h.deps)
    strangersId = created.ok ? created.value.id : ''
  })

  it('cannot be read one-by-one either', async () => {
    // The edit screen loads a single address by id; that path needs the same answer as the list.
    const result = await getAddress(actor(), strangersId, h.deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('reports NOT FOUND rather than FORBIDDEN on read', async () => {
    /*
     * The distinction is the whole point. A 403 confirms the id exists, which turns the endpoint
     * into an oracle for enumerating other people's addresses.
     */
    const result = await updateAddress(actor(), strangersId, { label: 'Mine now' }, h.deps)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('cannot be deleted by a stranger', async () => {
    const result = await deleteAddress(actor(), strangersId, h.deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('cannot be made a stranger’s default', async () => {
    const result = await setDefaultAddress(actor(), strangersId, h.deps)
    expect(result.ok).toBe(false)
  })

  it('is left untouched by every refused attempt', async () => {
    await updateAddress(actor(), strangersId, { label: 'Mine now' }, h.deps)
    await deleteAddress(actor(), strangersId, h.deps)
    await setDefaultAddress(actor(), strangersId, h.deps)

    const theirs = await listAddresses(actor({ userId: STRANGER }), h.deps)
    if (!theirs.ok) return
    expect(theirs.value).toHaveLength(1)
    expect(theirs.value[0]?.label).toBeNull()
    expect(theirs.value[0]?.isDefault).toBe(true)
  })
})

/* -------------------------------------------------------------------- update */

describe('updating an address', () => {
  let h: ReturnType<typeof harness>
  let id: string

  beforeEach(async () => {
    h = harness()
    const created = await createAddress(actor(), VALID, h.deps)
    id = created.ok ? created.value.id : ''
  })

  it('changes only the supplied fields', async () => {
    const result = await updateAddress(actor(), id, { label: 'Home' }, h.deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.label).toBe('Home')
    expect(result.value.addressLine).toBe('House 4, Road 2')
    expect(result.value.recipientName).toBe('Rahim Uddin')
  })

  it('lets a pin be cleared, and resets the precision when it goes', async () => {
    await updateAddress(
      actor(),
      id,
      { latitude: 24.37, longitude: 88.6, coordinateSource: 'DEVICE_GPS' },
      h.deps,
    )
    const cleared = await updateAddress(actor(), id, { latitude: null, longitude: null }, h.deps)

    if (!cleared.ok) return
    expect(cleared.value.latitude).toBeNull()
    // A stale EXACT next to no coordinates would claim a GPS fix for nothing.
    expect(cleared.value.precision).toBe('AREA_CENTROID')
  })

  it('does not leave a stale EXACT behind when a pin is dragged', async () => {
    await updateAddress(
      actor(),
      id,
      { latitude: 24.37, longitude: 88.6, coordinateSource: 'DEVICE_GPS' },
      h.deps,
    )
    const moved = await updateAddress(actor(), id, { latitude: 24.38, longitude: 88.61 }, h.deps)

    if (!moved.ok) return
    expect(moved.value.precision).toBe('APPROXIMATE')
  })

  it('refuses an invalid postcode', async () => {
    const result = await updateAddress(actor(), id, { postalCode: '62' }, h.deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.meta['field']).toBe('postalCode')
  })

  it('treats an empty change as success, not an error', async () => {
    const result = await updateAddress(actor(), id, {}, h.deps)
    expect(result.ok).toBe(true)
  })

  it('audits field names, not values', async () => {
    await updateAddress(actor(), id, { addressLine: 'Somewhere else entirely' }, h.deps)

    const entry = h.audit.entries.find((e) => e.action === 'ADDRESS_UPDATED')
    expect(entry?.reason).toBe('addressLine')
    expect(JSON.stringify(h.audit.entries)).not.toContain('Somewhere else')
  })
})

/* ------------------------------------------------------------ delete/default */

describe('deleting an address', () => {
  it('promotes another address when the default is deleted', async () => {
    // Leaving a user with addresses but no default makes checkout preselect nothing.
    const h = harness()
    const first = await createAddress(actor(), VALID, h.deps)
    await createAddress(actor(), { ...VALID, label: 'Shop' }, h.deps)
    if (!first.ok) return

    const result = await deleteAddress(actor(), first.value.id, h.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.promotedId).not.toBeNull()

    const list = await listAddresses(actor(), h.deps)
    if (!list.ok) return
    expect(list.value).toHaveLength(1)
    expect(list.value[0]?.isDefault).toBe(true)
  })

  it('leaves no default when the last address goes', async () => {
    const h = harness()
    const only = await createAddress(actor(), VALID, h.deps)
    if (!only.ok) return

    const result = await deleteAddress(actor(), only.value.id, h.deps)
    if (!result.ok) return
    expect(result.value.promotedId).toBeNull()

    const list = await listAddresses(actor(), h.deps)
    if (!list.ok) return
    expect(list.value).toHaveLength(0)
  })

  it('hides the address without destroying it, because orders reference it', async () => {
    const h = harness()
    const created = await createAddress(actor(), VALID, h.deps)
    if (!created.ok) return
    await deleteAddress(actor(), created.value.id, h.deps)

    // Gone from the address book, still present as a row.
    expect(h.addresses.rows).toHaveLength(1)
    expect(h.addresses.rows[0]?.deletedAt).not.toBeNull()
  })

  it('cannot be deleted twice', async () => {
    const h = harness()
    const created = await createAddress(actor(), VALID, h.deps)
    if (!created.ok) return
    await deleteAddress(actor(), created.value.id, h.deps)

    const again = await deleteAddress(actor(), created.value.id, h.deps)
    expect(again.ok).toBe(false)
  })
})

describe('setting the default', () => {
  it('moves the flag and leaves exactly one', async () => {
    const h = harness()
    await createAddress(actor(), VALID, h.deps)
    const second = await createAddress(actor(), { ...VALID, label: 'Shop' }, h.deps)
    if (!second.ok) return

    const result = await setDefaultAddress(actor(), second.value.id, h.deps)
    expect(result.ok).toBe(true)

    const list = await listAddresses(actor(), h.deps)
    if (!list.ok) return
    expect(list.value.filter((a) => a.isDefault)).toHaveLength(1)
    expect(list.value[0]?.id).toBe(second.value.id)
  })

  it('is idempotent on an address that is already default', async () => {
    const h = harness()
    const only = await createAddress(actor(), VALID, h.deps)
    if (!only.ok) return

    const result = await setDefaultAddress(actor(), only.value.id, h.deps)
    expect(result.ok).toBe(true)
    // No audit entry for a no-op: a log full of nothing hides the entries that matter.
    expect(h.audit.actions().filter((a) => a === 'ADDRESS_DEFAULT_CHANGED')).toHaveLength(0)
  })
})

/* --------------------------------------------------------------- area picker */

describe('browsing the area tree', () => {
  it('returns the roots and says what comes next', async () => {
    const h = harness()
    const result = await listAreaChildren(actor(), null, h.deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.areas.map((a) => a.id)).toEqual(['division-1'])
    expect(result.value.level).toBe('DIVISION')
    expect(result.value.nextLevel).toBe('DISTRICT')
  })

  it('walks one level at a time rather than shipping the whole tree', async () => {
    // ~4,500 unions is a payload nobody on a metered connection should pay for.
    const h = harness()
    const result = await listAreaChildren(actor(), DISTRICT.id, h.deps)
    if (!result.ok) return
    expect(result.value.areas.map((a) => a.id)).toEqual(['upazila-1'])
  })

  it('reports no next level at the bottom of the tree', async () => {
    const h = harness()
    const result = await listAreaChildren(actor(), UPAZILA.id, h.deps)
    if (!result.ok) return
    expect(result.value.areas).toHaveLength(0)
    expect(result.value.nextLevel).toBeNull()
  })

  it('resolves a saved area back to its full path', async () => {
    const h = harness()
    const result = await resolveAreaPath(actor(), UPAZILA.id, h.deps)
    if (!result.ok) return
    expect(result.value.map((a) => a.nameBn)).toEqual(['রাজশাহী', 'বগুড়া', 'শিবগঞ্জ'])
  })

  it('refuses an anonymous caller', async () => {
    const h = harness()
    expect((await listAreaChildren(ANONYMOUS, null, h.deps)).ok).toBe(false)
    expect((await resolveAreaPath(ANONYMOUS, UPAZILA.id, h.deps)).ok).toBe(false)
  })
})
