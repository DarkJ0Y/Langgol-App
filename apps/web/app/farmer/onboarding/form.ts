/**
 * Reading the farmer onboarding form.
 *
 * Separate from `actions.ts` so it can be tested. A `'use server'` module may export only async
 * functions, so a schema declared inside one is unreachable from a test runner — and that is
 * precisely where the address-form bug lived: hidden inputs always post a string, the schema
 * treated `""` as malformed, and saving without GPS became impossible. Everything that
 * interprets `FormData` lives in this file, and this file has tests.
 *
 * ## The rule this module exists to enforce
 *
 * **An empty field means "not answered", never "invalid" and never "zero".** Every question on
 * the farmer questionnaire is skippable, so a blank select and a blank number box must both come
 * out as `null` and travel to the use case as a deliberate "no answer" rather than being dropped
 * or rejected. A form that refuses to save because somebody has not decided about irrigation yet
 * is a form that loses the five answers they did give.
 */

import { parseLandAmount, type LandUnit } from '@langgol/domain/farming'
import type { FarmingFieldsUpdate } from '@langgol/domain/farming'

/** What the form posts back for "I did not answer this". */
const UNANSWERED = ''

/** A select or text field, read as `null` when left alone. */
function optional(data: FormData, name: string): string | null {
  const raw = data.get(name)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === UNANSWERED ? null : trimmed
}

/**
 * The irrigation question, which is a THREE-state answer.
 *
 * "Yes", "no", and "have not said" are all real, and the third is the state every farmer starts
 * in. A plain checkbox could not express it: an unticked box posts nothing, which would make "I
 * have no irrigation" indistinguishable from "I have not reached that question yet" — and the
 * completion meter would then nag a rain-fed farmer forever about something they had answered.
 */
function tristate(data: FormData, name: string): boolean | null {
  const raw = optional(data, name)
  if (raw === 'YES') return true
  if (raw === 'NO') return false
  return null
}

export class FarmerFormError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'FarmerFormError'
  }
}

/**
 * Turn a submitted questionnaire into a use-case command.
 *
 * Every key is always present in the result — the form shows every question on every save, so
 * every question is being answered, including with "no answer". Omitting the blank ones would
 * make clearing a previously-given answer impossible: the use case cannot tell a field that was
 * cleared from one the form never mentioned.
 */
export function readFarmerForm(data: FormData): FarmingFieldsUpdate {
  const years = optional(data, 'farmingExperienceYears')
  let farmingExperienceYears: number | null = null

  if (years !== null) {
    // Bangla numerals reach here from a Bangla keyboard the interface itself encouraged.
    const normalised = years.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    if (!/^\d{1,3}$/.test(normalised)) {
      throw new FarmerFormError('Enter whole years', 'farmingExperienceYears')
    }
    farmingExperienceYears = Number(normalised)
  }

  const landUnit = optional(data, 'landUnit')

  /*
   * The land amount and its unit are a pair, and the pair is assembled here rather than in two
   * independent fields. `parseLandAmount` throws on nonsense, returns null on blank, and accepts
   * Bangla digits — all three of which the domain owns, so this module does not re-implement it.
   */
  let totalLandAmountMilli: number | null = null
  const landRaw = optional(data, 'totalLandAmount')
  if (landRaw !== null) {
    totalLandAmountMilli = parseLandAmount(landRaw)
  }

  /*
   * If the farmer typed an area but did not choose a unit, default to the one the whole country
   * uses for small plots rather than rejecting the submission. Refusing here would throw away
   * every other answer on the screen over a select they did not notice.
   */
  const resolvedUnit: LandUnit | null =
    totalLandAmountMilli === null ? null : ((landUnit ?? 'DECIMAL') as LandUnit)

  const irrigationAvailable = tristate(data, 'irrigationAvailable')

  /*
   * With no irrigation there is no method, and the only coherent water source is rain. The form
   * hides both questions in that case, so the browser posts whatever was selected before the
   * farmer changed their mind — and posting it would be refused by the domain as a
   * contradiction. Clearing them here turns a confusing validation error into the obvious
   * behaviour.
   */
  const irrigationMethod = irrigationAvailable === false ? null : optional(data, 'irrigationMethod')
  const waterSourceRaw = optional(data, 'waterSource')
  const waterSource =
    irrigationAvailable === false && waterSourceRaw !== 'RAIN' ? null : waterSourceRaw

  return {
    farmingExperienceYears,
    farmerType: optional(data, 'farmerType'),
    totalLandAmountMilli,
    landUnit: resolvedUnit,
    ownershipType: optional(data, 'ownershipType'),
    irrigationAvailable,
    irrigationMethod,
    waterSource,
    farmingMethod: optional(data, 'farmingMethod'),
  }
}
