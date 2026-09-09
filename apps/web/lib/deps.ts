/**
 * Dependency wiring.
 *
 * The single place where the application layer meets concrete adapters. Use cases receive their
 * dependencies; nothing below reaches upward for them.
 *
 * Refs: docs/03_ARCHITECTURE.md §4
 */

import 'server-only'
import {
  accountRepository,
  addressBookRepository,
  addressRepository,
  adminAreaRepository,
  createEmailDelivery,
  auditPort,
  configPort,
  consentRepository,
  cryptoRandom,
  createOtpDelivery,
  farmerProfileRepository,
  farmRepository,
  firebaseStorage,
  plotRepository,
  roleProfileRepository,
  verificationRepository,
  agriIdentityRepository,
  agriIdRandom,
  onboardingRepository,
  adminRepository,
  identityCipher,
  documentGrantSigner,
  memoryStorage,
  getConfig,
  listingRepository,
  orderNumberGenerator,
  orderPlacement,
  otpChallengeRepository,
  quoteRepository,
  scryptHasher,
  sessionRepository,
  subsidyBudgetPort,
  systemClock,
  userRepository,
  verificationTokenRepository,
} from '@langgol/infrastructure'
import { env } from '@langgol/shared'
import { fixedOtpCodeFor } from '@langgol/domain/identity'
import type { AppEnvironment, AuthMode } from '@langgol/domain/identity'

export async function authDeps() {
  const config = await getConfig()
  return {
    config,
    clock: systemClock,
    random: cryptoRandom,
    hasher: scryptHasher,
    challenges: otpChallengeRepository,
    users: userRepository,
    sessions: sessionRepository,
    audit: auditPort,
  }
}

/**
 * OTP dependencies.
 *
 * `fixedCode` is the lock that keeps the reserved test numbers out of production. It is supplied
 * ONLY outside production and staging, so in those environments `requestOtp` has no way to obtain
 * a predictable code — the branch is unreachable rather than disabled by a flag somebody could
 * flip. See packages/domain/src/identity/test-numbers.ts.
 */
export async function otpDeps() {
  const configuration = env()
  const isReal = configuration.isProduction || configuration.APP_ENV === 'staging'

  return {
    ...(await authDeps()),
    delivery: createOtpDelivery(),
    ...(isReal ? {} : { fixedCode: fixedOtpCodeFor }),
  }
}

export async function developmentDeps() {
  const configuration = env()
  return {
    ...(await authDeps()),
    environment: configuration.APP_ENV as AppEnvironment,
    authMode: configuration.AUTH_MODE as AuthMode,
  }
}

/**
 * Dependencies for the quote and checkout use cases.
 *
 * `orderPlacement` is the only adapter that moves inventory, and it does so in one transaction.
 * Nothing here gives a caller a way to reserve stock without also creating the order.
 */
export function marketplaceDeps(): Promise<{
  clock: typeof systemClock
  config: typeof configPort
  listings: typeof listingRepository
  addresses: typeof addressRepository
  quotes: typeof quoteRepository
  subsidyBudget: typeof subsidyBudgetPort
  orders: typeof orderPlacement
  orderNumbers: typeof orderNumberGenerator
}> {
  return Promise.resolve({
    clock: systemClock,
    config: configPort,
    listings: listingRepository,
    addresses: addressRepository,
    quotes: quoteRepository,
    subsidyBudget: subsidyBudgetPort,
    orders: orderPlacement,
    orderNumbers: orderNumberGenerator,
  })
}

/**
 * Dependencies for the account and role use cases.
 *
 * `audit` is included deliberately: a role grant and a refused grant are both events the audit
 * log must carry, so the use case cannot be constructed without somewhere to record them.
 */
export function accountDeps(): Promise<{
  clock: typeof systemClock
  accounts: typeof accountRepository
  audit: typeof auditPort
}> {
  return Promise.resolve({
    clock: systemClock,
    accounts: accountRepository,
    audit: auditPort,
  })
}

/**
 * Dependencies for phone verification.
 *
 * The same challenge repository, hasher and SMS delivery the login flow uses — verification is
 * not a second OTP system, it is the same one asked a different question. `accounts` is here
 * because the number verified is read from the account rather than supplied by the caller.
 */
export async function phoneVerificationDeps() {
  const config = await getConfig()
  return {
    config,
    clock: systemClock,
    random: cryptoRandom,
    hasher: scryptHasher,
    challenges: otpChallengeRepository,
    delivery: createOtpDelivery(),
    accounts: accountRepository,
    users: userRepository,
    audit: auditPort,
  }
}

/**
 * Dependencies for email verification.
 *
 * `createEmailDelivery()` reports `available: false` when no provider is configured, which is a
 * supported deployment rather than a fault — so the caller can decline to offer the user a
 * button that could never work.
 */
export async function emailVerificationDeps() {
  const config = await getConfig()
  return {
    config,
    clock: systemClock,
    random: cryptoRandom,
    hasher: scryptHasher,
    tokens: verificationTokenRepository,
    accounts: accountRepository,
    delivery: createEmailDelivery(),
    audit: auditPort,
    appUrl: env().APP_URL,
  }
}

/**
 * Dependencies for the address book and the area picker.
 *
 * `areas` is here because an address is only as good as the tree it points into: the use case
 * checks that the chosen area exists and is at least an upazila, rather than trusting a foreign
 * key to catch "somewhere in Rajshahi".
 */
export function locationDeps(): Promise<{
  clock: typeof systemClock
  addresses: typeof addressBookRepository
  areas: typeof adminAreaRepository
  audit: typeof auditPort
}> {
  return Promise.resolve({
    clock: systemClock,
    addresses: addressBookRepository,
    areas: adminAreaRepository,
    audit: auditPort,
  })
}

/**
 * Dependencies for consent.
 *
 * `config` is here because the version currently in force decides whether a past agreement still
 * counts — consent is read against it, never against a constant.
 */
export async function consentDeps() {
  const config = await getConfig()
  return {
    config,
    clock: systemClock,
    consents: consentRepository,
    audit: auditPort,
  }
}

/**
 * The farmer profile use cases.
 *
 * No config snapshot: nothing about the farming questionnaire is a versioned business parameter.
 * The land-unit conversions are physical constants and the plausibility bounds are typo guards,
 * both of which live in the domain — putting them in `PlatformConfig` would imply somebody may
 * tune them, and a bigha does not change because the pricing committee met.
 */
export async function farmerDeps() {
  return {
    clock: systemClock,
    farmers: farmerProfileRepository,
    audit: auditPort,
  }
}

/**
 * Farms and plots.
 *
 * No config: nothing about a holding is a versioned business parameter. The farm and plot caps
 * are guards against an automated loop, not product decisions somebody tunes.
 */
export async function farmDeps() {
  return {
    clock: systemClock,
    farms: farmRepository,
    plots: plotRepository,
    audit: auditPort,
  }
}

/**
 * The role profiles for the six non-farmer roles.
 *
 * One set of dependencies for all six, not six sets. The repository dispatches on the role
 * internally, so a seventh profile is a table entry rather than another wiring function here.
 */
export async function roleProfileDeps() {
  return {
    clock: systemClock,
    profiles: roleProfileRepository,
    audit: auditPort,
  }
}

/**
 * Identity, KYC and verification.
 *
 * `storage` falls back to the in-memory adapter when Firebase is not configured, so KYC can be
 * exercised locally without a cloud account. It is not a silent downgrade in production: the
 * memory adapter loses its contents on restart, and the environment check refuses a production
 * deployment with no KYC key at all, so a deployment that reaches this line has been configured
 * deliberately.
 */
export async function kycDeps() {
  return {
    clock: systemClock,
    verifications: verificationRepository,
    cipher: identityCipher,
    storage: firebaseStorage.isAvailable ? firebaseStorage : memoryStorage,
    grants: documentGrantSigner,
    audit: auditPort,
  }
}

/**
 * The digital agricultural identity.
 *
 * `random` is its own port rather than the general `RandomSource`, so that an AGRI-ID coming from
 * a CSPRNG is a wiring decision somebody has to make deliberately. Deriving one from a hash of an
 * NID or a phone number would make the identifier invertible, which is the failure the whole
 * design exists to prevent.
 */
export async function agriProfileDeps() {
  return {
    clock: systemClock,
    identities: agriIdentityRepository,
    random: agriIdRandom,
    audit: auditPort,
  }
}

/**
 * Progressive onboarding.
 *
 * One repository and nothing else. The calculation is pure and lives in the domain, so there is no
 * clock, no config and no audit port here — a progress checklist has nothing to record.
 */
export async function onboardingDeps() {
  return { onboarding: onboardingRepository }
}

/**
 * The back office.
 *
 * One repository, the clock and the audit port. Every capability behind these deps names its own
 * permission in the policy table, so there is nothing here that decides who may do what.
 */
export async function adminDeps() {
  return {
    clock: systemClock,
    admin: adminRepository,
    audit: auditPort,
  }
}

export function authMode(): AuthMode {
  return env().AUTH_MODE as AuthMode
}

export function isDevelopmentAuth(): boolean {
  return env().isDevelopmentAuth
}

export { systemClock, scryptHasher, sessionRepository, auditPort }
