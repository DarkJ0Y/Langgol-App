/**
 * The digital agricultural profile — one identity assembled from every part of Langgol.
 *
 * A farmer is currently a user row, a farmer profile, some farms, a production history, a set of
 * verifications and a role list, and nothing joins them into a thing a cooperative or a lender
 * could be shown. This is that thing. The AGRI-ID is its name, and every future module — credit,
 * traceability, insurance, a government programme, a certificate — attaches to that identifier
 * rather than to a user id, because a user id is an internal key that should never be printed.
 *
 * ## The shape of every section
 *
 * Sections are summaries, never records. `farm` says how many holdings and roughly how much land;
 * it does not carry a farm. `production` says which crops and how many seasons; it does not carry
 * a harvest, and above all not a price. That is not tidiness — it is the disclosure rule made
 * structural, because a summary has nowhere to put a coordinate.
 *
 * ## What is deliberately absent, and why each one
 *
 *  - **Exact land area.** A band, not a number. Land is wealth, and a precise holding published
 *    against a name is an invitation in a country where land disputes are common. A band still
 *    answers every question a lender or an insurer actually asks.
 *  - **Any money at all.** No revenue, no cost, no margin. A farmer's income is the single most
 *    sensitive derived figure Langgol holds, and it is not needed to establish who somebody is.
 *  - **Location below district.** A union plus a name identifies a household in rural Bangladesh.
 *    District is coarse enough to be safe and specific enough to be useful.
 *  - **Anything from the identity document.** Not the number, not the mask, not the document type.
 *    Whether somebody is verified is the useful fact; how they proved it is nobody's business.
 *
 * ## Preparing for what comes next
 *
 * The architecture question is what a credit module, an insurer or a certificate registry will
 * need, and the answer is: a stable public identifier, a verification standing, and a summary
 * they can reason about without reading anybody's private records. All three are here. A new
 * consumer adds a SECTION with a declared audience; it does not reach past this module into the
 * repositories, which is what keeps the disclosure rule in one place as the surface grows.
 *
 * Refs: docs/07_SECURITY.md §7, §9; docs/03_ARCHITECTURE.md §4
 */

import type { AgriAudience } from './disclosure.js'
import { visibleTo } from './disclosure.js'
import { onboardingCompletion, type OnboardingFacts } from '../onboarding/index.js'

/**
 * How much land somebody works, coarsely.
 *
 * The bands follow the categories Bangladeshi agricultural policy already uses, so a figure here
 * lines up with how a programme or a lender defines eligibility rather than inventing a scale
 * nobody else recognises. Expressed in decimals, the unit land is actually discussed in.
 */
export const LAND_BANDS = ['LANDLESS', 'MARGINAL', 'SMALL', 'MEDIUM', 'LARGE'] as const
export type LandBand = (typeof LAND_BANDS)[number]

/** Upper bound of each band, in decimals. 100 decimals is one acre. */
const BAND_CEILINGS: readonly (readonly [LandBand, number])[] = [
  ['LANDLESS', 0],
  ['MARGINAL', 49],
  ['SMALL', 249],
  ['MEDIUM', 749],
]

/**
 * Place a holding in a band.
 *
 * `null` in, `null` out: somebody who has not said how much land they work is not landless, and
 * recording them as such would be a claim they never made.
 */
export function landBandFor(decimals: number | null): LandBand | null {
  if (decimals === null || !Number.isFinite(decimals) || decimals < 0) return null
  for (const [band, ceiling] of BAND_CEILINGS) {
    if (decimals <= ceiling) return band
  }
  return 'LARGE'
}

/** What a person is, in the vocabulary the rest of the platform already uses. */
export interface AgriRoleSummary {
  readonly role: string
  /** Whether this role's own profile has been verified. Never how. */
  readonly verified: boolean
}

export interface AgriVerificationSummary {
  readonly type: string
  /** The subject-facing word: NOT_VERIFIED, PENDING, VERIFIED or REJECTED. */
  readonly status: string
}

/** Where somebody operates, at a granularity that identifies a region and not a household. */
export interface AgriLocationSummary {
  readonly district: string | null
  readonly division: string | null
}

export interface AgriFarmSummary {
  readonly farmCount: number
  readonly plotCount: number
  /** A band, never an area. See the note at the top of this file. */
  readonly landBand: LandBand | null
  readonly irrigationAvailable: boolean | null
  readonly farmingMethod: string | null
  readonly experienceYears: number | null
}

export interface AgriProductionSummary {
  readonly seasonsRecorded: number
  readonly yearsRecorded: number
  /** Crop names from the curated catalogue. What is grown, never how much or for how much. */
  readonly crops: readonly string[]
  readonly latestYear: number | null
}

export interface AgriBusinessSummary {
  readonly role: string
  /** A trading name is public by nature — it is on the shopfront. */
  readonly businessName: string | null
  readonly verified: boolean
  readonly serviceAreaCount: number
}

/** How much of the profile is filled in, and what would fill it further. */
export interface AgriCompletion {
  readonly answered: number
  readonly total: number
  readonly percent: number
  /** Section names still empty, so a screen can say what to do next. */
  readonly missing: readonly string[]
}

/**
 * The whole card.
 *
 * Every field here is safe by construction. The tripwire in `disclosure.ts` checks that claim on
 * the assembled value before it is served, so a future addition that breaks it fails loudly
 * rather than shipping.
 */
export interface AgriProfile {
  readonly agriId: string
  readonly displayName: string
  readonly memberSince: Date
  readonly roles: readonly AgriRoleSummary[]
  readonly verifications: readonly AgriVerificationSummary[]
  /** Null for an audience that may not see it. See `SECTION_AUDIENCE`. */
  readonly completion: AgriCompletion | null
  readonly location: AgriLocationSummary | null
  readonly farm: AgriFarmSummary | null
  readonly production: AgriProductionSummary | null
  readonly business: AgriBusinessSummary | null
}

/**
 * The raw material, already narrowed by the callers that fetched it.
 *
 * Note what this interface does NOT accept: a user record, a farm record, a production row. The
 * assembly function cannot leak a field it was never given, so the narrowing happens at the
 * boundary where each repository is read and this module only ever sees summaries.
 */
export interface AgriProfileSources {
  readonly agriId: string
  readonly displayName: string
  readonly memberSince: Date
  readonly roles: readonly AgriRoleSummary[]
  readonly verifications: readonly AgriVerificationSummary[]
  readonly location: AgriLocationSummary | null
  readonly farm: AgriFarmSummary | null
  readonly production: AgriProductionSummary | null
  readonly business: AgriBusinessSummary | null
}

/**
 * Which audience may see which section.
 *
 * One table rather than conditionals scattered through the assembly, for the reason every
 * descriptor table in this codebase exists: a section added without an entry is a type error, so
 * nothing ships without somebody having answered the question.
 */
const SECTION_AUDIENCE: Record<
  'roles' | 'verifications' | 'completion' | 'location' | 'farm' | 'production' | 'business',
  AgriAudience
> = {
  /*
   * Public, and each for the same reason: they are what the identifier is FOR. A buyer needs to
   * know they are dealing with a verified farmer in a named district who grows what they claim to
   * grow. Withholding that would leave an identifier that identifies nothing.
   */
  roles: 'PUBLIC',
  verifications: 'PUBLIC',
  location: 'PUBLIC',
  farm: 'PUBLIC',
  production: 'PUBLIC',
  business: 'PUBLIC',

  /*
   * Completion is the owner's own progress meter. Published, it would tell a stranger which parts
   * of somebody's account are unfinished, which is an inventory of where to push.
   */
  completion: 'SELF',
}

/**
 * Recover the onboarding facts from what the card already knows.
 *
 * The card and the dashboard both show a completion percentage to the same person. Computed
 * separately they would eventually disagree, and a user seeing 75% on one screen and 60% on
 * another has found a bug whichever number is "right". So there is ONE calculation, in
 * `domain/onboarding`, and this maps the card's summaries onto its inputs.
 *
 * The mapping is exact for everything the card carries. `roleProfileComplete` is the single
 * approximation: the card knows a business has a trading name, not whether every question on its
 * questionnaire was answered — and a name is the one field that questionnaire actually requires.
 */
function factsFrom(sources: AgriProfileSources): OnboardingFacts {
  const identity = sources.verifications.find((entry) => entry.type === 'IDENTITY')

  const kycStatus: OnboardingFacts['kycStatus'] =
    identity?.status === 'VERIFIED'
      ? 'VERIFIED'
      : identity?.status === 'PENDING'
        ? 'PENDING'
        : identity?.status === 'REJECTED'
          ? 'REJECTED'
          : 'NONE'

  return {
    hasConfirmedName: sources.displayName.trim().length > 0,
    phoneVerified: sources.verifications.some(
      (entry) => entry.type === 'PHONE' && entry.status === 'VERIFIED',
    ),
    roles: sources.roles.map((entry) => entry.role),
    hasLocation: sources.location?.district != null,
    hasFarm: (sources.farm?.farmCount ?? 0) > 0,
    hasCurrentCrop: (sources.production?.seasonsRecorded ?? 0) > 0,
    roleProfileStarted: sources.business !== null,
    roleProfileComplete: (sources.business?.businessName ?? '').trim().length > 0,
    kycStatus,
  }
}

function completionOf(sources: AgriProfileSources): AgriCompletion {
  const result = onboardingCompletion(factsFrom(sources))

  return {
    answered: result.completed.length,
    total: result.steps.length,
    percent: result.percent,
    // The outstanding step names, lower-cased, so the card's existing labels keep working.
    missing: result.steps
      .filter((status) => !status.done)
      .map((status) => status.step.toLowerCase()),
  }
}

/**
 * Assemble a profile for one audience.
 *
 * Pure. Every section the audience may not see is `null` rather than omitted, so the shape is
 * stable and a consumer does not have to distinguish "withheld" from "not sent this time".
 */
export function assembleAgriProfile(
  sources: AgriProfileSources,
  audience: AgriAudience,
): AgriProfile {
  const may = (section: keyof typeof SECTION_AUDIENCE): boolean =>
    visibleTo(SECTION_AUDIENCE[section], audience)

  return {
    agriId: sources.agriId,
    displayName: sources.displayName,
    memberSince: sources.memberSince,
    roles: may('roles') ? sources.roles : [],
    verifications: may('verifications') ? sources.verifications : [],
    // Withheld from a public reader, and not merely blanked: a percentage is still an inventory
    // of what is unfinished even when the section names are removed.
    completion: may('completion') ? completionOf(sources) : null,
    location: may('location') ? sources.location : null,
    farm: may('farm') ? sources.farm : null,
    production: may('production') ? sources.production : null,
    business: may('business') ? sources.business : null,
  }
}
