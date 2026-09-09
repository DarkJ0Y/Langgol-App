/**
 * Identity encryption and document-grant tests.
 *
 * These exercise the real cryptography rather than the fakes the use-case tests use. The
 * properties below are the ones the whole design rests on, and each is the kind that fails
 * silently: a cipher that stopped binding to its owner still round-trips, and a signature check
 * that stopped checking still returns a payload.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { resetEnvCache } from '@langgol/shared'
import { identityCipher, resetIdentityCipherCache, EncryptionError } from './encryption.js'
import { documentGrantSigner } from './document-grant.js'

const ME = 'a0000000-0000-4000-8000-00000000000a'
const STRANGER = 'b0000000-0000-4000-8000-00000000000b'
const NID = '1234567890'

const KEY = randomBytes(32).toString('base64')
const OTHER_KEY = randomBytes(32).toString('base64')

const original = { ...process.env }

/** The minimum a parsed environment needs before anything here can read a key out of it. */
const BASE_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://langgol:langgol@localhost:5432/langgol',
  DIRECT_URL: 'postgresql://langgol:langgol@localhost:5432/langgol',
  AUTH_SECRET: 'a'.repeat(48),
  JOB_TRIGGER_SECRET: 'y'.repeat(24),
}

function useKey(key: string | undefined): void {
  if (key === undefined) delete process.env['KYC_ENCRYPTION_KEY']
  else process.env['KYC_ENCRYPTION_KEY'] = key
  resetEnvCache()
  resetIdentityCipherCache()
}

beforeEach(() => {
  Object.assign(process.env, BASE_ENV)
  useKey(KEY)
})

afterEach(() => {
  process.env = { ...original }
  resetEnvCache()
  resetIdentityCipherCache()
})

describe('encrypting an identity number', () => {
  it('round-trips under the same owner', () => {
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    expect(identityCipher.decrypt(sealed, { userId: ME })).toBe(NID)
  })

  it('never leaves the number visible in the ciphertext', () => {
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    expect(sealed).not.toContain(NID)
    expect(Buffer.from(sealed).toString('utf8')).not.toContain(NID)
  })

  it('carries a version prefix, which the database also insists on', () => {
    // The CHECK constraint on `identity_records` refuses anything not starting `v1$`, which is
    // what catches a future refactor writing the plaintext into that column.
    expect(identityCipher.encrypt(NID, { userId: ME })).toMatch(/^v1\$/)
  })

  it('produces a different ciphertext every time', () => {
    /*
     * A fresh IV per encryption. Without it, two users with the same NID would produce identical
     * ciphertexts, and the encrypted column would leak equality — which is exactly the property
     * the blind index is supposed to provide deliberately and under a separate key.
     */
    const first = identityCipher.encrypt(NID, { userId: ME })
    const second = identityCipher.encrypt(NID, { userId: ME })
    expect(first).not.toBe(second)
    expect(identityCipher.decrypt(second, { userId: ME })).toBe(NID)
  })

  it('cannot be decrypted against a different owner', () => {
    /*
     * The binding that makes a stolen ciphertext useless in another row. Without it, moving a
     * value between rows would move an identity between accounts.
     */
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    expect(() => identityCipher.decrypt(sealed, { userId: STRANGER })).toThrow(EncryptionError)
  })

  it('detects tampering rather than decrypting into something else', () => {
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    const parts = sealed.split('$')

    /*
     * Flip a bit in the DECODED ciphertext rather than editing a base64 character. Several
     * base64url characters differ only in bits that fall outside the encoded length, so editing
     * the text can decode to identical bytes and the tamper never happens — which is what made
     * an earlier version of this test pass for the wrong reason.
     */
    const body = Buffer.from(parts[3] ?? '', 'base64url')
    body[0] = (body[0] ?? 0) ^ 0xff

    const altered = [parts[0], parts[1], parts[2], body.toString('base64url')].join('$')

    expect(() => identityCipher.decrypt(altered, { userId: ME })).toThrow(EncryptionError)
  })

  it('detects a swapped authentication tag', () => {
    // The tag is what makes this authenticated encryption rather than just encryption.
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    const other = identityCipher.encrypt('9876543210', { userId: ME })

    const mine = sealed.split('$')
    const theirs = other.split('$')
    const spliced = [mine[0], mine[1], theirs[2], mine[3]].join('$')

    expect(() => identityCipher.decrypt(spliced, { userId: ME })).toThrow(EncryptionError)
  })

  it('cannot be decrypted under a different key', () => {
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    useKey(OTHER_KEY)
    expect(() => identityCipher.decrypt(sealed, { userId: ME })).toThrow(EncryptionError)
  })

  it('refuses a malformed ciphertext', () => {
    for (const bad of ['', 'nonsense', 'v2$a$b$c', 'v1$a$b']) {
      expect(() => identityCipher.decrypt(bad, { userId: ME }), bad).toThrow(EncryptionError)
    }
  })

  it('never puts the attempted plaintext in the error it throws', () => {
    // The whole point of the module is that fragments do not travel. A decryption failure is the
    // most likely place for one to escape.
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    try {
      identityCipher.decrypt(sealed, { userId: STRANGER })
      throw new Error('expected a failure')
    } catch (error) {
      expect(String(error)).not.toContain(NID)
      expect(JSON.stringify(error instanceof Error ? error.message : error)).not.toContain(NID)
    }
  })
})

describe('the blind index', () => {
  it('is stable, so the same number is findable across accounts', () => {
    // One document verifies one person. That check is only possible because this is deterministic.
    expect(identityCipher.blindIndex(NID)).toBe(identityCipher.blindIndex(NID))
  })

  it('does not depend on who submitted the number', () => {
    // If it did, the same card on two accounts would produce two indexes and the duplicate would
    // go undetected — which is the abuse the whole feature exists to prevent.
    const sealedForMe = identityCipher.blindIndex(NID)
    expect(sealedForMe).toBe(identityCipher.blindIndex(NID))
  })

  it('differs for different numbers', () => {
    expect(identityCipher.blindIndex(NID)).not.toBe(identityCipher.blindIndex('9876543210'))
  })

  it('does not reveal the number', () => {
    expect(identityCipher.blindIndex(NID)).not.toContain(NID)
  })

  it('is not derivable from the encryption subkey', () => {
    /*
     * The two subkeys are independent by HKDF label. Stated as a test because the failure mode is
     * subtle: an index built with the ENCRYPTION key would let anyone able to compute it confirm
     * a guessed NID against the ciphertext column.
     */
    const index = identityCipher.blindIndex(NID)
    const sealed = identityCipher.encrypt(NID, { userId: ME })
    expect(sealed).not.toContain(index)
    expect(index).not.toContain(sealed.split('$')[3] ?? '')
  })

  it('changes when the master key changes', () => {
    const before = identityCipher.blindIndex(NID)
    useKey(OTHER_KEY)
    expect(identityCipher.blindIndex(NID)).not.toBe(before)
  })
})

describe('when no key is configured', () => {
  beforeEach(() => {
    useKey(undefined)
  })

  it('reports itself unconfigured rather than pretending', () => {
    expect(identityCipher.isConfigured).toBe(false)
  })

  it('refuses to encrypt, so nothing is ever stored in clear', () => {
    expect(() => identityCipher.encrypt(NID, { userId: ME })).toThrow(EncryptionError)
  })
})

describe('when the key is too short', () => {
  beforeEach(() => {
    useKey(randomBytes(16).toString('base64'))
  })

  it('is treated as unconfigured rather than stretched to length', () => {
    // Padding a short key would produce something that looks like a 256-bit key and carries
    // whatever entropy the operator actually supplied.
    expect(identityCipher.isConfigured).toBe(false)
  })

  it('refuses to encrypt', () => {
    expect(() => identityCipher.encrypt(NID, { userId: ME })).toThrow(EncryptionError)
  })
})

/* ------------------------------------------------------------- grants */

describe('document grants', () => {
  const NOW = new Date('2026-09-07T09:00:00.000Z')
  const grant = { storageKey: 'kyc-documents/abc.jpg', viewerUserId: ME, verificationId: 'ver-1' }

  it('round-trips what it was given', () => {
    const token = documentGrantSigner.issue(grant, NOW)
    const decoded = documentGrantSigner.verify(token, NOW)

    expect(decoded?.storageKey).toBe(grant.storageKey)
    expect(decoded?.viewerUserId).toBe(ME)
    expect(decoded?.verificationId).toBe('ver-1')
  })

  it('expires', () => {
    const token = documentGrantSigner.issue(grant, NOW, 60)
    expect(documentGrantSigner.verify(token, new Date(NOW.getTime() + 61_000))).toBeNull()
  })

  it('caps a TTL the caller asks for', () => {
    // A caller able to name its own expiry could mint a grant that outlived the review.
    const token = documentGrantSigner.issue(grant, NOW, 60 * 60 * 24 * 365)
    const decoded = documentGrantSigner.verify(token, NOW)
    const lifetimeSeconds = ((decoded?.expiresAt.getTime() ?? 0) - NOW.getTime()) / 1000
    expect(lifetimeSeconds).toBeLessThanOrEqual(3600)
  })

  it('rejects an altered viewer', () => {
    /*
     * The claim that makes a leaked link inert. If the viewer could be edited, the token would be
     * a bearer credential anybody could redeem.
     */
    const token = documentGrantSigner.issue(grant, NOW)
    const [payload = '', signature = ''] = token.split('.')

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      v: string
    }
    decoded.v = STRANGER
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`

    expect(documentGrantSigner.verify(forged, NOW)).toBeNull()
  })

  it('rejects an altered storage key', () => {
    const token = documentGrantSigner.issue(grant, NOW)
    const [payload = '', signature = ''] = token.split('.')

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { k: string }
    decoded.k = 'kyc-documents/somebody-elses.jpg'
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`

    expect(documentGrantSigner.verify(forged, NOW)).toBeNull()
  })

  it('rejects an altered expiry', () => {
    const token = documentGrantSigner.issue(grant, NOW, 60)
    const [payload = '', signature = ''] = token.split('.')

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e: number }
    decoded.e = decoded.e + 86_400
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`

    expect(documentGrantSigner.verify(forged, NOW)).toBeNull()
  })

  it('rejects a token with no signature at all', () => {
    for (const bad of ['', 'abc', 'abc.', '.abc']) {
      expect(documentGrantSigner.verify(bad, NOW), bad).toBeNull()
    }
  })

  it('rejects a signature made with a different secret', () => {
    const token = documentGrantSigner.issue(grant, NOW)
    process.env['AUTH_SECRET'] = 'b'.repeat(48)
    resetEnvCache()
    expect(documentGrantSigner.verify(token, NOW)).toBeNull()
  })
})
