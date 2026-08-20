/**
 * Environment parsing.
 *
 * Parsed **once**, at startup, through a schema. The process refuses to boot on a missing or
 * malformed variable rather than failing at 02:00 on the first request that happens to need it.
 * `process.env` is not read anywhere else in the codebase.
 *
 * Refs: docs/03_ARCHITECTURE.md §7, docs/07_SECURITY.md §11
 */

import { assertModePermitted, isAuthMode } from '@langgol/domain/identity'
import { z } from 'zod'

const NON_PRODUCTION = new Set(['development', 'test', 'staging'])

const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required'),

  // 32 bytes minimum. A short session secret is a forgeable session.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

  /**
   * How users authenticate.
   *
   * `otp` is the production mechanism. `development` allows sign-in as one of a fixed set of
   * fixture identities so engineering can proceed before SMS infrastructure exists — and is
   * refused outright in production, below. docs/03_ARCHITECTURE.md ADR-22
   */
  AUTH_MODE: z.enum(['development', 'otp']).default('development'),

  SMS_PROVIDER: z.enum(['console', 'memory', 'http']).default('console'),
  SMS_API_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().default('LANGGOL'),
  SMS_DAILY_BUDGET_POISHA: z.coerce.number().int().positive().default(500000),
  // Approximate cost of one message, used by the spend circuit breaker.
  SMS_UNIT_COST_POISHA: z.coerce.number().int().positive().default(50),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ERROR_REPORTING_DSN: z.string().optional(),

  /*
   * --- Firebase -----------------------------------------------------------
   *
   * Firebase is a connected SERVICE, not the system of record. PostgreSQL stays authoritative
   * for money, inventory and the ledger, because those invariants are enforced BY the database:
   * the deferred balanced-transaction trigger, the atomic conditional inventory UPDATE, the
   * append-only rules and 39 CHECK constraints. Firestore cannot express any of them, and
   * docs/06_FINANCIAL_ARCHITECTURE.md §13 is explicit that an unbalanced transaction is
   * prevented "by a database trigger, not by hope".
   *
   * These are deliberately NOT `NEXT_PUBLIC_*`. A Firebase web apiKey is a public project
   * identifier rather than a credential, so shipping it to the browser is safe — but CI rejects
   * any NEXT_PUBLIC_* variable whose name matches KEY/SECRET/TOKEN, and that control is worth
   * more than the convenience. A server component passes the config down to the client instead.
   */
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_API_KEY: z.string().optional(),
  FIREBASE_AUTH_DOMAIN: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  FIREBASE_APP_ID: z.string().optional(),
  FIREBASE_MEASUREMENT_ID: z.string().optional(),

  JOB_TRIGGER_SECRET: z.string().min(16, 'JOB_TRIGGER_SECRET must be at least 16 characters'),
})

export type Env = z.infer<typeof schema> & {
  readonly isProduction: boolean
  readonly isTest: boolean
  readonly isDevelopmentAuth: boolean
}

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvironmentError'
  }
}

/**
 * Parse and validate the environment.
 *
 * Cross-field rules live here rather than in the schema because they express operational
 * safety, not shape: an HTTP SMS provider without credentials would fail silently at send time,
 * and a non-production SMS provider in production would mean nobody receives an OTP.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new EnvironmentError(`Invalid environment configuration:\n${issues}`)
  }

  const env = parsed.data
  const isProduction = env.APP_ENV === 'production'

  // Production must never silently fall back to development authentication. A system that
  // degrades from "no SMS provider" to "anyone may sign in as an administrator" has chosen the
  // wrong direction to fail in, so this is a startup failure. docs/03_ARCHITECTURE.md ADR-22
  assertModePermitted(env.APP_ENV, env.AUTH_MODE)

  // An SMS provider is only required when OTP is the active mechanism. Development mode must
  // not be blocked on infrastructure that does not exist yet.
  if (
    env.AUTH_MODE === 'otp' &&
    env.SMS_PROVIDER === 'http' &&
    (!env.SMS_API_URL || !env.SMS_API_KEY)
  ) {
    throw new EnvironmentError(
      'SMS_PROVIDER=http requires SMS_API_URL and SMS_API_KEY. Without them, OTP delivery ' +
        'fails at send time rather than at boot.',
    )
  }

  if (isProduction && env.SMS_PROVIDER !== 'http') {
    throw new EnvironmentError(
      `SMS_PROVIDER="${env.SMS_PROVIDER}" cannot be used in production: no user would receive ` +
        'an OTP, and every login would fail.',
    )
  }

  if (isProduction && NON_PRODUCTION.has(env.NODE_ENV)) {
    // Not fatal on its own, but worth refusing: a production APP_ENV with NODE_ENV=development
    // means development-only code paths (verbose logging, cached clients) are live.
    throw new EnvironmentError(
      `APP_ENV=production requires NODE_ENV=production, found "${env.NODE_ENV}".`,
    )
  }

  return Object.freeze({
    ...env,
    isProduction,
    isTest: env.APP_ENV === 'test',
    isDevelopmentAuth: env.AUTH_MODE === 'development',
  })
}

let cached: Env | undefined

/** The validated environment. Parsed on first access and frozen thereafter. */
export function env(): Env {
  cached ??= parseEnv()
  return cached
}

/** Test-only: reset the memoised environment. */
export { isAuthMode }

export function resetEnvCache(): void {
  cached = undefined
}
