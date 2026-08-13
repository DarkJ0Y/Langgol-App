/**
 * Authentication modes.
 *
 * OTP is the production authentication mechanism and is unchanged. `development` exists only so
 * engineering can proceed before SMS infrastructure is contracted — it is a scaffold, and it is
 * built so that it cannot survive contact with production.
 *
 * Three independent guards, because one is a convention and three is a control:
 *
 *  1. **Startup** — `production` with any mode other than `otp` refuses to boot.
 *  2. **Use case** — development sign-in refuses when the environment is production, even if
 *     something upstream lied about the mode.
 *  3. **Database** — development sign-in can only authenticate a row flagged
 *     `is_development_fixture`, and a CHECK constraint confines that flag to a reserved phone
 *     block that no real user can occupy.
 *
 * A production deployment that somehow reached development mode would therefore have to have
 * defeated the boot check, the runtime check, and a database constraint on data that does not
 * exist in that database.
 *
 * Refs: docs/03_ARCHITECTURE.md ADR-22; docs/07_SECURITY.md §3
 */

export type AuthMode = 'development' | 'otp'

export const AUTH_MODES: readonly AuthMode[] = ['development', 'otp']

export function isAuthMode(value: string): value is AuthMode {
  return value === 'development' || value === 'otp'
}

export type AppEnvironment = 'development' | 'test' | 'staging' | 'production'

export class AuthModeError extends Error {
  readonly code: 'FORBIDDEN_IN_PRODUCTION' | 'MODE_NOT_ACTIVE' | 'UNKNOWN_IDENTITY'

  constructor(
    code: 'FORBIDDEN_IN_PRODUCTION' | 'MODE_NOT_ACTIVE' | 'UNKNOWN_IDENTITY',
    message: string,
  ) {
    super(message)
    this.name = 'AuthModeError'
    this.code = code
  }
}

/**
 * Is this combination of environment and mode permitted at all?
 *
 * Pure, so it can be asserted in tests and called from both the boot path and the request path
 * without duplicating the rule.
 */
export function isModePermitted(environment: AppEnvironment, mode: AuthMode): boolean {
  if (environment === 'production') return mode === 'otp'
  return true
}

/**
 * Guard used at startup and again at the point of use.
 *
 * Production with development authentication is a **startup failure**, never a permitted login.
 * A system that degrades from "no SMS provider" to "anyone may sign in as an administrator" has
 * chosen the wrong direction to fail in.
 */
export function assertModePermitted(environment: AppEnvironment, mode: AuthMode): void {
  if (!isModePermitted(environment, mode)) {
    throw new AuthModeError(
      'FORBIDDEN_IN_PRODUCTION',
      `AUTH_MODE="${mode}" is not permitted when APP_ENV="${environment}". ` +
        'Production must use OTP authentication.',
    )
  }
}

/* --------------------------------------------------------- development identities */

/**
 * Reserved phone block for development fixtures.
 *
 * `+8801700000001` … `+8801700000009`. Structurally valid Bangladeshi numbers so they satisfy
 * the same normalisation and database constraints as real ones, but a block that is never
 * allocated to a person — and the database CHECK forbids the fixture flag outside it.
 */
export const DEVELOPMENT_PHONE_PREFIX = '+880170000000'

export interface DevelopmentIdentity {
  readonly key: string
  readonly phone: string
  /** Stored on the user row. Locale-independent; screens render the localised label instead. */
  readonly fullName: string
  readonly nameBn: string
  readonly nameEn: string
  readonly descriptionBn: string
  readonly descriptionEn: string
  readonly roles: readonly string[]
  readonly preferredLanguage: 'BN' | 'EN'
}

/** The label to show a reader, in their language. Never a key, an id or a phone number. */
export function developmentIdentityLabel(
  identity: DevelopmentIdentity,
  locale: 'bn' | 'en',
): { name: string; description: string } {
  return locale === 'bn'
    ? { name: identity.nameBn, description: identity.descriptionBn }
    : { name: identity.nameEn, description: identity.descriptionEn }
}

/** Resolve a fixture from its phone number. Server-side only — the phone never reaches a page. */
export function findDevelopmentIdentityByPhone(phone: string): DevelopmentIdentity | undefined {
  return DEVELOPMENT_IDENTITIES.find((identity) => identity.phone === phone)
}

/**
 * The complete, fixed set of development identities.
 *
 * A **closed allowlist**, not a user picker. Development sign-in accepts a key from this list and
 * nothing else, so there is no path to arbitrary impersonation and no path to role escalation:
 * each identity's roles are declared here and are not selectable by the caller.
 */
export const DEVELOPMENT_IDENTITIES: readonly DevelopmentIdentity[] = [
  {
    key: 'farmer',
    phone: `${DEVELOPMENT_PHONE_PREFIX}1`,
    fullName: 'Dev Farmer',
    nameBn: 'ডেভ কৃষক',
    nameEn: 'Dev Farmer',
    descriptionBn: 'বাংলা-প্রথম কৃষক — যাঁকে সামনে রেখে পণ্যটি বিচার করা হয়',
    descriptionEn: 'Bangla-first farmer — the primary user the product is judged against',
    roles: ['FARMER'],
    preferredLanguage: 'BN',
  },
  {
    key: 'consumer',
    phone: `${DEVELOPMENT_PHONE_PREFIX}2`,
    fullName: 'Dev Consumer',
    nameBn: 'ডেভ ক্রেতা',
    nameEn: 'Dev Consumer',
    descriptionBn: 'ঘরের জন্য যিনি কেনেন',
    descriptionEn: 'Household buyer',
    roles: ['CONSUMER'],
    preferredLanguage: 'BN',
  },
  {
    key: 'retailer',
    phone: `${DEVELOPMENT_PHONE_PREFIX}3`,
    fullName: 'Dev Retailer',
    nameBn: 'ডেভ রিটেইলার',
    nameEn: 'Dev Retailer',
    descriptionBn: 'দোকান বা হোটেল, পাইকারি কেনে',
    descriptionEn: 'Shop or restaurant buying in bulk',
    roles: ['RETAILER'],
    preferredLanguage: 'EN',
  },
  {
    key: 'ops',
    phone: `${DEVELOPMENT_PHONE_PREFIX}4`,
    fullName: 'Dev Ops Agent',
    nameBn: 'ডেভ মাঠকর্মী',
    nameEn: 'Dev Ops Agent',
    descriptionBn: 'মাঠকর্মী — নিবন্ধন ও ডেলিভারি সমন্বয়',
    descriptionEn: 'Field agent — assisted onboarding and delivery coordination',
    roles: ['OPS_AGENT'],
    preferredLanguage: 'BN',
  },
  {
    key: 'admin',
    phone: `${DEVELOPMENT_PHONE_PREFIX}5`,
    fullName: 'Dev Admin',
    nameBn: 'ডেভ অ্যাডমিন',
    nameEn: 'Dev Admin',
    descriptionBn: 'প্রশাসক — অ্যাডমিন স্ক্রিন তৈরির জন্য',
    descriptionEn: 'Administrator — exists so the admin surface can be built and reviewed',
    roles: ['ADMIN'],
    preferredLanguage: 'EN',
  },
  {
    key: 'farmer-consumer',
    phone: `${DEVELOPMENT_PHONE_PREFIX}6`,
    fullName: 'Dev Farmer & Buyer',
    nameBn: 'ডেভ কৃষক ও ক্রেতা',
    nameEn: 'Dev Farmer & Buyer',
    descriptionBn: 'এক অ্যাকাউন্টে দুই ভূমিকা — কৃষক যিনি কেনেনও',
    descriptionEn: 'One account holding two roles — a farmer who also buys',
    roles: ['FARMER', 'CONSUMER'],
    preferredLanguage: 'BN',
  },
  /*
   * The three below exist so the marketplace can be exercised with more than one of each party.
   * A single farmer cannot demonstrate ranking, and a single buyer cannot demonstrate ownership
   * scoping or two buyers racing for the last of a crop — the tests that actually matter.
   *
   * The reserved phone block is +880170000000[1-9], so nine is the hard ceiling. All nine are now
   * used; adding a tenth requires widening the CHECK constraint in the
   * development_auth_fixtures migration, deliberately.
   */
  {
    key: 'farmer-distant',
    phone: `${DEVELOPMENT_PHONE_PREFIX}7`,
    fullName: 'Dev Farmer (distant)',
    nameBn: 'ডেভ কৃষক (দূরের)',
    nameEn: 'Dev Farmer (distant)',
    descriptionBn: 'দূরের কৃষক — সস্তা ফসল, কিন্তু পরিবহন খরচ বেশি',
    descriptionEn: 'A far-away farmer: cheaper at the farm gate, dearer to deliver',
    roles: ['FARMER'],
    preferredLanguage: 'BN',
  },
  {
    key: 'consumer-second',
    phone: `${DEVELOPMENT_PHONE_PREFIX}8`,
    fullName: 'Dev Consumer (second)',
    nameBn: 'ডেভ ক্রেতা (দ্বিতীয়)',
    nameEn: 'Dev Consumer (second)',
    descriptionBn: 'দ্বিতীয় ক্রেতা — মালিকানা ও একই ফসলের প্রতিযোগিতা পরীক্ষার জন্য',
    descriptionEn: 'A second buyer, for ownership scoping and races over the same crop',
    roles: ['CONSUMER'],
    preferredLanguage: 'BN',
  },
  {
    key: 'ops-second',
    phone: `${DEVELOPMENT_PHONE_PREFIX}9`,
    fullName: 'Dev Ops (second)',
    nameBn: 'ডেভ অপারেশনস (দ্বিতীয়)',
    nameEn: 'Dev Ops (second)',
    descriptionBn: 'দ্বিতীয় এজেন্ট — প্রতি-এজেন্ট নগদ হিসাব মেলানোর জন্য',
    descriptionEn:
      'A second agent, so per-agent COD float reconciliation has two floats to keep apart',
    roles: ['OPS_AGENT'],
    preferredLanguage: 'BN',
  },
] as const

export function findDevelopmentIdentity(key: string): DevelopmentIdentity | undefined {
  return DEVELOPMENT_IDENTITIES.find((identity) => identity.key === key)
}

export function isDevelopmentPhone(phone: string): boolean {
  return phone.startsWith(DEVELOPMENT_PHONE_PREFIX)
}
