/**
 * Every action the audit log can record.
 *
 * A closed vocabulary rather than a free string. Before this phase the `action` column took
 * whatever a caller passed, which had two consequences worth naming: a typo produced a row that
 * no query would ever find again, and the KYC decision wrote the bare words `APPROVE` and
 * `REJECT` — indistinguishable, in a table shared by the whole platform, from an approval of
 * anything else.
 *
 * Making it a union means adding an action is a deliberate edit here, and misspelling one is a
 * compile error rather than a silent hole in an investigation.
 *
 * ## Naming
 *
 * `SUBJECT_VERB_PAST`. The subject first so that a prefix search finds everything about one area,
 * and the past tense because an audit log records what happened, never what was attempted — the
 * refusals below say so explicitly in their names.
 *
 * ## Refusals are recorded too
 *
 * `..._REJECTED`, `..._REFUSED` and `..._RATE_LIMITED` entries exist because a security log that
 * only contains successes cannot answer "did somebody try?". A run of refusals against one
 * account is the signal; each one alone is noise.
 *
 * Refs: docs/07_SECURITY.md §5, §11
 */

/** Account lifecycle. */
const ACCOUNT_ACTIONS = [
  'ACCOUNT_CREATED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_RESTORED',
  'PROFILE_UPDATED',
] as const

/** Proving a phone or an email. */
const VERIFICATION_ACTIONS = [
  'PHONE_VERIFIED',
  'PHONE_VERIFY_REQUESTED',
  'PHONE_VERIFY_FAILED',
  'PHONE_VERIFY_RATE_LIMITED',
  'EMAIL_VERIFIED',
  'EMAIL_VERIFY_REQUESTED',
  'EMAIL_VERIFY_FAILED',
  'EMAIL_VERIFY_RATE_LIMITED',
] as const

/** Signing in. */
const AUTH_ACTIONS = [
  'LOGIN_SUCCEEDED',
  'SIGNED_OUT',
  'SIGNED_OUT_ALL',
  'OTP_REQUESTED',
  'OTP_VERIFY_FAILED',
  'OTP_RATE_LIMITED',
  'LOGIN_BLOCKED',
  'SMS_BUDGET_EXHAUSTED',
  'DEV_SIGNED_IN',
  'DEV_SIGN_IN_REJECTED',
  // Distinct from LOGIN_SUCCEEDED and OTP_VERIFY_FAILED, because which party verified the number
  // changes what the line means: under Firebase the attempt cap and spend limit are Google's.
  'FIREBASE_SIGNED_IN',
  'FIREBASE_SIGN_IN_REJECTED',
] as const

/** Roles. */
const ROLE_ACTIONS = [
  'ROLE_ADDED',
  'ROLE_REMOVED',
  'ROLE_ASSIGN_REJECTED',
  'ROLE_REVOKE_REJECTED',
  'ROLE_SELF_SELECTED',
  'ROLE_SELF_SELECT_REJECTED',
  'ROLE_PROFILE_UPDATED',
] as const

/** Identity and the human review queues. */
const KYC_ACTIONS = [
  'KYC_SUBMITTED',
  'KYC_APPROVED',
  'KYC_REJECTED',
  'KYC_CLAIMED',
  'KYC_SELF_REVIEW_REFUSED',
  'KYC_DUPLICATE_DOCUMENT_REFUSED',
  /*
   * The three that matter most in an investigation. Opening somebody's identity document, and
   * above all decrypting the number on it, is the most sensitive thing an operator can do — so it
   * is recorded before it happens rather than after.
   */
  'KYC_DOCUMENT_GRANT_ISSUED',
  'KYC_DOCUMENT_GRANT_MISUSED',
  'KYC_DOCUMENT_VIEWED',
  'KYC_IDENTITY_NUMBER_REVEALED',
] as const

/** Farms, plots and the land record. */
const FARM_ACTIONS = [
  'FARM_CREATED',
  'FARM_UPDATED',
  'FARM_DELETED',
  'PLOT_CREATED',
  'PLOT_UPDATED',
  'PLOT_DELETED',
  'FARMER_PROFILE_UPDATED',
] as const

/** Addresses. */
const ADDRESS_ACTIONS = [
  'ADDRESS_CREATED',
  'ADDRESS_UPDATED',
  'ADDRESS_DELETED',
  'ADDRESS_DEFAULT_CHANGED',
] as const

/**
 * Consent.
 *
 * Granting and revoking are separate actions rather than one with a payload, because "when did
 * they withdraw permission?" is the question a data-protection enquiry actually asks and it should
 * be answerable by filtering on one value.
 */
const CONSENT_ACTIONS = ['CONSENT_GRANTED', 'CONSENT_REVOKED', 'CONSENT_VIEWED_BY_ADMIN'] as const

/** The back office. */
const ADMIN_ACTIONS = [
  'ADMIN_USER_VIEWED',
  'ADMIN_PERMISSION_GRANTED',
  'ADMIN_PERMISSION_REVOKED',
] as const

/** Advisory and the agricultural identity. */
const PLATFORM_ACTIONS = [
  'ADVISORY_DIAGNOSIS_SERVED',
  'ADVISORY_REFUSED',
  'ADVISORY_FAILED',
  'AGRI_ID_ISSUED',
] as const

export const AUDIT_ACTIONS = [
  ...ACCOUNT_ACTIONS,
  ...VERIFICATION_ACTIONS,
  ...AUTH_ACTIONS,
  ...ROLE_ACTIONS,
  ...KYC_ACTIONS,
  ...FARM_ACTIONS,
  ...ADDRESS_ACTIONS,
  ...CONSENT_ACTIONS,
  ...ADMIN_ACTIONS,
  ...PLATFORM_ACTIONS,
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const isAuditAction = (value: unknown): value is AuditAction =>
  typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value)

/**
 * What kind of thing an action is about.
 *
 * Closed for the same reason the actions are: `entity_type` is half of the index that answers
 * "everything that happened to this record", and a row filed under `Farm` when every other says
 * `farm` is a row that query will not return.
 */
export const AUDIT_ENTITY_TYPES = [
  'user',
  'session',
  'role',
  /*
   * Not everything audited is a row.
   *
   * A rate limit is recorded against the phone number or the IP address it was applied to, and an
   * exhausted SMS budget against the budget itself — none of which has a table. Naming them here
   * keeps `entity_type` a closed set while letting the security events say what they are actually
   * about, which is the whole reason those rows exist.
   */
  'phone',
  'ip',
  'sms_budget',
  'development_identity',
  /*
   * A Firebase ID token that failed verification.
   *
   * It is its own type because there is nothing else to file it under: the token established
   * nothing, so there is no user, and its claimed phone number is attacker-controlled text that
   * must not be written into an operator's table as though it meant something.
   */
  'firebase_token',
  'address',
  'farm',
  'plot',
  'farmer_profile',
  'role_profile',
  'verification',
  'consent',
  'agri_identity',
  'advisory',
  'platform',
] as const

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number]

export const isAuditEntityType = (value: unknown): value is AuditEntityType =>
  typeof value === 'string' && (AUDIT_ENTITY_TYPES as readonly string[]).includes(value)

/**
 * The actions where the caller's IP address is worth keeping.
 *
 * Not all of them, deliberately. An IP address is personal data under the GDPR and under
 * Bangladesh's draft data protection rules, so it is recorded where it answers a security question
 * — who was trying to sign in, who was refused, who opened somebody's identity document — and not
 * on the ordinary business events, where it would be collection for its own sake.
 *
 * Refs: docs/07_SECURITY.md §9, §11
 */
export const IP_BEARING_ACTIONS: readonly AuditAction[] = [
  'ACCOUNT_CREATED',
  'OTP_REQUESTED',
  'OTP_VERIFY_FAILED',
  'OTP_RATE_LIMITED',
  'LOGIN_BLOCKED',
  'DEV_SIGNED_IN',
  'DEV_SIGN_IN_REJECTED',
  // A rejected token is exactly the shape of abuse an address is worth keeping for: a stranger
  // presenting tokens is not a user having trouble, and there is no account to attribute it to.
  'FIREBASE_SIGNED_IN',
  'FIREBASE_SIGN_IN_REJECTED',
  'PHONE_VERIFY_FAILED',
  'PHONE_VERIFY_RATE_LIMITED',
  'EMAIL_VERIFY_FAILED',
  'EMAIL_VERIFY_RATE_LIMITED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_RESTORED',
  'KYC_DOCUMENT_VIEWED',
  'KYC_DOCUMENT_GRANT_MISUSED',
  'KYC_IDENTITY_NUMBER_REVEALED',
  'ADMIN_PERMISSION_GRANTED',
  'ADMIN_PERMISSION_REVOKED',
  'ROLE_ADDED',
  'ROLE_REMOVED',
  'CONSENT_GRANTED',
  'CONSENT_REVOKED',
]

export const shouldRecordIp = (action: AuditAction): boolean => IP_BEARING_ACTIONS.includes(action)
