/**
 * What Langgol asks permission for, and on what basis.
 *
 * The catalogue is the single source of truth for the consent vocabulary — the Prisma enum, the
 * UI and the policy engine all derive from it, so a permission cannot exist in one and be missing
 * from another.
 *
 * The distinction that governs everything here is **basis**, not a boolean somewhere:
 *
 *  - `REQUIRED` — the terms and the privacy policy. Not consent in the meaningful sense: the
 *    platform cannot operate without them, so there is no free choice to record. They are kept
 *    separate precisely so they can never be presented alongside optional permissions as though
 *    refusing one were the same kind of act as refusing the other.
 *  - `OPTIONAL` — genuinely freely given. Each is asked separately, each is refusable, each is
 *    revocable at any time, and refusing all of them leaves a fully working account.
 *
 * Copy is written for the person being asked, in Bangla first, and says what the data is FOR.
 * "We process your location data" is not a purpose; "so we can warn you about flooding in your
 * upazila" is. docs/07_SECURITY.md §9.2 requires this and it is the part most easily lost.
 *
 * Refs: docs/07_SECURITY.md §9.1, §9.2, §9.4; docs/08_BANGLADESH_CONTEXT.md §7.6
 */

export const CONSENT_TYPES = [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'LOCATION',
  'FARM_DATA',
  'FINANCIAL_DATA',
  'MARKETING',
  'PERSONALIZATION',
  'AI_DATA_PROCESSING',
  'TRANSACTION_DATA',
] as const

export type ConsentType = (typeof CONSENT_TYPES)[number]

export function isConsentType(value: string): value is ConsentType {
  return (CONSENT_TYPES as readonly string[]).includes(value)
}

/**
 * Why we may hold the data.
 *
 * A separate axis from "did they say yes", because they answer different questions. REQUIRED
 * means there is nothing to decide; OPTIONAL means the answer is genuinely theirs.
 */
export type ConsentBasis = 'REQUIRED' | 'OPTIONAL'

/** Where the decision was taken. Never includes an administrator: see `decisions.ts`. */
export const CONSENT_SOURCES = ['SIGNUP', 'ACCOUNT_SETTINGS', 'REPROMPT'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]

export function isConsentSource(value: string): value is ConsentSource {
  return (CONSENT_SOURCES as readonly string[]).includes(value)
}

export interface ConsentDescriptor {
  readonly type: ConsentType
  readonly basis: ConsentBasis
  /** Maps to the classification table in docs/07 §9.1, so retention follows the data. */
  readonly dataClass: 'Critical' | 'Sensitive' | 'Internal' | 'Public'
  readonly titleBn: string
  readonly titleEn: string
  /** What it is FOR, in the reader's own terms. Not a description of the processing. */
  readonly purposeBn: string
  readonly purposeEn: string
  readonly sortOrder: number
}

export const CONSENT_CATALOGUE: readonly ConsentDescriptor[] = [
  {
    type: 'TERMS_OF_SERVICE',
    basis: 'REQUIRED',
    dataClass: 'Internal',
    titleBn: 'ব্যবহারের শর্ত',
    titleEn: 'Terms of service',
    purposeBn: 'লাঙ্গল ব্যবহার করতে হলে এই শর্তগুলো মানতে হয়।',
    purposeEn: 'These are the rules for using Langgol. Using the platform requires accepting them.',
    sortOrder: 10,
  },
  {
    type: 'PRIVACY_POLICY',
    basis: 'REQUIRED',
    dataClass: 'Internal',
    titleBn: 'গোপনীয়তা নীতি',
    titleEn: 'Privacy policy',
    purposeBn: 'আপনার কোন তথ্য আমরা রাখি, কেন রাখি আর কতদিন রাখি — সব এখানে লেখা আছে।',
    purposeEn:
      'What we keep about you, why we keep it, and for how long. Accepting this is required.',
    sortOrder: 20,
  },
  {
    type: 'LOCATION',
    basis: 'OPTIONAL',
    dataClass: 'Sensitive',
    titleBn: 'আপনার এলাকার তথ্য',
    titleEn: 'Your location',
    purposeBn: 'আপনার উপজেলার আবহাওয়া, বন্যা আর ফসলের সতর্কবার্তা পাঠাতে।',
    purposeEn:
      'So we can send you weather, flood and crop alerts for your upazila. Refusing keeps ' +
      'everything else working.',
    sortOrder: 30,
  },
  {
    type: 'FARM_DATA',
    basis: 'OPTIONAL',
    dataClass: 'Internal',
    titleBn: 'খামারের তথ্য',
    titleEn: 'Farm data',
    purposeBn: 'আপনার জমি আর ফসলের তথ্য দেখে কোন ফসল কখন বিক্রি করলে ভালো দাম পাবেন তা জানাতে।',
    purposeEn:
      'So we can suggest which crops to sell and when, based on your land and what you grow.',
    sortOrder: 40,
  },
  {
    type: 'FINANCIAL_DATA',
    basis: 'OPTIONAL',
    dataClass: 'Critical',
    titleBn: 'লেনদেনের হিসাব বিশ্লেষণ',
    titleEn: 'Financial analysis',
    purposeBn: 'আপনার আয়ের হিসাব দেখে ঋণ বা আর্থিক সেবার সুযোগ থাকলে জানাতে।',
    purposeEn:
      'So we can tell you when a loan or financial service you might qualify for becomes ' +
      'available. Your payout details are never shared.',
    sortOrder: 50,
  },
  {
    type: 'TRANSACTION_DATA',
    basis: 'OPTIONAL',
    dataClass: 'Sensitive',
    titleBn: 'বেচাকেনার হিসাব',
    titleEn: 'Trading history',
    purposeBn: 'আপনার আগের বেচাকেনা দেখে বাজারের দাম আর চাহিদার তথ্য দিতে।',
    purposeEn:
      'So we can show you price and demand information based on what you have bought and sold.',
    sortOrder: 60,
  },
  {
    type: 'PERSONALIZATION',
    basis: 'OPTIONAL',
    dataClass: 'Internal',
    titleBn: 'আপনার জন্য সাজানো',
    titleEn: 'Personalised content',
    purposeBn: 'আপনি যা দেখেন আর কেনেন তার ভিত্তিতে অ্যাপের তালিকা সাজাতে।',
    purposeEn: 'So we can order what you see around what you actually look at and buy.',
    sortOrder: 70,
  },
  {
    type: 'AI_DATA_PROCESSING',
    basis: 'OPTIONAL',
    dataClass: 'Sensitive',
    titleBn: 'স্বয়ংক্রিয় বিশ্লেষণ',
    titleEn: 'Automated analysis',
    purposeBn:
      'রোগ চেনা বা দামের পূর্বাভাসের মতো কাজে আপনার তথ্য স্বয়ংক্রিয় ব্যবস্থায় ব্যবহার করতে।',
    purposeEn:
      'So your data can be used by automated systems for things like spotting crop disease or ' +
      'forecasting prices.',
    sortOrder: 80,
  },
  {
    type: 'MARKETING',
    basis: 'OPTIONAL',
    dataClass: 'Internal',
    titleBn: 'প্রচারের খবর',
    titleEn: 'Marketing messages',
    purposeBn: 'নতুন সুবিধা আর ছাড়ের খবর এসএমএস বা অ্যাপে পাঠাতে। যেকোনো সময় বন্ধ করতে পারবেন।',
    purposeEn:
      'So we can tell you about new features and offers by SMS or in the app. You can stop ' +
      'these at any time.',
    sortOrder: 90,
  },
]

export class ConsentError extends Error {
  readonly code: 'UNKNOWN_TYPE' | 'REQUIRED_NOT_REVOCABLE' | 'VERSION_INVALID'

  constructor(
    code: 'UNKNOWN_TYPE' | 'REQUIRED_NOT_REVOCABLE' | 'VERSION_INVALID',
    message: string,
  ) {
    super(message)
    this.name = 'ConsentError'
    this.code = code
  }
}

export function consentDescriptor(type: ConsentType): ConsentDescriptor {
  const descriptor = CONSENT_CATALOGUE.find((entry) => entry.type === type)
  if (descriptor === undefined) {
    throw new ConsentError('UNKNOWN_TYPE', `No such consent type: ${type}`)
  }
  return descriptor
}

/** The two the platform cannot operate without. Never presented as a choice among the others. */
export const REQUIRED_CONSENTS: readonly ConsentType[] = CONSENT_CATALOGUE.filter(
  (entry) => entry.basis === 'REQUIRED',
).map((entry) => entry.type)

/** Everything genuinely optional. Refusing all of them leaves a fully working account. */
export const OPTIONAL_CONSENTS: readonly ConsentType[] = CONSENT_CATALOGUE.filter(
  (entry) => entry.basis === 'OPTIONAL',
).map((entry) => entry.type)

export function isRequiredConsent(type: ConsentType): boolean {
  return consentDescriptor(type).basis === 'REQUIRED'
}

export function isOptionalConsent(type: ConsentType): boolean {
  return !isRequiredConsent(type)
}

export function consentLabel(
  type: ConsentType,
  locale: 'bn' | 'en',
): { title: string; purpose: string } {
  const descriptor = consentDescriptor(type)
  return locale === 'bn'
    ? { title: descriptor.titleBn, purpose: descriptor.purposeBn }
    : { title: descriptor.titleEn, purpose: descriptor.purposeEn }
}
