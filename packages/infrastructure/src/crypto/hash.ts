/**
 * Secret hashing and constant-time comparison.
 *
 * Two different problems, two different tools — conflating them is a common mistake:
 *
 *  - **OTP codes** are low-entropy (a million possibilities). They need a *slow*, memory-hard
 *    hash so that a leaked database cannot be brute-forced offline. `scrypt` (ADR-21).
 *  - **Session tokens** are 256-bit random values. There is no brute-force surface, so a fast
 *    hash is correct; a slow one would only add latency to every request. `SHA-256`.
 *
 * Nothing here ever logs, returns or throws the plaintext secret.
 *
 * Refs: docs/07_SECURITY.md §3.1, §3.3; docs/03_ARCHITECTURE.md ADR-21
 */

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

interface ScryptParams {
  readonly N: number
  readonly r: number
  readonly p: number
  readonly maxmem: number
}

/**
 * `promisify` resolves to the three-argument scrypt overload, which drops the cost parameters.
 * Declaring the signature keeps them — silently falling back to Node's defaults would weaken
 * every hash without any visible symptom.
 */
const scryptAsync = promisify(scrypt) as (
  secret: string,
  salt: Buffer,
  keylen: number,
  options: ScryptParams,
) => Promise<Buffer>

/** OWASP-aligned scrypt parameters. Stored alongside each hash so they can be raised later. */
const SCRYPT_COST = 2 ** 15
const SCRYPT_BLOCK_SIZE = 8
const SCRYPT_PARALLELISM = 1
const SCRYPT_KEY_LENGTH = 32
const SALT_BYTES = 16

/**
 * Node's default scrypt memory limit is 32 MiB, and N=2^15 with r=8 needs exactly 128·N·r =
 * 32 MiB plus overhead — so the default rejects our own parameters at runtime. Without this the
 * cost would have to be halved, weakening every hash, or every OTP request would throw.
 * Headroom is granted explicitly rather than by lowering the cost.
 */
const SCRYPT_MAX_MEMORY = 128 * SCRYPT_COST * SCRYPT_BLOCK_SIZE * 2

/**
 * Hash a low-entropy secret. Format: `scrypt$N$r$p$salt$derived`, both parts base64url.
 *
 * The parameters travel with the hash so that raising them later does not invalidate every
 * existing challenge — old hashes verify under their own parameters.
 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scryptAsync(secret, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: SCRYPT_MAX_MEMORY,
  })

  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELISM,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

/**
 * Verify a secret against a stored hash in constant time.
 *
 * Returns `false` for a malformed stored value rather than throwing: a corrupted row must fail
 * closed, not crash the login path.
 */
export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const cost = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelism = Number(parts[3])
  const saltPart = parts[4]
  const derivedPart = parts[5]

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelism) ||
    saltPart === undefined ||
    derivedPart === undefined
  ) {
    return false
  }

  const salt = Buffer.from(saltPart, 'base64url')
  const expected = Buffer.from(derivedPart, 'base64url')
  if (salt.length === 0 || expected.length === 0) return false

  const actual = await scryptAsync(secret, salt, expected.length, {
    N: cost,
    r: blockSize,
    p: parallelism,
    // Derived from the stored parameters, so an older hash with a lower cost still verifies.
    maxmem: Math.max(SCRYPT_MAX_MEMORY, 128 * cost * blockSize * 2),
  })

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Fast hash for high-entropy tokens. A stolen database must not yield usable sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/** A 256-bit URL-safe random token for sessions. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * A URL-safe random token of the given byte length.
 *
 * base64url so it survives a query string, an email client's link rewriting and a copy-paste out
 * of a message, none of which are kind to `+` or `/`.
 */
export function generateToken(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    // A token shorter than 128 bits is guessable at scale. Refusing beats silently issuing one.
    throw new RangeError('A verification token must be at least 16 bytes')
  }
  return randomBytes(bytes).toString('base64url')
}

/**
 * Generate a numeric OTP from a CSPRNG.
 *
 * `randomInt` is uniform and rejection-samples internally — `Math.random()` would be predictable
 * and `randomBytes() % 10` would be biased toward low digits.
 */
export function generateNumericCode(length: number): string {
  let code = ''
  for (let index = 0; index < length; index += 1) {
    code += String(randomInt(0, 10))
  }
  return code
}
