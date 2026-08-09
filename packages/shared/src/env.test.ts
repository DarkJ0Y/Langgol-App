import { describe, expect, it } from 'vitest'
import { AuthModeError } from '@langgol/domain/identity'
import { EnvironmentError, parseEnv } from './env.js'

const BASE = {
  DATABASE_URL: 'postgresql://langgol:langgol@localhost:5432/langgol',
  DIRECT_URL: 'postgresql://langgol:langgol@localhost:5432/langgol',
  AUTH_SECRET: 'x'.repeat(48),
  JOB_TRIGGER_SECRET: 'y'.repeat(24),
} satisfies NodeJS.ProcessEnv

describe('environment parsing', () => {
  it('applies safe defaults for local development', () => {
    const env = parseEnv({ ...BASE })
    expect(env.APP_ENV).toBe('development')
    expect(env.AUTH_MODE).toBe('development')
    expect(env.SMS_PROVIDER).toBe('console')
    expect(env.isProduction).toBe(false)
    expect(env.isDevelopmentAuth).toBe(true)
  })

  it('refuses to boot on a missing or weak secret', () => {
    expect(() => parseEnv({ ...BASE, AUTH_SECRET: 'too-short' })).toThrow(EnvironmentError)
    expect(() => parseEnv({ ...BASE, DATABASE_URL: '' })).toThrow(EnvironmentError)
    expect(() => parseEnv({ ...BASE, JOB_TRIGGER_SECRET: 'short' })).toThrow(EnvironmentError)
  })

  it('names every offending variable rather than failing vaguely', () => {
    try {
      parseEnv({ ...BASE, AUTH_SECRET: 'short' })
    } catch (error) {
      expect((error as Error).message).toContain('AUTH_SECRET')
    }
  })
})

describe('production must never fall back to development authentication', () => {
  const production = {
    ...BASE,
    APP_ENV: 'production',
    NODE_ENV: 'production',
    SMS_PROVIDER: 'http',
    SMS_API_URL: 'https://sms.example',
    SMS_API_KEY: 'key',
  }

  it('FAILS STARTUP rather than allowing login', () => {
    // The whole point: the failure direction is "do not start", never "let anyone in".
    expect(() => parseEnv({ ...production, AUTH_MODE: 'development' })).toThrow(AuthModeError)
  })

  it('boots when production uses OTP', () => {
    const env = parseEnv({ ...production, AUTH_MODE: 'otp' })
    expect(env.AUTH_MODE).toBe('otp')
    expect(env.isDevelopmentAuth).toBe(false)
  })

  it('still refuses a fake SMS provider in production', () => {
    expect(() => parseEnv({ ...production, AUTH_MODE: 'otp', SMS_PROVIDER: 'console' })).toThrow(
      EnvironmentError,
    )
  })

  it('refuses a production APP_ENV with a development NODE_ENV', () => {
    expect(() => parseEnv({ ...production, AUTH_MODE: 'otp', NODE_ENV: 'development' })).toThrow(
      EnvironmentError,
    )
  })
})

describe('development mode is not blocked on SMS infrastructure', () => {
  it('boots with no SMS credentials at all', () => {
    // This is the requirement that unblocks engineering: no provider, no credentials, no OTP.
    const env = parseEnv({ ...BASE, AUTH_MODE: 'development', SMS_PROVIDER: 'console' })
    expect(env.AUTH_MODE).toBe('development')
    expect(env.SMS_API_KEY).toBeUndefined()
  })

  it('requires credentials once OTP mode is selected with an HTTP provider', () => {
    expect(() => parseEnv({ ...BASE, AUTH_MODE: 'otp', SMS_PROVIDER: 'http' })).toThrow(
      EnvironmentError,
    )
    expect(() =>
      parseEnv({
        ...BASE,
        AUTH_MODE: 'otp',
        SMS_PROVIDER: 'http',
        SMS_API_URL: 'https://sms.example',
        SMS_API_KEY: 'key',
      }),
    ).not.toThrow()
  })

  it('permits development mode in staging, where OTP is being trialled', () => {
    expect(() => parseEnv({ ...BASE, APP_ENV: 'staging', AUTH_MODE: 'development' })).not.toThrow()
    expect(() => parseEnv({ ...BASE, APP_ENV: 'staging', AUTH_MODE: 'otp' })).not.toThrow()
  })
})
