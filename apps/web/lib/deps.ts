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
  auditPort,
  cryptoRandom,
  createOtpDelivery,
  getConfig,
  otpChallengeRepository,
  scryptHasher,
  sessionRepository,
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

export function authMode(): AuthMode {
  return env().AUTH_MODE as AuthMode
}

export function isDevelopmentAuth(): boolean {
  return env().isDevelopmentAuth
}

export { systemClock, scryptHasher, sessionRepository, auditPort }
