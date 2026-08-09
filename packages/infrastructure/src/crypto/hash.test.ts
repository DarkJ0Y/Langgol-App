import { describe, expect, it } from 'vitest'
import {
  generateNumericCode,
  generateSessionToken,
  hashSecret,
  hashToken,
  verifySecret,
} from './hash.js'

describe('secret hashing', () => {
  it('produces a self-describing hash that carries its own parameters', async () => {
    const hash = await hashSecret('123456')
    const [algorithm, cost, blockSize, parallelism, salt, derived] = hash.split('$')
    expect(algorithm).toBe('scrypt')
    expect(Number(cost)).toBeGreaterThanOrEqual(2 ** 14)
    expect(Number(blockSize)).toBe(8)
    expect(Number(parallelism)).toBe(1)
    expect(salt).toBeTruthy()
    expect(derived).toBeTruthy()
  })

  it('never contains the plaintext', async () => {
    const hash = await hashSecret('123456')
    expect(hash).not.toContain('123456')
  })

  it('salts, so the same code hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashSecret('123456'), hashSecret('123456')])
    expect(a).not.toBe(b)
  })

  it('verifies the correct secret and rejects a wrong one', async () => {
    const hash = await hashSecret('123456')
    expect(await verifySecret('123456', hash)).toBe(true)
    expect(await verifySecret('123457', hash)).toBe(false)
    expect(await verifySecret('', hash)).toBe(false)
  })

  it('fails closed on a corrupted stored value rather than crashing the login path', async () => {
    for (const corrupt of [
      '',
      'not-a-hash',
      'scrypt$1$2$3',
      'bcrypt$16384$8$1$c2FsdA$ZGVyaXZlZA',
      'scrypt$notanumber$8$1$c2FsdA$ZGVyaXZlZA',
      'scrypt$16384$8$1$$',
    ]) {
      expect(await verifySecret('123456', corrupt)).toBe(false)
    }
  })
})

describe('token hashing', () => {
  it('is deterministic and does not contain the token', () => {
    const token = generateSessionToken()
    expect(hashToken(token)).toBe(hashToken(token))
    expect(hashToken(token)).not.toContain(token)
  })

  it('generates URL-safe tokens with adequate entropy', () => {
    const token = generateSessionToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    // 32 random bytes in base64url.
    expect(token.length).toBeGreaterThanOrEqual(42)
    expect(generateSessionToken()).not.toBe(token)
  })
})

describe('OTP generation', () => {
  it('produces codes of the requested length, digits only', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateNumericCode(6)
      expect(code).toMatch(/^[0-9]{6}$/)
    }
  })

  it('uses every digit — a biased generator would shrink the keyspace', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i += 1) {
      for (const digit of generateNumericCode(6)) seen.add(digit)
    }
    expect(seen.size).toBe(10)
  })
})
