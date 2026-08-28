/**
 * Farm and plot ownership tests.
 *
 * This file is almost entirely about IDOR. `farmId` and `plotId` ARE parameters — a farmer has to
 * be able to name which of their own holdings they mean — and that is precisely the shape the
 * vulnerability takes. So the cases below hand the use cases a stranger's id and assert two
 * things every time:
 *
 *  1. Nothing comes back.
 *  2. The answer is NOT_FOUND, never FORBIDDEN. "That exists but is not yours" confirms the id,
 *     which is the half of the leak people forget to close.
 *
 * The fake repository below is owner-scoped on purpose. A fake that ignored the user id would let
 * every test pass while the real query leaked, so it models the guarantee rather than assuming it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import { isErr, isOk } from '@langgol/shared'
import {
  createFarm,
  createPlot,
  deleteFarm,
  deletePlot,
  getMyFarm,
  listMyFarms,
  listPlots,
  updateFarm,
  updatePlot,
  type FarmDeps,
} from './farms.js'
import type { FarmRecord, PlotRecord } from '../../ports/farm.js'

const ALICE = 'a0000000-0000-4000-8000-00000000000a'
const BOB = 'b0000000-0000-4000-8000-00000000000b'
const alice: Actor = { userId: ALICE, roles: ['FARMER'], status: 'ACTIVE' }
const bob: Actor = { userId: BOB, roles: ['FARMER'], status: 'ACTIVE' }
const consumer: Actor = { userId: ALICE, roles: ['CONSUMER'], status: 'ACTIVE' }

const NOW = new Date('2026-08-28T12:00:00.000Z')

interface Row {
  owner: string
  farm: FarmRecord
  plots: PlotRecord[]
}

/** Alice owns farm-1 (with plot-1); Bob owns farm-2 (with plot-2). */
function world(): Row[] {
  const farm = (id: string, name: string): FarmRecord => ({
    id,
    name,
    adminAreaId: 'area-1',
    addressId: null,
    villageOrArea: null,
    addressLine: null,
    latitude: null,
    longitude: null,
    areaAmountMilli: null,
    areaUnit: null,
    ownershipType: null,
    soilType: null,
    irrigationAvailable: null,
    irrigationMethod: null,
    waterSource: null,
    farmingMethod: null,
    verificationStatus: 'UNVERIFIED',
    plotCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  })
  const plot = (id: string, farmId: string, name: string): PlotRecord => ({
    id,
    farmId,
    name,
    areaAmountMilli: null,
    areaUnit: null,
    soilType: null,
    irrigationMethod: null,
    latitude: null,
    longitude: null,
    createdAt: NOW,
    updatedAt: NOW,
  })

  return [
    {
      owner: ALICE,
      farm: farm('farm-1', 'Alice field'),
      plots: [plot('plot-1', 'farm-1', 'North')],
    },
    { owner: BOB, farm: farm('farm-2', 'Bob field'), plots: [plot('plot-2', 'farm-2', 'South')] },
  ]
}

function harness() {
  const rows = world()
  const audit = vi.fn(async (_line: { reason?: string; action?: string }) => undefined)

  /** Owner-scoped, exactly as the SQL is. A miss returns null rather than the row. */
  const ownedFarm = (userId: string, farmId: string) =>
    rows.find((r) => r.owner === userId && r.farm.id === farmId) ?? null
  const ownedPlot = (userId: string, plotId: string) => {
    const row = rows.find((r) => r.owner === userId && r.plots.some((p) => p.id === plotId))
    return row?.plots.find((p) => p.id === plotId) ?? null
  }

  const deps = {
    clock: { now: () => NOW },
    audit: { record: audit },
    farms: {
      listForUser: async (u: string) => rows.filter((r) => r.owner === u).map((r) => r.farm),
      findForUser: async (u: string, id: string) => ownedFarm(u, id)?.farm ?? null,
      countForUser: async (u: string) => rows.filter((r) => r.owner === u).length,
      createForUser: async (u: string, input: { name: string }) => {
        const created = { ...world()[0]!.farm, id: `new-${u}`, name: input.name, plotCount: 0 }
        rows.push({ owner: u, farm: created, plots: [] })
        return created
      },
      updateForUser: async (u: string, id: string, changes: Record<string, unknown>) => {
        const row = ownedFarm(u, id)
        if (row === null) return null
        row.farm = { ...row.farm, ...changes } as FarmRecord
        return row.farm
      },
      softDeleteForUser: async (u: string, id: string) => ownedFarm(u, id) !== null,
    },
    plots: {
      listForFarm: async (u: string, farmId: string) => ownedFarm(u, farmId)?.plots ?? [],
      findForUser: async (u: string, id: string) => ownedPlot(u, id),
      countForFarm: async (u: string, farmId: string) => ownedFarm(u, farmId)?.plots.length ?? 0,
      createForUser: async (u: string, farmId: string, input: { name: string }) => {
        const row = ownedFarm(u, farmId)
        if (row === null) return null
        const created = { ...row.plots[0]!, id: `new-plot-${u}`, name: input.name }
        row.plots.push(created)
        return created
      },
      updateForUser: async (u: string, id: string, changes: Record<string, unknown>) => {
        const plot = ownedPlot(u, id)
        return plot === null ? null : ({ ...plot, ...changes } as PlotRecord)
      },
      softDeleteForUser: async (u: string, id: string) => ownedPlot(u, id) !== null,
    },
  } as unknown as FarmDeps

  return { deps, audit }
}

let h: ReturnType<typeof harness>
beforeEach(() => {
  h = harness()
})

describe('a farmer sees only their own farms', () => {
  it('lists their own and nobody else’s', async () => {
    const result = await listMyFarms(alice, h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.map((f) => f.id)).toEqual(['farm-1'])
  })

  it('reads their own farm', async () => {
    const result = await getMyFarm(alice, 'farm-1', h.deps)
    expect(isOk(result)).toBe(true)
  })
})

describe('another farmer’s id resolves to nothing', () => {
  it('refuses to read a stranger’s farm', async () => {
    const result = await getMyFarm(alice, 'farm-2', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('reports NOT_FOUND rather than FORBIDDEN, so the id is not confirmed', async () => {
    /*
     * The half of the leak people forget. "You may not see that" tells an attacker enumerating
     * ids that the record exists; a farm that is not theirs and a farm that does not exist must
     * be indistinguishable from outside.
     */
    const stranger = await getMyFarm(alice, 'farm-2', h.deps)
    const missing = await getMyFarm(alice, 'no-such-farm', h.deps)

    if (!isErr(stranger) || !isErr(missing)) throw new Error('expected both to fail')
    expect(stranger.error.code).toBe(missing.error.code)
    expect(stranger.error.code).toBe('NOT_FOUND')
  })

  it('refuses to edit a stranger’s farm', async () => {
    const result = await updateFarm(alice, 'farm-2', { name: 'Stolen' }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')

    // And Bob's farm is untouched.
    const bobView = await getMyFarm(bob, 'farm-2', h.deps)
    if (!isOk(bobView)) throw new Error('expected ok')
    expect(bobView.value.name).toBe('Bob field')
  })

  it('refuses to delete a stranger’s farm', async () => {
    const result = await deleteFarm(alice, 'farm-2', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('writes no audit line for a refused delete', async () => {
    // An audit row saying Alice deleted farm-2 would be a false statement about a thing that
    // did not happen.
    await deleteFarm(alice, 'farm-2', h.deps)
    expect(h.audit).not.toHaveBeenCalled()
  })
})

describe('plots are scoped through their farm', () => {
  it('lists the plots of their own farm', async () => {
    const result = await listPlots(alice, 'farm-1', h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.map((p) => p.id)).toEqual(['plot-1'])
  })

  it('refuses to list the plots of a stranger’s farm', async () => {
    /*
     * The join is where this is enforced: a plot query carries the owner one table further out,
     * so a stranger's farm id yields nothing rather than their plots.
     */
    const result = await listPlots(alice, 'farm-2', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('refuses to create a plot on a stranger’s farm', async () => {
    // Without the ownership check before the insert, the foreign key would happily accept this
    // and hang Alice's plot off Bob's farm.
    const result = await createPlot(alice, 'farm-2', { name: 'Intruder' }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')

    const bobPlots = await listPlots(bob, 'farm-2', h.deps)
    if (!isOk(bobPlots)) throw new Error('expected ok')
    expect(bobPlots.value).toHaveLength(1)
  })

  it('refuses to edit a stranger’s plot', async () => {
    const result = await updatePlot(alice, 'plot-2', { name: 'Stolen' }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('refuses to delete a stranger’s plot', async () => {
    const result = await deletePlot(alice, 'plot-2', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('lets a farmer manage their own plot', async () => {
    expect(isOk(await updatePlot(alice, 'plot-1', { name: 'North field' }, h.deps))).toBe(true)
    expect(isOk(await deletePlot(alice, 'plot-1', h.deps))).toBe(true)
  })
})

describe('who may manage holdings at all', () => {
  it('refuses an anonymous caller everywhere', async () => {
    /*
     * Every entry point, not a representative sample. An endpoint that forgot its authentication
     * check would be invisible in a test that only covered `listMyFarms`.
     *
     * Typed as the shared failure shape rather than each use case's own Result, because the union
     * of six different Ok types cannot be narrowed and the only thing asserted here is the error.
     */
    const calls: readonly (() => Promise<unknown>)[] = [
      () => listMyFarms(ANONYMOUS, h.deps),
      () => getMyFarm(ANONYMOUS, 'farm-1', h.deps),
      () => createFarm(ANONYMOUS, { name: 'X', adminAreaId: 'area-1' }, h.deps),
      () => updateFarm(ANONYMOUS, 'farm-1', { name: 'X' }, h.deps),
      () => deleteFarm(ANONYMOUS, 'farm-1', h.deps),
      () => listPlots(ANONYMOUS, 'farm-1', h.deps),
      () => createPlot(ANONYMOUS, 'farm-1', { name: 'X' }, h.deps),
      () => updatePlot(ANONYMOUS, 'plot-1', { name: 'X' }, h.deps),
      () => deletePlot(ANONYMOUS, 'plot-1', h.deps),
    ]

    /*
     * Read structurally rather than through `isErr`. The nine use cases return nine different
     * `Ok` types, and a type guard over that union narrows to the first one — the only thing
     * being asserted here is the failure, so the failure is all that is typed.
     */
    const attempts = (await Promise.all(calls.map((call) => call()))).map((r) => {
      const shape = r as { ok?: boolean; error?: { code?: string } }
      return { ok: shape.ok === true, code: shape.error?.code }
    })

    expect(attempts).toHaveLength(9)
    for (const attempt of attempts) {
      expect(attempt.ok).toBe(false)
      expect(attempt.code).toBe('UNAUTHENTICATED')
    }
  })

  it('refuses a consumer, who has no farms', async () => {
    const result = await listMyFarms(consumer, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses a suspended farmer', async () => {
    const suspended: Actor = { ...alice, status: 'SUSPENDED' }
    expect(isErr(await listMyFarms(suspended, h.deps))).toBe(true)
  })
})

describe('creating and editing', () => {
  it('creates a farm for the caller, not for an id they supplied', async () => {
    const result = await createFarm(alice, { name: 'New field', adminAreaId: 'area-1' }, h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.name).toBe('New field')

    // It appears in Alice's list and not in Bob's.
    const bobFarms = await listMyFarms(bob, h.deps)
    if (!isOk(bobFarms)) throw new Error('expected ok')
    expect(bobFarms.value.map((f) => f.id)).not.toContain(result.value.id)
  })

  it('refuses a blank name', async () => {
    const result = await createFarm(alice, { name: '   ', adminAreaId: 'area-1' }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('refuses an area without its unit', async () => {
    const result = await updateFarm(alice, 'farm-1', { areaAmountMilli: 2000 }, h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('refuses an irrigation method when there is no irrigation', async () => {
    const result = await updateFarm(
      alice,
      'farm-1',
      { irrigationAvailable: false, irrigationMethod: 'DRIP' },
      h.deps,
    )
    expect(isErr(result)).toBe(true)
  })

  it('audits the field names that changed, not their values', async () => {
    await updateFarm(alice, 'farm-1', { soilType: 'CLAY_LOAM' }, h.deps)
    expect(h.audit.mock.calls.at(-1)?.[0]?.reason).toBe('soilType')
  })

  it('writes nothing when a form is submitted unchanged', async () => {
    await updateFarm(alice, 'farm-1', { name: 'Alice field' }, h.deps)
    expect(h.audit).not.toHaveBeenCalled()
  })
})
