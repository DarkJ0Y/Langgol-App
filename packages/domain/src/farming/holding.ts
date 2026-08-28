/**
 * Farms and plots — the rules a holding must satisfy.
 *
 * Shares the vocabulary in `catalogue.ts` with the farmer profile rather than defining a second
 * one, because "how do you irrigate?" has the same set of answers whether it is asked about a
 * person or about a field. What differs is scope, and that difference is the reason both exist:
 * the profile describes how somebody farms in general, a farm describes one holding, and a plot
 * describes one piece of it. A farmer with an irrigated vegetable patch behind the house and a
 * rain-fed rice field an hour away cannot be described by a single set of answers.
 *
 * A plot's `null` means "same as the farm", not "unknown" — see `resolvePlot`.
 *
 * Refs: docs/02_DATABASE.md §6; docs/08_BANGLADESH_CONTEXT.md §2
 */

import {
  isFarmingMethod,
  isIrrigationMethod,
  isLandOwnershipType,
  isLandUnit,
  isSoilType,
  isWaterSource,
  type FarmingMethod,
  type IrrigationMethod,
  type LandOwnershipType,
  type LandUnit,
  type SoilType,
  type WaterSource,
} from './catalogue.js'
import { MAX_LAND_MILLI_DECIMALS, toMilliDecimals } from './land.js'

export const MAX_NAME_LENGTH = 80

/**
 * How many farms and plots one account may hold.
 *
 * Not an agricultural judgement — a smallholder has one or two farms, and a cooperative
 * officer entering many is a different product. It is a guard against an automated loop filling
 * the table, in the same spirit as the address limit.
 */
export const MAX_FARMS_PER_FARMER = 25
export const MAX_PLOTS_PER_FARM = 50

export class HoldingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'HoldingError'
  }
}

function fail(message: string, code: string, field: string): never {
  throw new HoldingError(message, code, field)
}

/** The descriptive fields a farm carries. All nullable — an incomplete farm is a farm. */
export interface FarmFields {
  readonly name: string
  readonly areaAmountMilli: number | null
  readonly areaUnit: LandUnit | null
  readonly ownershipType: LandOwnershipType | null
  readonly soilType: SoilType | null
  readonly irrigationAvailable: boolean | null
  readonly irrigationMethod: IrrigationMethod | null
  readonly waterSource: WaterSource | null
  readonly farmingMethod: FarmingMethod | null
}

/** A plot's own fields. `null` means "inherit from the farm". */
export interface PlotFields {
  readonly name: string
  readonly areaAmountMilli: number | null
  readonly areaUnit: LandUnit | null
  readonly soilType: SoilType | null
  readonly irrigationMethod: IrrigationMethod | null
}

export interface HoldingUpdate {
  readonly name?: string
  readonly areaAmountMilli?: number | null
  readonly areaUnit?: string | null
  readonly ownershipType?: string | null
  readonly soilType?: string | null
  readonly irrigationAvailable?: boolean | null
  readonly irrigationMethod?: string | null
  readonly waterSource?: string | null
  readonly farmingMethod?: string | null
}

const ENUM_FIELDS = [
  ['areaUnit', isLandUnit],
  ['ownershipType', isLandOwnershipType],
  ['soilType', isSoilType],
  ['irrigationMethod', isIrrigationMethod],
  ['waterSource', isWaterSource],
  ['farmingMethod', isFarmingMethod],
] as const satisfies readonly (readonly [keyof HoldingUpdate, (v: unknown) => boolean])[]

/**
 * Validate a farm or plot update against the state it will be applied to.
 *
 * Takes `current` for the same reason the farmer profile does: switching irrigation off has to be
 * checked against the method already stored, or a two-step edit reaches a contradiction that
 * neither step could reach alone.
 */
export function validateHolding(
  update: HoldingUpdate,
  current: Partial<FarmFields>,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {}

  if (update.name !== undefined) {
    const name = update.name.trim()
    if (name === '') fail('Give this a name', 'NAME_EMPTY', 'name')
    if (name.length > MAX_NAME_LENGTH) fail('That name is too long', 'NAME_TOO_LONG', 'name')
    changes['name'] = name
  }

  for (const [field, guard] of ENUM_FIELDS) {
    const value = update[field]
    if (value === undefined) continue
    if (value === null || value === '') {
      changes[field] = null
      continue
    }
    if (!guard(value)) fail('That is not one of the choices', 'UNKNOWN_VALUE', field)
    changes[field] = value
  }

  if (update.areaAmountMilli !== undefined) {
    const amount = update.areaAmountMilli
    if (amount !== null) {
      if (!Number.isInteger(amount)) fail('Enter the area as a number', 'NOT_INTEGER', 'area')
      if (amount <= 0) fail('Enter an area greater than zero', 'NOT_POSITIVE', 'area')
    }
    changes['areaAmountMilli'] = amount
  }

  if (update.irrigationAvailable !== undefined) {
    changes['irrigationAvailable'] = update.irrigationAvailable
  }

  const next = { ...current, ...changes } as FarmFields

  // The same pair rule as the profile: an area without a unit is a number nobody can read.
  if (((next.areaAmountMilli ?? null) === null) !== ((next.areaUnit ?? null) === null)) {
    fail(
      'Give both the area and its unit, or neither',
      'INCOMPLETE_PAIR',
      (next.areaUnit ?? null) === null ? 'areaUnit' : 'area',
    )
  }

  if (next.areaAmountMilli != null && next.areaUnit != null) {
    if (toMilliDecimals(next.areaAmountMilli, next.areaUnit) > MAX_LAND_MILLI_DECIMALS) {
      fail('That area looks too large. Please check it.', 'TOO_LARGE', 'area')
    }
  }

  /*
   * "No irrigation, drip method" is contradictory rather than incomplete. A rain-fed holding may
   * still record RAIN as its water source, because that is an accurate answer.
   */
  if (next.irrigationAvailable === false) {
    if (next.irrigationMethod != null) {
      fail(
        'You said there is no irrigation, so leave the method blank',
        'IRRIGATION_CONTRADICTION',
        'irrigationMethod',
      )
    }
    if (next.waterSource != null && next.waterSource !== 'RAIN') {
      fail(
        'You said there is no irrigation, so the water source can only be rain',
        'WATER_SOURCE_CONTRADICTION',
        'waterSource',
      )
    }
  }

  return changes
}

/**
 * What a plot's answers actually are, once the farm's are taken into account.
 *
 * A plot stores `null` for anything it does not override, so reading a plot in isolation
 * under-reports it. Every screen and every advisory prompt must resolve against the farm rather
 * than showing "not answered" for a plot that simply agrees with its farm.
 */
export function resolvePlot(
  plot: PlotFields,
  farm: Pick<FarmFields, 'soilType' | 'irrigationMethod' | 'areaUnit'>,
): PlotFields & { readonly inherited: readonly string[] } {
  const inherited: string[] = []

  const soilType =
    plot.soilType ?? (farm.soilType !== null ? (inherited.push('soilType'), farm.soilType) : null)
  const irrigationMethod =
    plot.irrigationMethod ??
    (farm.irrigationMethod !== null
      ? (inherited.push('irrigationMethod'), farm.irrigationMethod)
      : null)
  const areaUnit =
    plot.areaUnit ??
    (plot.areaAmountMilli === null && farm.areaUnit !== null ? farm.areaUnit : plot.areaUnit)

  return {
    name: plot.name,
    areaAmountMilli: plot.areaAmountMilli,
    areaUnit,
    soilType,
    irrigationMethod,
    inherited,
  }
}
