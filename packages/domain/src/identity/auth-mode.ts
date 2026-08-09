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
  readonly fullName: string
  readonly roles: readonly string[]
  readonly preferredLanguage: 'BN' | 'EN'
  readonly description: string
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
    roles: ['FARMER'],
    preferredLanguage: 'BN',
    description: 'Bangla-first farmer — the primary user the product is judged against',
  },
  {
    key: 'consumer',
    phone: `${DEVELOPMENT_PHONE_PREFIX}2`,
    fullName: 'Dev Consumer',
    roles: ['CONSUMER'],
    preferredLanguage: 'BN',
    description: 'Household buyer',
  },
  {
    key: 'retailer',
    phone: `${DEVELOPMENT_PHONE_PREFIX}3`,
    fullName: 'Dev Retailer',
    roles: ['RETAILER'],
    preferredLanguage: 'EN',
    description: 'Shop or restaurant buying in bulk',
  },
  {
    key: 'ops',
    phone: `${DEVELOPMENT_PHONE_PREFIX}4`,
    fullName: 'Dev Ops Agent',
    roles: ['OPS_AGENT'],
    preferredLanguage: 'BN',
    description: 'Field agent — assisted onboarding and delivery coordination',
  },
  {
    key: 'admin',
    phone: `${DEVELOPMENT_PHONE_PREFIX}5`,
    fullName: 'Dev Admin',
    roles: ['ADMIN'],
    preferredLanguage: 'EN',
    description: 'Administrator — exists so the admin surface can be built and reviewed',
  },
  {
    key: 'farmer-consumer',
    phone: `${DEVELOPMENT_PHONE_PREFIX}6`,
    fullName: 'Dev Farmer & Buyer',
    roles: ['FARMER', 'CONSUMER'],
    preferredLanguage: 'BN',
    description: 'One account holding two roles — a farmer who also buys',
  },
] as const

export function findDevelopmentIdentity(key: string): DevelopmentIdentity | undefined {
  return DEVELOPMENT_IDENTITIES.find((identity) => identity.key === key)
}

export function isDevelopmentPhone(phone: string): boolean {
  return phone.startsWith(DEVELOPMENT_PHONE_PREFIX)
}
