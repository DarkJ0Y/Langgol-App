/**
 * Production records — what a farmer actually harvested and sold.
 *
 * This is the history the platform's future depends on: yield prediction, forecasting, credit
 * scoring and price prediction all read from here. That places one obligation above every other
 * on this module — **nothing in a production record may be invented.**
 *
 * ## Revenue is derived, never entered
 *
 * `revenue = quantity sold × price per unit`. A farmer may state what they sold and what they
 * were paid; they may not state the product of the two. The reason is not distrust — it is that
 * a stored revenue which disagrees with its own inputs is unfalsifiable later, and a credit score
 * built on it would be scoring a typo.
 *
 * The rule is enforced three deep: this module computes it, the use case never reads it from the
 * command, and a database trigger overwrites whatever is submitted. See the p8 migration.
 *
 * ## Yield is derived too
 *
 * Yield per unit area is the single most useful number here and the easiest to get wrong, so it
 * is computed on read from quantity and area rather than stored. A stored yield is a number that
 * silently stops matching its inputs the first time either is corrected.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §4; docs/02_DATABASE.md §6
 */

import { Money, type Poisha } from '../money/index.js'
import { baseUnitsPer, type SaleUnit } from '../quantity/index.js'
import { toMilliDecimals, type LandUnit } from '../farming/index.js'

/**
 * The seasons a Bangladeshi farmer names.
 *
 * Two overlapping vocabularies are in daily use and both belong here: `BORO`, `AUS` and `AMAN`
 * are what everyone calls the three rice seasons, while `RABI` and `KHARIF` are the general
 * winter and monsoon seasons used for everything else. Forcing rice into "Kharif-2" would be
 * technically tidy and would produce a form no farmer recognises.
 *
 * `YEAR_ROUND` is for perennials and homestead plots that never fit a season at all.
 */
export const SEASONS = ['BORO', 'AUS', 'AMAN', 'RABI', 'KHARIF', 'YEAR_ROUND'] as const
export type Season = (typeof SEASONS)[number]

export const isSeason = (value: unknown): value is Season =>
  typeof value === 'string' && (SEASONS as readonly string[]).includes(value)

/**
 * The earliest year a record may claim.
 *
 * Not a guess about farming history — it is a typo guard. A four-digit year is easy to fat-finger
 * and a record dated 1900 would distort every average computed over the column.
 */
export const EARLIEST_PRODUCTION_YEAR = 2000

export class ProductionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'ProductionError'
  }
}

function fail(message: string, code: string, field: string): never {
  throw new ProductionError(message, code, field)
}

/** What a farmer supplies. Note the absence of `revenue` — it is not theirs to state. */
export interface ProductionInput {
  readonly season?: string | null
  readonly year?: number | null
  readonly cultivatedAreaMilli?: number | null
  readonly cultivatedAreaUnit?: string | null
  readonly productionQuantityBase?: bigint | null
  readonly productionUnit?: string | null
  readonly productionCostPoisha?: bigint | null
  readonly sellingQuantityBase?: bigint | null
  readonly sellingPricePoisha?: bigint | null
  readonly harvestDate?: Date | null
}

/** A record as stored. Every field is nullable — a half-entered season is still worth keeping. */
export interface ProductionFields {
  readonly season: Season | null
  readonly year: number | null
  readonly cultivatedAreaMilli: number | null
  readonly cultivatedAreaUnit: LandUnit | null
  readonly productionQuantityBase: bigint | null
  readonly productionUnit: SaleUnit | null
  readonly productionCostPoisha: Poisha | null
  readonly sellingQuantityBase: bigint | null
  readonly sellingPricePoisha: Poisha | null
  readonly harvestDate: Date | null
}

/**
 * Revenue, computed from what was sold and what it fetched.
 *
 * `sellingPricePoisha` is the price per SALE unit — what a farmer knows and says, "forty taka a
 * kilo" — while the quantity is in base units. The conversion is the unit table's, so the two
 * cannot drift: change what a mon is worth and every revenue recomputes consistently.
 *
 * Returns null when either input is missing. A record with no sale is a real record — plenty of
 * production is eaten, stored, or given away — and inventing a zero would make "sold nothing" and
 * "sold for nothing" the same row.
 */
export function computeRevenuePoisha(
  sellingQuantityBase: bigint | null,
  sellingPricePoisha: Poisha | null,
  productionUnit: SaleUnit | null,
): Poisha | null {
  if (sellingQuantityBase === null || sellingPricePoisha === null || productionUnit === null) {
    return null
  }

  const perUnit = baseUnitsPer(productionUnit)
  if (perUnit <= 0n) return null

  /*
   * Through `Money.multiplyByRatio` rather than by hand, so the one place that owns rounding owns
   * this too. TRUNCATE, not HALF_UP: poisha is the smallest unit of money there is, and rounding
   * a half-poisha up would create money that was never paid.
   */
  return Money.multiplyByRatio(sellingPricePoisha, sellingQuantityBase, perUnit, 'TRUNCATE')
}

/**
 * Margin: revenue less the cost of producing it.
 *
 * May legitimately be negative — a bad season is a real outcome and one a credit model needs to
 * see. Returns null rather than assuming a zero cost when the farmer has not recorded one.
 */
export function computeMarginPoisha(
  revenuePoisha: Poisha | null,
  productionCostPoisha: Poisha | null,
): Poisha | null {
  if (revenuePoisha === null || productionCostPoisha === null) return null
  return Money.subtract(revenuePoisha, productionCostPoisha)
}

/**
 * Yield in base units per land decimal (শতক).
 *
 * Expressed against the decimal because that is the canonical land unit everywhere else in the
 * schema, so yields from a farmer who works in bigha and one who works in acres are directly
 * comparable without either of them having to know.
 *
 * Scaled by 1000 and returned as an integer: yields are small numbers per decimal and a float
 * here would drift the moment anything averaged them.
 */
export function computeYieldPerDecimalMilli(
  productionQuantityBase: bigint | null,
  cultivatedAreaMilli: number | null,
  cultivatedAreaUnit: LandUnit | null,
): bigint | null {
  if (
    productionQuantityBase === null ||
    cultivatedAreaMilli === null ||
    cultivatedAreaUnit === null
  ) {
    return null
  }

  const areaMilliDecimals = BigInt(toMilliDecimals(cultivatedAreaMilli, cultivatedAreaUnit))
  if (areaMilliDecimals <= 0n) return null

  // (quantity / decimals) × 1000, done as one integer expression so nothing is lost mid-way.
  return (productionQuantityBase * 1000n * 1000n) / areaMilliDecimals
}

/**
 * Validate what a farmer entered.
 *
 * Rejects the impossible and accepts the incomplete. A record with only a season and a year is
 * worth storing — it is the start of a history — and refusing it would teach farmers to enter
 * nothing at all.
 */
export function validateProduction(input: ProductionInput): Record<string, unknown> {
  const changes: Record<string, unknown> = {}

  if (input.season !== undefined) {
    if (input.season === null || input.season === '') changes['season'] = null
    else if (!isSeason(input.season))
      fail('Choose a season from the list', 'UNKNOWN_SEASON', 'season')
    else changes['season'] = input.season
  }

  if (input.year !== undefined) {
    const year = input.year
    if (year !== null) {
      if (!Number.isInteger(year)) fail('Enter the year as a number', 'NOT_INTEGER', 'year')
      if (year < EARLIEST_PRODUCTION_YEAR) fail('That year looks too early', 'TOO_EARLY', 'year')
      // A harvest cannot be recorded far into the future. One year ahead allows for a season
      // that spans a new year, which Boro does.
      if (year > new Date().getUTCFullYear() + 1)
        fail('That year is in the future', 'FUTURE', 'year')
    }
    changes['year'] = year
  }

  for (const [field, label] of [
    ['productionQuantityBase', 'quantity'],
    ['sellingQuantityBase', 'quantity'],
    ['productionCostPoisha', 'cost'],
    ['sellingPricePoisha', 'price'],
  ] as const) {
    const value = input[field]
    if (value === undefined) continue
    if (value !== null && value < 0n) {
      fail(`A ${label} cannot be negative`, 'NEGATIVE', field)
    }
    changes[field] = value
  }

  if (input.cultivatedAreaMilli !== undefined) {
    const area = input.cultivatedAreaMilli
    if (area !== null && area <= 0)
      fail('Enter an area greater than zero', 'NOT_POSITIVE', 'cultivatedArea')
    changes['cultivatedAreaMilli'] = area
  }

  for (const field of ['cultivatedAreaUnit', 'productionUnit'] as const) {
    const value = input[field]
    if (value === undefined) continue
    changes[field] = value === null || value === '' ? null : value
  }

  if (input.harvestDate !== undefined) changes['harvestDate'] = input.harvestDate

  return changes
}

/* ------------------------------------------------------------------- analytics */

export interface ProductionSummary {
  readonly records: number
  /** Total land worked, in milli-decimals. Null when no record carries an area. */
  readonly totalAreaMilliDecimals: bigint | null
  /** Only summable across records sharing a base unit; see `totalsByUnit`. */
  readonly totalsByUnit: ReadonlyMap<SaleUnit, bigint>
  readonly totalRevenuePoisha: Poisha | null
  readonly totalCostPoisha: Poisha | null
  readonly seasonsRecorded: number
}

/**
 * Dashboard figures, computed from stored rows and nothing else.
 *
 * Two things this deliberately does NOT do:
 *
 *  - **It never fabricates a total.** A farmer with no recorded revenue gets `null`, which the
 *    screen renders as "not recorded". Showing ৳0 would state something the data does not say.
 *  - **It never sums across incompatible units.** Ten mon of rice and twelve pieces of pumpkin
 *    have no meaningful total, so quantities are grouped by unit rather than added into a single
 *    misleading number.
 */
export function summarise(
  records: readonly (ProductionFields & { readonly revenuePoisha: Poisha | null })[],
): ProductionSummary {
  const totalsByUnit = new Map<SaleUnit, bigint>()
  let totalArea: bigint | null = null
  let totalRevenue: Poisha | null = null
  let totalCost: Poisha | null = null
  const seasons = new Set<string>()

  for (const record of records) {
    if (record.season !== null && record.year !== null) {
      seasons.add(`${record.season}-${String(record.year)}`)
    }

    if (record.cultivatedAreaMilli !== null && record.cultivatedAreaUnit !== null) {
      const area = BigInt(toMilliDecimals(record.cultivatedAreaMilli, record.cultivatedAreaUnit))
      totalArea = (totalArea ?? 0n) + area
    }

    if (record.productionQuantityBase !== null && record.productionUnit !== null) {
      const unit = record.productionUnit
      totalsByUnit.set(unit, (totalsByUnit.get(unit) ?? 0n) + record.productionQuantityBase)
    }

    // Through Money.add so every total in the app rounds and guards the same way.
    if (record.revenuePoisha !== null) {
      totalRevenue = Money.add(totalRevenue ?? Money.fromPoisha(0n), record.revenuePoisha)
    }
    if (record.productionCostPoisha !== null) {
      totalCost = Money.add(totalCost ?? Money.fromPoisha(0n), record.productionCostPoisha)
    }
  }

  return {
    records: records.length,
    totalAreaMilliDecimals: totalArea,
    totalsByUnit,
    totalRevenuePoisha: totalRevenue,
    totalCostPoisha: totalCost,
    seasonsRecorded: seasons.size,
  }
}
