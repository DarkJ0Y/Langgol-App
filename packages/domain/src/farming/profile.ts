/**
 * Validation and completeness for the agronomic half of a farmer's profile.
 *
 * ## What this module refuses to assume
 *
 * Every field here is optional, and that is the design rather than laziness. A farmer signing up
 * on a borrowed phone at the edge of coverage should reach a working account, and the platform
 * must not treat "has not filled in irrigation method yet" as "invalid". Identity documents,
 * payout destinations, GPS and email are separate systems with their own verification, and none
 * of them is a precondition for having a farmer profile.
 *
 * What IS enforced is internal consistency: a profile may be incomplete, but it may not be
 * self-contradictory. "No irrigation, drip method" is not missing data, it is wrong data, and
 * storing it would corrupt every advisory rule that reads the pair.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2
 */

import {
  isFarmerType,
  isFarmingMethod,
  isIrrigationMethod,
  isLandOwnershipType,
  isLandUnit,
  isWaterSource,
  type FarmerType,
  type FarmingMethod,
  type IrrigationMethod,
  type LandOwnershipType,
  type LandUnit,
  type WaterSource,
} from './catalogue.js'
import { MAX_LAND_MILLI_DECIMALS, toMilliDecimals } from './land.js'

/**
 * The longest farming career the form will accept.
 *
 * Someone reporting 80 years began as a child and is now past ninety — possible, and the cap
 * admits it. Past that it is a birth year typed into the wrong box.
 */
export const MAX_EXPERIENCE_YEARS = 80

export class FarmingProfileError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'FarmingProfileError'
  }
}

/** The agronomic fields, as stored. `null` means "not answered", never "zero" or "none". */
export interface FarmingFields {
  readonly farmingExperienceYears: number | null
  readonly farmerType: FarmerType | null
  readonly totalLandAmountMilli: number | null
  readonly landUnit: LandUnit | null
  readonly ownershipType: LandOwnershipType | null
  readonly irrigationAvailable: boolean | null
  readonly irrigationMethod: IrrigationMethod | null
  readonly waterSource: WaterSource | null
  readonly farmingMethod: FarmingMethod | null
}

/**
 * A partial update. A key that is absent is left alone; a key present and `null` is cleared.
 *
 * That distinction is the whole reason this is not a loose `Partial<FarmingFields>` — with
 * `exactOptionalPropertyTypes` the compiler keeps "absent" and "explicitly null" apart, which is
 * what makes PATCH safe to send from a form that only knows about some of the fields.
 */
export interface FarmingFieldsUpdate {
  readonly farmingExperienceYears?: number | null
  readonly farmerType?: string | null
  readonly totalLandAmountMilli?: number | null
  readonly landUnit?: string | null
  readonly ownershipType?: string | null
  readonly irrigationAvailable?: boolean | null
  readonly irrigationMethod?: string | null
  readonly waterSource?: string | null
  readonly farmingMethod?: string | null
}

function fail(message: string, code: string, field: string): never {
  throw new FarmingProfileError(message, code, field)
}

/** The enum-valued fields, and the guard that narrows each one. */
const ENUM_FIELDS = [
  ['farmerType', isFarmerType],
  ['landUnit', isLandUnit],
  ['ownershipType', isLandOwnershipType],
  ['irrigationMethod', isIrrigationMethod],
  ['waterSource', isWaterSource],
  ['farmingMethod', isFarmingMethod],
] as const satisfies readonly (readonly [keyof FarmingFieldsUpdate, (v: unknown) => boolean])[]

/**
 * Validate a partial update against the profile it will be applied to.
 *
 * Takes `current` as well as the change because the consistency rules span fields: switching
 * irrigation off has to be checked against the method already stored, not only against what this
 * particular form happened to submit. Validating the submission alone would let a two-step edit
 * reach a state neither step could reach directly.
 *
 * Returns the validated changes, narrowed to the domain types.
 */
export function validateFarmingUpdate(
  update: FarmingFieldsUpdate,
  current: FarmingFields,
): Partial<FarmingFields> {
  const changes: Record<string, unknown> = {}

  if (update.farmingExperienceYears !== undefined) {
    const years = update.farmingExperienceYears
    if (years !== null) {
      if (!Number.isInteger(years)) {
        fail('Enter whole years', 'NOT_INTEGER', 'farmingExperienceYears')
      }
      if (years < 0) {
        fail('Years cannot be negative', 'NEGATIVE', 'farmingExperienceYears')
      }
      if (years > MAX_EXPERIENCE_YEARS) {
        fail('That looks too high. Please check it.', 'TOO_LARGE', 'farmingExperienceYears')
      }
    }
    changes['farmingExperienceYears'] = years
  }

  for (const [field, guard] of ENUM_FIELDS) {
    const value = update[field]
    if (value === undefined) continue
    if (value === null || value === '') {
      changes[field] = null
      continue
    }
    if (!guard(value)) {
      fail('That is not one of the available choices', 'UNKNOWN_VALUE', field)
    }
    changes[field] = value
  }

  if (update.totalLandAmountMilli !== undefined) {
    const amount = update.totalLandAmountMilli
    if (amount !== null) {
      if (!Number.isInteger(amount)) {
        fail('Enter the area as a number', 'NOT_INTEGER', 'totalLandArea')
      }
      if (amount <= 0) {
        fail('Enter an area greater than zero', 'NOT_POSITIVE', 'totalLandArea')
      }
    }
    changes['totalLandAmountMilli'] = amount
  }

  if (update.irrigationAvailable !== undefined) {
    changes['irrigationAvailable'] = update.irrigationAvailable
  }

  const next = { ...current, ...changes } as FarmingFields

  /*
   * An amount without a unit is a number nobody can read, and a unit without an amount is noise.
   * Checked against the MERGED state, so clearing one half of the pair while leaving the other
   * is caught even though the submission only mentioned one field.
   */
  if ((next.totalLandAmountMilli === null) !== (next.landUnit === null)) {
    fail(
      'Give both the land area and its unit, or neither',
      'INCOMPLETE_PAIR',
      next.landUnit === null ? 'landUnit' : 'totalLandArea',
    )
  }

  if (next.totalLandAmountMilli !== null && next.landUnit !== null) {
    if (toMilliDecimals(next.totalLandAmountMilli, next.landUnit) > MAX_LAND_MILLI_DECIMALS) {
      fail('That area looks too large. Please check it.', 'TOO_LARGE', 'totalLandArea')
    }
  }

  /*
   * The consistency rule this module exists for.
   *
   * With no irrigation there is no irrigation METHOD — that pair is simply contradictory. The
   * water source is treated more gently: a rain-fed farmer genuinely has one, and it is RAIN, so
   * that combination is allowed while "no irrigation, deep tubewell" is not.
   */
  if (next.irrigationAvailable === false) {
    if (next.irrigationMethod !== null) {
      fail(
        'You said there is no irrigation, so leave the irrigation method blank',
        'IRRIGATION_CONTRADICTION',
        'irrigationMethod',
      )
    }
    if (next.waterSource !== null && next.waterSource !== 'RAIN') {
      fail(
        'You said there is no irrigation, so the water source can only be rain',
        'WATER_SOURCE_CONTRADICTION',
        'waterSource',
      )
    }
  }

  return changes as Partial<FarmingFields>
}

/* ------------------------------------------------------------------ completeness */

/**
 * The six questions the onboarding screen asks, in the order it asks them.
 *
 * Completion is measured against THIS list rather than against every column on the table.
 * Counting fields the screen never offers — verification status, payout rail, risk tier — would
 * report a farmer as half-finished for work that is not theirs to do, which is both wrong and
 * discouraging.
 */
export const ONBOARDING_STEPS = [
  'farmingExperienceYears',
  'totalLandArea',
  'ownershipType',
  'irrigationAvailable',
  'waterSource',
  'farmingMethod',
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export interface FarmingCompletion {
  readonly answered: readonly OnboardingStep[]
  readonly missing: readonly OnboardingStep[]
  /** 0–100, rounded. For a progress indicator, never for a business decision. */
  readonly percent: number
  readonly isComplete: boolean
}

/**
 * How far through the farmer questionnaire somebody is.
 *
 * Note that `irrigationAvailable: false` counts as ANSWERED. "No, I have no irrigation" is a real
 * answer to a real question, and a completion meter that treated it as a gap would nag a rain-fed
 * farmer forever about a field they have already correctly filled in.
 */
export function farmingCompletion(fields: FarmingFields): FarmingCompletion {
  const isAnswered: Record<OnboardingStep, boolean> = {
    farmingExperienceYears: fields.farmingExperienceYears !== null,
    totalLandArea: fields.totalLandAmountMilli !== null && fields.landUnit !== null,
    ownershipType: fields.ownershipType !== null,
    irrigationAvailable: fields.irrigationAvailable !== null,
    // Not asked of a farmer who has no irrigation, so it cannot be counted as missing for them.
    waterSource: fields.irrigationAvailable === false || fields.waterSource !== null,
    farmingMethod: fields.farmingMethod !== null,
  }

  const answered = ONBOARDING_STEPS.filter((step) => isAnswered[step])
  const missing = ONBOARDING_STEPS.filter((step) => !isAnswered[step])

  return {
    answered,
    missing,
    percent: Math.round((answered.length / ONBOARDING_STEPS.length) * 100),
    isComplete: missing.length === 0,
  }
}

/** An empty agronomic profile — every question unanswered. The state a new farmer starts in. */
export const EMPTY_FARMING_FIELDS: FarmingFields = {
  farmingExperienceYears: null,
  farmerType: null,
  totalLandAmountMilli: null,
  landUnit: null,
  ownershipType: null,
  irrigationAvailable: null,
  irrigationMethod: null,
  waterSource: null,
  farmingMethod: null,
}
