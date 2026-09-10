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
    // 32 bytes of base64. Required in production since P10: without it every identity submission
    // is refused, which is the correct failure but a silent one.
    KYC_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
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

  const firebaseClient = {
    FIREBASE_PROJECT_ID: 'langgol-test',
    FIREBASE_API_KEY: 'client-api-key',
    FIREBASE_AUTH_DOMAIN: 'langgol-test.firebaseapp.com',
  }

  it('boots when production uses Firebase, which also verifies the number', () => {
    /*
     * The production rule is about whether the mode proves control of the phone, not about which
     * party sends the message. Firebase does prove it, so it is permitted.
     */
    const env = parseEnv({ ...production, AUTH_MODE: 'firebase', ...firebaseClient })
    expect(env.AUTH_MODE).toBe('firebase')
    expect(env.isDevelopmentAuth).toBe(false)
  })

  it('does not demand an SMS aggregator when Firebase is sending the codes', () => {
    /*
     * The SMS check exists because a console provider under OTP means nobody receives a code and
     * every login fails. Under Firebase this application never calls an SMS provider on the
     * sign-in path, so the same check would refuse to boot a deployment that works.
     */
    const env = parseEnv({
      ...production,
      AUTH_MODE: 'firebase',
      ...firebaseClient,
      SMS_PROVIDER: 'console',
      SMS_API_URL: undefined,
      SMS_API_KEY: undefined,
    })
    expect(env.AUTH_MODE).toBe('firebase')
  })

  it('refuses Firebase mode without the project it would verify against', () => {
    /*
     * Verification establishes that Google issued this token FOR this project. With no project id
     * there is no audience to check, and a verifier that skips that check accepts a valid token
     * minted for somebody else's Firebase project — a complete authentication bypass.
     */
    for (const absent of ['FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN']) {
      const config: Record<string, string | undefined> = {
        ...production,
        AUTH_MODE: 'firebase',
        ...firebaseClient,
      }
      config[absent] = undefined

      expect(() => parseEnv(config)).toThrow(EnvironmentError)
      try {
        parseEnv(config)
      } catch (error) {
        expect((error as Error).message).toContain(absent)
      }
    }
  })

  it('refuses to boot in production with no KYC key', () => {
    /*
     * The alternative failure is silent: the application starts, and identity verification simply
     * never works, with the first report coming from a user who cannot verify. Refusing at deploy
     * time says so out loud.
     */
    const { KYC_ENCRYPTION_KEY: _omitted, ...withoutKey } = production
    expect(() => parseEnv({ ...withoutKey, AUTH_MODE: 'otp' })).toThrow(EnvironmentError)
  })

  it('refuses a KYC key too short to be a 256-bit key', () => {
    // Caught at deploy time rather than at the first submission. Padding a short key would
    // produce something that looks like a 256-bit key and carries whatever entropy was supplied.
    expect(() =>
      parseEnv({
        ...production,
        AUTH_MODE: 'otp',
        KYC_ENCRYPTION_KEY: Buffer.alloc(16, 7).toString('base64'),
      }),
    ).toThrow(EnvironmentError)
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
