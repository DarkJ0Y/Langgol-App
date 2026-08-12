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
  addressRepository,
  auditPort,
  configPort,
  cryptoRandom,
  createOtpDelivery,
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
} from '@langgol/infrastructure'
import { env } from '@langgol/shared'
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

export async function otpDeps() {
  return { ...(await authDeps()), delivery: createOtpDelivery() }
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

export function authMode(): AuthMode {
  return env().AUTH_MODE as AuthMode
}

export function isDevelopmentAuth(): boolean {
  return env().isDevelopmentAuth
}

export { systemClock, scryptHasher, sessionRepository, auditPort }
