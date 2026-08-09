/**
 * Environment parsing.
 *
 * Parsed **once**, at startup, through a schema. The process refuses to boot on a missing or
 * malformed variable rather than failing at 02:00 on the first request that happens to need it.
 * `process.env` is not read anywhere else in the codebase.
 *
 * Refs: docs/03_ARCHITECTURE.md §7, docs/07_SECURITY.md §11
 */

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

  SMS_PROVIDER: z.enum(['console', 'memory', 'http']).default('console'),
  SMS_API_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().default('LANGGOL'),
  SMS_DAILY_BUDGET_POISHA: z.coerce.number().int().positive().default(500000),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ERROR_REPORTING_DSN: z.string().optional(),

  JOB_TRIGGER_SECRET: z.string().min(16, 'JOB_TRIGGER_SECRET must be at least 16 characters'),
})

export type Env = z.infer<typeof schema> & {
  readonly isProduction: boolean
  readonly isTest: boolean
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

  if (env.SMS_PROVIDER === 'http' && (!env.SMS_API_URL || !env.SMS_API_KEY)) {
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

  return Object.freeze({ ...env, isProduction, isTest: env.APP_ENV === 'test' })
}

let cached: Env | undefined

/** The validated environment. Parsed on first access and frozen thereafter. */
export function env(): Env {
  cached ??= parseEnv()
  return cached
}

/** Test-only: reset the memoised environment. */
export function resetEnvCache(): void {
  cached = undefined
}
