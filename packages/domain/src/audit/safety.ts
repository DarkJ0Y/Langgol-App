/**
 * What must never reach the audit table, and the check that makes sure it does not.
 *
 * The requirement is a list of things it is forbidden to log: a password, an OTP, a raw national
 * identity number, a KYC document, an authentication token, private financial data. Every one of
 * those is a rule that holds right up until somebody writing an audit line at the end of a long
 * afternoon puts a helpful detail in the reason field.
 *
 * So it is enforced rather than remembered. `sanitiseAuditEntry` runs inside the audit port, on
 * every write, and no caller can skip it because no caller reaches the table directly.
 *
 * ## Why it scrubs rather than refuses
 *
 * A tripwire that threw would have to fail either the audit write or the action that triggered it.
 * Losing the audit line is the worse outcome — the event still happened and now nothing records it
 * — and failing a farmer's profile save because of an audit formatting problem is worse still.
 *
 * So the offending value is replaced and the substitution is recorded on the row. An investigator
 * sees that something was removed and can go looking; a secret does not reach a table with a
 * different retention policy and a much wider audience than the column it belongs in.
 *
 * ## Why this is not just `redact()`
 *
 * `packages/shared/src/redact.ts` does this for LOG LINES, which are transient and read by
 * developers. This is for a durable, queryable table read by operators and regulators, and it is
 * in the domain because the rule is a business rule about personal data rather than a logging
 * convenience. The two share an approach and deliberately not an implementation: weakening one
 * must not silently weaken the other.
 *
 * Refs: docs/07_SECURITY.md §7, §9, §11
 */

import {
  BD_PHONE_PATTERN,
  IDENTITY_RUN_PATTERN,
  collapse,
  wordSegments,
} from '../privacy/shapes.js'

/** What replaces something that should not have been there. Recognisable in a query. */
export const AUDIT_REDACTED = '[redacted]'

/**
 * Key segments whose values never survive.
 *
 * Matched on word segments rather than substrings, so `nidHash` splits to ['nid','hash'] and is
 * caught while `candidate` is not. Deliberately broader than the fields that exist today: the
 * point is to catch a field nobody has thought of yet.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  // Credentials
  'password',
  'secret',
  'token',
  'otp',
  'code',
  'pin',
  'hash',
  'key',
  'credential',
  'signature',
  'authorization',
  'cookie',
  'session',
  // Identity
  'nid',
  'identity',
  'passport',
  'ciphertext',
  // Documents
  'document',
  'storagekey',
  'attachment',
  // Money
  'poisha',
  'revenue',
  'balance',
  'payout',
  'account',
  'card',
  'cvv',
  'iban',
])

/**
 * Segments that declare a value already safe, exempting the key from the name check.
 *
 * `identityNumberMasked` is the case that forced this. The mask is the one useful thing on a KYC
 * audit row — enough to tell two submissions apart and not a disclosure — and the plain key rule
 * scrubbed it, because the key contains `identity`. Removing it would have left a row recording
 * that somebody submitted something.
 *
 * The exemption is narrow and it is not a bypass: the VALUE check still runs, so a field named
 * `masked` that carries an unmasked number is caught by its shape. The name gets a field the
 * benefit of the doubt; the content still has to earn it.
 */
const SAFE_BY_CONSTRUCTION: ReadonlySet<string> = new Set(['masked', 'redacted', 'count', 'last4'])

export const isForbiddenAuditKey = (name: string): boolean => {
  const parts = wordSegments(name)
  if (parts.some((segment) => SAFE_BY_CONSTRUCTION.has(segment))) return false
  return parts.some((segment) => FORBIDDEN_KEYS.has(segment))
}

/* ------------------------------------------------------------------ shapes */

/** This codebase's own hash format, and a bearer credential. */
const SCRYPT = /scrypt\$/
const BEARER = /Bearer\s+\S+/i

/** A key into private object storage. A durable pointer at somebody's identity document. */
const STORAGE_KEY = /kyc-documents\//

/**
 * A long opaque token.
 *
 * Session tokens, document grants and email verification links are all base64url of 32 bytes or
 * more. Forty characters is comfortably above anything a person types and below what a URL-safe
 * identifier of ordinary length would reach.
 */
const OPAQUE_TOKEN = /[A-Za-z0-9_-]{40,}/

const SHAPES: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'PHONE', pattern: BD_PHONE_PATTERN },
  { name: 'IDENTITY_NUMBER', pattern: IDENTITY_RUN_PATTERN },
  { name: 'PASSWORD_HASH', pattern: SCRYPT },
  { name: 'BEARER_TOKEN', pattern: BEARER },
  { name: 'DOCUMENT_KEY', pattern: STORAGE_KEY },
  { name: 'OPAQUE_TOKEN', pattern: OPAQUE_TOKEN },
]

/** The forbidden shape a string carries, or null. */
export function forbiddenShape(value: string): string | null {
  const collapsed = collapse(value)
  for (const shape of SHAPES) {
    // The phone and identity patterns are checked against the collapsed form so that spacing
    // cannot smuggle a number past; the rest are checked as written.
    const subject = shape.name === 'PHONE' || shape.name === 'IDENTITY_NUMBER' ? collapsed : value
    if (shape.pattern.test(subject)) return shape.name
  }
  return null
}

/* ------------------------------------------------------------- the entry */

export type AuditMetaValue = string | number | boolean

export interface AuditEntryInput {
  readonly action: string
  readonly reason?: string | undefined
  readonly meta?: Readonly<Record<string, AuditMetaValue>> | undefined
}

export interface SanitisedAuditEntry {
  readonly reason: string | null
  readonly meta: Record<string, AuditMetaValue> | null
  /**
   * What was removed, and from where.
   *
   * Written onto the row so an investigator can see that a substitution happened. An entry that
   * was quietly cleaned looks identical to one that never carried anything, which is exactly the
   * ambiguity an audit trail exists to remove.
   */
  readonly redactions: readonly string[]
}

/**
 * Clean an audit entry before it is stored.
 *
 * Both halves are checked. `reason` is free text a person typed and is scrubbed WHOLESALE when it
 * carries a forbidden shape — replacing the offending substring would leave the rest, and the rest
 * is usually the sentence that identifies what was removed.
 *
 * `meta` is structured, so a bad key loses its value and the others survive.
 */
export function sanitiseAuditEntry(entry: AuditEntryInput): SanitisedAuditEntry {
  const redactions: string[] = []

  let reason: string | null = entry.reason ?? null
  if (typeof reason === 'string' && reason !== '') {
    const shape = forbiddenShape(reason)
    if (shape !== null) {
      redactions.push(`reason:${shape}`)
      reason = AUDIT_REDACTED
    }
  }

  let meta: Record<string, AuditMetaValue> | null = null
  if (entry.meta !== undefined) {
    meta = {}
    for (const [key, value] of Object.entries(entry.meta)) {
      if (isForbiddenAuditKey(key)) {
        redactions.push(`meta.${key}:FORBIDDEN_KEY`)
        meta[key] = AUDIT_REDACTED
        continue
      }

      if (typeof value === 'string') {
        const shape = forbiddenShape(value)
        if (shape !== null) {
          redactions.push(`meta.${key}:${shape}`)
          meta[key] = AUDIT_REDACTED
          continue
        }
      }

      meta[key] = value
    }
  }

  return { reason, meta, redactions }
}

/** Whether an entry is already clean. For a test, and for an assertion in development. */
export const isAuditSafe = (entry: AuditEntryInput): boolean =>
  sanitiseAuditEntry(entry).redactions.length === 0
