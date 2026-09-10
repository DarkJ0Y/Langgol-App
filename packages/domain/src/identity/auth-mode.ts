/**
 * Authentication modes.
 *
 * Two of the three actually verify that somebody controls a phone number, and one does not:
 *
 *  - `otp`       — Langgol sends the code itself through a Bangladeshi SMS aggregator and checks
 *                  it. Every control around it is ours: the attempt cap, the expiry, the resend
 *                  cooldown, the per-phone and per-IP rate limits, the SMS spend circuit breaker.
 *  - `firebase`  — Firebase Authentication sends and checks the code, and hands back a signed ID
 *                  token asserting the phone number. Those same controls become Google's.
 *  - `development` — no verification at all. Sign-in as one of a fixed set of fixture identities,
 *                  so engineering can proceed before SMS infrastructure is contracted. A
 *                  scaffold, built so it cannot survive contact with production.
 *
 * ## Why `firebase` is permitted in production and `development` is not
 *
 * The rule is not "which modes do we like". It is whether the mode proves control of the phone
 * number it claims. `otp` and `firebase` both do, by different parties. `development` proves
 * nothing — its accounts have no credential of any kind — so in production it is not a weaker
 * login, it is an open door.
 *
 * Trading our own controls for Google's is a real trade and not a free one, and it is recorded in
 * docs/DEPLOYMENT.md rather than hidden here: with `firebase` the spend cap, the attempt limits
 * and the abuse response are configured in the Firebase console, not in this codebase.
 *
 * ## The three guards on development mode
 *
 * One is a convention and three is a control:
 *
 *  1. **Startup** — `production` with `development` refuses to boot.
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

export type AuthMode = 'development' | 'otp' | 'firebase'

export const AUTH_MODES: readonly AuthMode[] = ['development', 'otp', 'firebase']

export function isAuthMode(value: string): value is AuthMode {
  return value === 'development' || value === 'otp' || value === 'firebase'
}

/**
 * Does this mode actually establish that the caller controls the phone number?
 *
 * Named as a question about the mode rather than as a list of what production allows, so that
 * adding a mode forces an answer here instead of silently inheriting one.
 */
export function verifiesPhoneOwnership(mode: AuthMode): boolean {
  return mode === 'otp' || mode === 'firebase'
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
  // Production admits any mode that proves control of the phone number, and no others. Expressed
  // through the predicate rather than by listing modes, so a mode added later cannot be permitted
  // here by accident — it has to declare what it verifies first.
  if (environment === 'production') return verifiesPhoneOwnership(mode)
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
        'Production must use a mode that verifies the phone number: "otp" or "firebase".',
    )
  }
}

/* --------------------------------------------------------- development identities */

/**
 * Reserved phone area for development fixtures.
 *
 * Structurally valid Bangladeshi numbers, so fixtures satisfy the same normalisation and database
 * constraints as real users — in an area no operator allocates to a person, and which the
 * database CHECK forbids the fixture flag outside of.
 *
 * Two runs of two-digit endings sit inside it: `01`–`09`, holding the accounts that came first,
 * and `20`–`29`, opened for the role-specific ones added later. The second run starts at 20
 * rather than immediately after the first because `+8801700000011` and `+8801700000012` are the
 * fixed-code OTP test numbers in `test-numbers.ts`. Those sign in WITH a code and a fixture signs
 * in WITHOUT one; a number reachable both ways would be secured by whichever path is weaker, so
 * the runs are kept disjoint and the endings 10-19 stay out of both.
 */
export const DEVELOPMENT_PHONE_PREFIX = '+88017000000'

/**
 * The reserved block, written exactly as the database states it.
 *
 * Kept in step with the `users_dev_fixture_reserved_block` CHECK constraint, so a number this
 * accepts is a number the database will accept the fixture flag on. A test asserts that every
 * declared identity falls inside it, which is what stops the two drifting apart.
 */
const DEVELOPMENT_PHONE_BLOCK = /^\+88017000000(?:0[1-9]|2[0-9])$/

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
    phone: `${DEVELOPMENT_PHONE_PREFIX}01`,
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
    phone: `${DEVELOPMENT_PHONE_PREFIX}02`,
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
    phone: `${DEVELOPMENT_PHONE_PREFIX}03`,
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
    phone: `${DEVELOPMENT_PHONE_PREFIX}04`,
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
    phone: `${DEVELOPMENT_PHONE_PREFIX}05`,
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
    phone: `${DEVELOPMENT_PHONE_PREFIX}06`,
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
   */
  {
    key: 'farmer-distant',
    phone: `${DEVELOPMENT_PHONE_PREFIX}07`,
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
    phone: `${DEVELOPMENT_PHONE_PREFIX}08`,
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
    phone: `${DEVELOPMENT_PHONE_PREFIX}09`,
    fullName: 'Dev Ops (second)',
    nameBn: 'ডেভ অপারেশনস (দ্বিতীয়)',
    nameEn: 'Dev Ops (second)',
    descriptionBn: 'দ্বিতীয় এজেন্ট — প্রতি-এজেন্ট নগদ হিসাব মেলানোর জন্য',
    descriptionEn:
      'A second agent, so per-agent COD float reconciliation has two floats to keep apart',
    roles: ['OPS_AGENT'],
    preferredLanguage: 'BN',
  },
  /*
   * The four below hold the roles P9 wrote profiles for. Every one of them is CONTROLLED — no
   * account may self-select a wholesaler, supplier, expert or logistics role at registration —
   * so without a fixture apiece there is no way to open those screens at all, and the profile
   * forms built for them could only ever be reviewed as code.
   *
   * They open the second run of the reserved block, at ending 21.
   */
  {
    key: 'wholesaler',
    phone: `${DEVELOPMENT_PHONE_PREFIX}21`,
    fullName: 'Dev Wholesaler',
    nameBn: 'ডেভ পাইকার',
    nameEn: 'Dev Wholesaler',
    descriptionBn: 'আড়তদার — কৃষকের কাছ থেকে বড় পরিমাণে কেনেন',
    descriptionEn: 'Wholesale buyer taking large volumes at the farm gate',
    roles: ['WHOLESALER'],
    preferredLanguage: 'BN',
  },
  {
    key: 'supplier',
    phone: `${DEVELOPMENT_PHONE_PREFIX}22`,
    fullName: 'Dev Supplier',
    nameBn: 'ডেভ সরবরাহকারী',
    nameEn: 'Dev Supplier',
    descriptionBn: 'কৃষি উপকরণ সরবরাহকারী — বীজ, সার ও কীটনাশক',
    descriptionEn: 'Agricultural input supplier — seed, fertiliser and crop protection',
    roles: ['SUPPLIER'],
    preferredLanguage: 'BN',
  },
  {
    key: 'expert',
    phone: `${DEVELOPMENT_PHONE_PREFIX}23`,
    fullName: 'Dev Agricultural Expert',
    nameBn: 'ডেভ কৃষি বিশেষজ্ঞ',
    nameEn: 'Dev Agricultural Expert',
    descriptionBn: 'কৃষি পরামর্শদাতা — রোগ ও ফলন নিয়ে কৃষককে পরামর্শ দেন',
    descriptionEn: 'Agronomist advising farmers on disease, inputs and yield',
    roles: ['AGRICULTURAL_EXPERT'],
    preferredLanguage: 'BN',
  },
  {
    key: 'logistics',
    phone: `${DEVELOPMENT_PHONE_PREFIX}24`,
    fullName: 'Dev Logistics Provider',
    nameBn: 'ডেভ পরিবহনকারী',
    nameEn: 'Dev Logistics Provider',
    descriptionBn: 'পরিবহন সেবা — খামার থেকে বাজারে ফসল পৌঁছে দেন',
    descriptionEn: 'Transport provider moving crops from farm to market',
    roles: ['LOGISTICS_PROVIDER'],
    preferredLanguage: 'EN',
  },
] as const

export function findDevelopmentIdentity(key: string): DevelopmentIdentity | undefined {
  return DEVELOPMENT_IDENTITIES.find((identity) => identity.key === key)
}

export function isDevelopmentPhone(phone: string): boolean {
  return DEVELOPMENT_PHONE_BLOCK.test(phone)
}
