/**
 * The delivery tariff — cost-recovering by default.
 *
 * This is **cost 1** of the three costs kept deliberately separate in docs/04_MARKETPLACE.md §2:
 * the published, slab-based price the buyer is quoted. It is not what delivery costs Langgol
 * (that is `internal-cost.ts`) and not what it actually cost (that is recorded on the trip).
 *
 * ```text
 * deliveryFee      = baseFee(weightBand) + perKm(weightBand) × max(0, distance − includedDistance)
 * chargeableWeight = max(actualWeight, volumetricWeight)     // pumpkins are light and huge
 * ```
 *
 * Every number in the band table lives in `PlatformConfig['delivery.tariff']`, is versioned, and
 * is stamped onto the quote that used it. None of them appear in this file.
 *
 * Refs: docs/04_MARKETPLACE.md §3; docs/P2_DELIVERED_COST.md §4
 */

import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import { PricingError } from './errors.js'

/** Milligrams in one kilogram. A unit conversion, not a business parameter. */
const MG_PER_KG = 1000000n

/** Metres in one kilometre. */
const METERS_PER_KM = 1000n

export interface TariffBand {
  readonly maxChargeableKg: number
  readonly baseFeePoisha: number
  readonly includedKm: number
  readonly perKmPoisha: number
}

export interface TariffConfig {
  readonly currency: 'BDT'
  readonly provisional: boolean
  readonly bands: readonly TariffBand[]
  readonly aboveTopBand: 'OPS_QUOTE_ONLY'
}

export interface ChargeableWeightInput {
  /** Actual mass in milligrams — the base unit for mass. docs/02_DATABASE.md §6.1. */
  readonly actualMilligrams: bigint
  /** Packed volume in cm³, when known. Absent for most listings at MVP. */
  readonly volumeCm3?: number | null
  /** `PlatformConfig['delivery.volumetricDivisorCm3PerKg']`. */
  readonly volumetricDivisorCm3PerKg: number
}

export interface TariffQuote {
  readonly chargeableMilligrams: bigint
  readonly bandIndex: number
  readonly band: TariffBand
  readonly baseFeePoisha: Poisha
  readonly distanceFeePoisha: Poisha
  /** Distance actually charged for, after the included allowance. */
  readonly chargeableDistanceMeters: number
  readonly tariffPoisha: Poisha
}

/**
 * Chargeable weight: the greater of actual mass and volumetric mass.
 *
 * A vehicle runs out of space long before it runs out of payload, so charging purely by mass
 * would systematically under-recover on bulky, low-density produce.
 */
export function chargeableWeightMilligrams(input: ChargeableWeightInput): bigint {
  const { actualMilligrams, volumeCm3, volumetricDivisorCm3PerKg } = input

  if (actualMilligrams < 0n) {
    throw new PricingError('INVALID_INPUT', 'Actual weight must not be negative')
  }
  if (volumeCm3 == null) return actualMilligrams

  if (!Number.isFinite(volumeCm3) || volumeCm3 < 0) {
    throw new PricingError(
      'INVALID_INPUT',
      `Volume must be a non-negative number, got ${String(volumeCm3)}`,
    )
  }
  if (!Number.isInteger(volumetricDivisorCm3PerKg) || volumetricDivisorCm3PerKg <= 0) {
    throw new PricingError(
      'INVALID_INPUT',
      `Volumetric divisor must be a positive integer, got ${String(volumetricDivisorCm3PerKg)}`,
    )
  }

  // volumetricKg = volumeCm3 / divisor  →  in milligrams, exactly, with one truncation.
  const volumetricMilligrams =
    (BigInt(Math.round(volumeCm3)) * MG_PER_KG) / BigInt(volumetricDivisorCm3PerKg)

  return volumetricMilligrams > actualMilligrams ? volumetricMilligrams : actualMilligrams
}

/** Convert a configured kilogram threshold to milligrams once, at the edge. */
function kgToMilligrams(kg: number): bigint {
  return BigInt(Math.round(kg * Number(MG_PER_KG)))
}

/**
 * Select the tariff band for a chargeable weight.
 *
 * Bands are sorted by `maxChargeableKg`; the first band whose ceiling the weight does not exceed
 * wins. Weight above the top band is deliberately **not** priced automatically — docs/04 §3 says
 * `OPS_QUOTE_ONLY`, because a 2-tonne movement is a negotiated hire, not a slab lookup.
 */
export function selectBand(
  chargeableMilligrams: bigint,
  config: TariffConfig,
): { readonly band: TariffBand; readonly index: number } {
  if (config.bands.length === 0) {
    throw new PricingError('NO_TARIFF_BAND', 'Delivery tariff has no bands configured')
  }

  const ordered = config.bands
    .map((band, index) => ({ band, index }))
    .sort((a, b) => a.band.maxChargeableKg - b.band.maxChargeableKg)

  for (const entry of ordered) {
    if (chargeableMilligrams <= kgToMilligrams(entry.band.maxChargeableKg)) return entry
  }

  const topKg = ordered[ordered.length - 1]!.band.maxChargeableKg
  throw new PricingError(
    'OPS_QUOTE_ONLY',
    'This load is above the published delivery tariff and must be quoted by operations',
    `chargeableMilligrams=${chargeableMilligrams.toString()} exceeds top band ${String(topKg)}kg`,
  )
}

/**
 * Compute the cost-recovering delivery tariff.
 *
 * Distance beyond the included allowance is charged **pro-rata on exact metres**, with a single
 * half-up rounding at the end. Rounding up to a whole kilometre would be a business rule, and
 * business rules are product decisions that belong in config — not an artefact of arithmetic.
 *
 * @param roadMeters Estimated road distance in integer metres (see `geo/distance.ts`).
 */
export function computeTariff(
  chargeableMilligrams: bigint,
  roadMeters: number,
  config: TariffConfig,
): TariffQuote {
  if (!Number.isInteger(roadMeters) || roadMeters < 0) {
    throw new PricingError(
      'INVALID_INPUT',
      `Road distance must be a non-negative integer metre count, got ${String(roadMeters)}`,
    )
  }

  const { band, index } = selectBand(chargeableMilligrams, config)

  const includedMeters = Math.round(band.includedKm * Number(METERS_PER_KM))
  const chargeableDistanceMeters = Math.max(0, roadMeters - includedMeters)

  const baseFeePoisha = Money.fromPoisha(band.baseFeePoisha)
  const distanceFeePoisha = Money.multiplyByRatio(
    Money.fromPoisha(band.perKmPoisha),
    chargeableDistanceMeters,
    METERS_PER_KM,
  )

  return {
    chargeableMilligrams,
    bandIndex: index,
    band,
    baseFeePoisha,
    distanceFeePoisha,
    chargeableDistanceMeters,
    tariffPoisha: Money.add(baseFeePoisha, distanceFeePoisha),
  }
}
