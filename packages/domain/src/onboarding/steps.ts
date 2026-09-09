/**
 * What onboarding is made of, and how much of it anybody is actually obliged to do.
 *
 * ## The rule this module exists to encode
 *
 * **Nothing here gates anything.** A farmer who has verified a phone number and nothing else can
 * list produce, sell it and be paid. The steps below are a description of what is worth doing and
 * why, not a queue that has to be emptied before the platform works.
 *
 * That is not a preference; it is the whole point. The people Langgol is for are on cheap phones
 * with metered data and variable literacy, and a registration flow that demands a farm boundary
 * and a national identity card up front is a flow they abandon. Every field asked for later is a
 * field somebody had a reason to fill in.
 *
 * ## Three tiers, and what each honestly means
 *
 *  - **REQUIRED** — without it the account cannot function at all. A name to address somebody by,
 *    a proven phone number, and a role. Three things, and deliberately only three.
 *  - **RECOMMENDED** — the platform works without it but works badly. No location means no
 *    delivery estimate; no farm means no crop advice that knows where you are.
 *  - **OPTIONAL** — genuinely optional. Skipping it costs a specific extra feature and nothing
 *    else, and the step says which one.
 *
 * A step's tier is a promise to the user. Marking something REQUIRED that is not is how a
 * progressive flow quietly becomes the wall it was meant to replace.
 *
 * Refs: docs/01_MVP_REQUIREMENTS.md §79; docs/08_BANGLADESH_CONTEXT.md §2
 */

import type { Role } from '../identity/roles.js'

export const STEP_TIERS = ['REQUIRED', 'RECOMMENDED', 'OPTIONAL'] as const
export type StepTier = (typeof STEP_TIERS)[number]

/**
 * Everything the step table needs to know about a user.
 *
 * A flat set of booleans rather than the records they came from, for the same reason the
 * agricultural profile takes summaries: a pure function that cannot see a phone number cannot
 * accidentally depend on one, and every one of these is cheap for a repository to answer.
 */
export interface OnboardingFacts {
  /** A name the user confirmed, rather than one defaulted at registration. */
  readonly hasConfirmedName: boolean
  readonly phoneVerified: boolean
  readonly roles: readonly string[]
  /** An address or a farm with an administrative area. Either answers "where are you?". */
  readonly hasLocation: boolean
  readonly hasFarm: boolean
  /** A production record for the current or previous season — something growing now. */
  readonly hasCurrentCrop: boolean
  /** The role-specific questionnaire has been opened and something saved. */
  readonly roleProfileStarted: boolean
  readonly roleProfileComplete: boolean
  readonly kycStatus: 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED'
}

export const NO_PROGRESS: OnboardingFacts = {
  hasConfirmedName: false,
  phoneVerified: false,
  roles: [],
  hasLocation: false,
  hasFarm: false,
  hasCurrentCrop: false,
  roleProfileStarted: false,
  roleProfileComplete: false,
  kycStatus: 'NONE',
}

/** The steps, in the order the flow presents them. */
export const ONBOARDING_STEPS = [
  'BASIC_PROFILE',
  'PHONE_VERIFICATION',
  'ROLE',
  'LOCATION',
  'ROLE_PROFILE',
  'FARM',
  'CURRENT_CROP',
  'KYC',
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export const isOnboardingStep = (value: unknown): value is OnboardingStep =>
  typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)

/** Roles that farm. `FARM` and `CURRENT_CROP` mean nothing to anybody else. */
const FARMING_ROLES: readonly string[] = ['FARMER']

/** Roles that trade under a business name and therefore have a role questionnaire. */
const BUSINESS_ROLES: readonly string[] = [
  'RETAILER',
  'WHOLESALER',
  'SUPPLIER',
  'AGRICULTURAL_EXPERT',
  'LOGISTICS_PROVIDER',
  'CONSUMER',
]

export interface StepDescriptor {
  readonly step: OnboardingStep
  readonly tier: StepTier
  /**
   * Whether this step means anything for this user.
   *
   * A consumer is never asked about a farm, and — this is the part that matters — a consumer is
   * never MEASURED against one either. Counting inapplicable steps is how a shopper ends up
   * permanently at sixty per cent with nothing they can do about it.
   */
  readonly appliesTo: (roles: readonly string[]) => boolean
  readonly satisfiedBy: (facts: OnboardingFacts) => boolean
  /** Where the user goes to do it. */
  readonly href: string
}

const always = (): boolean => true
const forFarmers = (roles: readonly string[]): boolean =>
  roles.some((role) => FARMING_ROLES.includes(role))
const forBusinesses = (roles: readonly string[]): boolean =>
  roles.some((role) => BUSINESS_ROLES.includes(role))

export const STEP_DESCRIPTORS: Record<OnboardingStep, StepDescriptor> = {
  /*
   * The three REQUIRED steps, and nothing else is.
   *
   * A name so the platform can address somebody, a proven number because it is how they sign in
   * and how they are reached about an order, and a role because every screen in the product
   * differs by it. Everything past this is a improvement, not a prerequisite.
   */
  BASIC_PROFILE: {
    step: 'BASIC_PROFILE',
    tier: 'REQUIRED',
    appliesTo: always,
    satisfiedBy: (facts) => facts.hasConfirmedName,
    href: '/account',
  },
  PHONE_VERIFICATION: {
    step: 'PHONE_VERIFICATION',
    tier: 'REQUIRED',
    appliesTo: always,
    satisfiedBy: (facts) => facts.phoneVerified,
    href: '/account/verify-phone',
  },
  ROLE: {
    step: 'ROLE',
    tier: 'REQUIRED',
    appliesTo: always,
    satisfiedBy: (facts) => facts.roles.length > 0,
    href: '/auth/role',
  },

  /*
   * RECOMMENDED. The platform works without these and works worse.
   */
  LOCATION: {
    step: 'LOCATION',
    tier: 'RECOMMENDED',
    appliesTo: always,
    // An address or a farm — either answers the question, and demanding the one they have not got
    // is how a farmer with no postal address gets stuck.
    satisfiedBy: (facts) => facts.hasLocation,
    href: '/account/addresses',
  },
  ROLE_PROFILE: {
    step: 'ROLE_PROFILE',
    tier: 'RECOMMENDED',
    appliesTo: forBusinesses,
    satisfiedBy: (facts) => facts.roleProfileComplete,
    href: '/account/profile',
  },
  FARM: {
    step: 'FARM',
    tier: 'RECOMMENDED',
    appliesTo: forFarmers,
    satisfiedBy: (facts) => facts.hasFarm,
    href: '/farmer/farms',
  },

  /*
   * OPTIONAL. Each costs one named feature and nothing else, and the prompt says which.
   */
  CURRENT_CROP: {
    step: 'CURRENT_CROP',
    tier: 'OPTIONAL',
    appliesTo: forFarmers,
    satisfiedBy: (facts) => facts.hasCurrentCrop,
    href: '/farmer/farms',
  },
  KYC: {
    step: 'KYC',
    tier: 'OPTIONAL',
    appliesTo: always,
    /*
     * PENDING does not count as done.
     *
     * Submitting is not being verified, and a checklist that ticked on submission would tell
     * somebody they had finished while a reviewer had not yet looked. The prompt distinguishes
     * the two so the screen can say "being checked" rather than either "done" or "not started".
     */
    satisfiedBy: (facts) => facts.kycStatus === 'VERIFIED',
    href: '/account/verification',
  },
}

/** The steps that mean something for this user, in flow order. */
export function applicableSteps(roles: readonly string[]): readonly StepDescriptor[] {
  return ONBOARDING_STEPS.map((step) => STEP_DESCRIPTORS[step]).filter((descriptor) =>
    descriptor.appliesTo(roles),
  )
}

/** Whether a step is done. Inapplicable steps are neither done nor outstanding — they are absent. */
export function isStepSatisfied(step: OnboardingStep, facts: OnboardingFacts): boolean {
  return STEP_DESCRIPTORS[step].satisfiedBy(facts)
}

/** Every role that changes which steps apply. Exported so a test can prove the table is total. */
export const ROLES_AFFECTING_STEPS: readonly Role[] = [
  'FARMER',
  'CONSUMER',
  'RETAILER',
  'WHOLESALER',
  'SUPPLIER',
  'AGRICULTURAL_EXPERT',
  'LOGISTICS_PROVIDER',
]
