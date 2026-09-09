/**
 * Encryption for identity numbers at rest.
 *
 * An NID is not a password. Hashing it would be the wrong tool twice over: a reviewer has to be
 * able to READ the number to check it against a card, and the value space is small enough that a
 * hash is reversible by enumeration anyway. So it is encrypted, reversibly, under a key that
 * lives outside the database.
 *
 * ## AES-256-GCM, bound to its owner
 *
 * GCM is authenticated encryption: it detects tampering rather than decrypting quietly into
 * something else. The owning user's id is passed as additional authenticated data, which means a
 * ciphertext lifted from one row and pasted into another **fails to decrypt** instead of moving
 * an identity between accounts. Confidentiality alone would not have caught that.
 *
 * ## Two subkeys, one secret
 *
 * The stored value must be searchable — "has this NID already been registered?" has to be
 * answerable without decrypting every row in the table. That needs a deterministic index, and a
 * deterministic index built with the ENCRYPTION key would leak: anyone able to compute it could
 * confirm a guessed NID against the ciphertext column.
 *
 * So HKDF derives two independent subkeys from one master secret, with different `info` labels.
 * Compromising the index tells you nothing about the cipher, and the operator still has exactly
 * one secret to store and rotate.
 *
 * ## The blind index and what it does not hide
 *
 * A blind index is deterministic by necessity — that is what makes it an index. Anyone holding
 * the index key can therefore test a guessed NID against it. That is an accepted, bounded
 * trade: the key never leaves the server, and the alternative (no duplicate detection at all)
 * means one document verifying many accounts. It is recorded here so the property is a decision
 * rather than a surprise.
 *
 * Nothing in this module logs, throws or returns a plaintext identity number.
 *
 * Refs: docs/07_SECURITY.md §7, §11
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'
import type { IdentityCipher } from '@langgol/application'
import { env } from '@langgol/shared'

/** Versioned so a future key rotation can read old rows while writing new ones. */
const FORMAT_VERSION = 'v1'

const ALGORITHM = 'aes-256-gcm'
/** 96 bits, the size GCM is specified for. Anything else costs security for no benefit. */
const IV_BYTES = 12
const KEY_BYTES = 32
const TAG_BYTES = 16

/**
 * Salt for the key derivation.
 *
 * A constant, and that is correct here. HKDF's salt adds no secrecy — it exists to decorrelate
 * derivations, which the distinct `info` labels below already do. A random salt would have to be
 * stored somewhere to derive the same key twice, which is a second secret to manage for no gain.
 */
const HKDF_SALT = Buffer.from('langgol.kyc.hkdf.v1')

const ENCRYPTION_INFO = Buffer.from('langgol.kyc.identity-number.encryption')
const BLIND_INDEX_INFO = Buffer.from('langgol.kyc.identity-number.blind-index')

export class EncryptionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'EncryptionError'
  }
}

interface DerivedKeys {
  readonly encryption: Buffer
  readonly blindIndex: Buffer
}

let cached: DerivedKeys | null = null
let cachedFrom: string | null = null

function master(): Buffer | null {
  const configured = env().KYC_ENCRYPTION_KEY
  if (configured === undefined || configured.trim() === '') return null

  const decoded = Buffer.from(configured, 'base64')
  // Refused rather than stretched. Padding a short key to length would produce something that
  // looks like a 256-bit key and carries whatever entropy the operator actually supplied.
  if (decoded.byteLength < KEY_BYTES) {
    throw new EncryptionError(
      'KYC_ENCRYPTION_KEY must decode to at least 32 bytes',
      'KEY_TOO_SHORT',
    )
  }
  return decoded
}

function keys(): DerivedKeys {
  const secret = master()
  if (secret === null) {
    throw new EncryptionError('KYC_ENCRYPTION_KEY is not configured', 'NOT_CONFIGURED')
  }

  // Cached against the key material itself, so a test that swaps the environment gets fresh
  // subkeys rather than the previous run's.
  const fingerprint = secret.toString('base64')
  if (cached !== null && cachedFrom === fingerprint) return cached

  const derived: DerivedKeys = {
    encryption: Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, ENCRYPTION_INFO, KEY_BYTES)),
    blindIndex: Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, BLIND_INDEX_INFO, KEY_BYTES)),
  }

  cached = derived
  cachedFrom = fingerprint
  return derived
}

/**
 * The identity cipher.
 *
 * Every method takes the owning user id, which is bound into the ciphertext. That is not
 * ceremony: it is what makes a stolen ciphertext useless in another row.
 */
export const identityCipher: IdentityCipher = {
  get isConfigured(): boolean {
    try {
      return master() !== null
    } catch {
      // A present-but-malformed key is not configured for our purposes. Reporting it as
      // available would mean every submission failed with an unexplained cipher error.
      return false
    }
  },

  encrypt(plaintext: string, context: { readonly userId: string }): string {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv(ALGORITHM, keys().encryption, iv, {
      authTagLength: TAG_BYTES,
    })

    // The owner is authenticated but not encrypted — it is already in the row. Binding it here is
    // what makes a ciphertext moved between rows fail loudly instead of decrypting.
    cipher.setAAD(Buffer.from(context.userId, 'utf8'))

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    return [
      FORMAT_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('$')
  },

  decrypt(stored: string, context: { readonly userId: string }): string {
    const parts = stored.split('$')
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new EncryptionError('Unrecognised ciphertext format', 'BAD_FORMAT')
    }

    const iv = Buffer.from(parts[1] ?? '', 'base64url')
    const tag = Buffer.from(parts[2] ?? '', 'base64url')
    const ciphertext = Buffer.from(parts[3] ?? '', 'base64url')

    if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
      throw new EncryptionError('Unrecognised ciphertext format', 'BAD_FORMAT')
    }

    const decipher = createDecipheriv(ALGORITHM, keys().encryption, iv, {
      authTagLength: TAG_BYTES,
    })
    decipher.setAAD(Buffer.from(context.userId, 'utf8'))
    decipher.setAuthTag(tag)

    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
      /*
       * A failed tag check means the ciphertext was altered, the key is wrong, or the row it came
       * from is not the row it was written for. All three are the same answer to the caller, and
       * the underlying error is swallowed deliberately — it can carry fragments of the attempted
       * plaintext, and this module's whole job is that such fragments never travel.
       */
      throw new EncryptionError('Could not decrypt', 'DECRYPT_FAILED')
    }
  },

  /**
   * A deterministic, keyed index over the number.
   *
   * Not bound to a user, unlike the ciphertext — the entire point is to find the same number
   * across DIFFERENT accounts, which is how one document verifying several people is detected.
   */
  blindIndex(plaintext: string): string {
    return createHmac('sha256', keys().blindIndex).update(plaintext, 'utf8').digest('base64url')
  },
}

/** Clears the derived-key cache. Tests only; never called by application code. */
export function resetIdentityCipherCache(): void {
  cached = null
  cachedFrom = null
}
