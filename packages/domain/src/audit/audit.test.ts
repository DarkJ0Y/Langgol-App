/**
 * Audit vocabulary and safety tests.
 *
 * The safety tests are the point. "Never log a password, an OTP, a raw NID, a document, a token or
 * financial data" is a requirement that holds right up until somebody puts a helpful detail in a
 * reason field, so each forbidden category has a test that feeds it through the sanitiser in the
 * shape it would actually arrive in.
 */

import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  IP_BEARING_ACTIONS,
  isAuditAction,
  isAuditEntityType,
  shouldRecordIp,
} from './actions.js'
import {
  AUDIT_REDACTED,
  forbiddenShape,
  isAuditSafe,
  isForbiddenAuditKey,
  sanitiseAuditEntry,
} from './safety.js'

/* ============================================================== vocabulary */

describe('the action vocabulary', () => {
  it('covers every action the requirements name', () => {
    /*
     * The specification lists fifteen. Each is checked by name rather than by count, so renaming
     * one to something almost-right fails here instead of leaving a query that returns nothing.
     */
    const required = [
      'ACCOUNT_CREATED',
      'PHONE_VERIFIED',
      'EMAIL_VERIFIED',
      'ROLE_ADDED',
      'ROLE_REMOVED',
      'PROFILE_UPDATED',
      'KYC_SUBMITTED',
      'KYC_APPROVED',
      'KYC_REJECTED',
      'FARM_CREATED',
      'FARM_UPDATED',
      'CONSENT_GRANTED',
      'CONSENT_REVOKED',
      'ACCOUNT_SUSPENDED',
      'ACCOUNT_RESTORED',
    ]

    for (const action of required) {
      expect(isAuditAction(action), action).toBe(true)
    }
  })

  it('has no duplicates', () => {
    // A duplicate is harmless at runtime and a sign that two areas named the same event twice.
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })

  it('refuses an action nobody declared', () => {
    // The bare `APPROVE` the KYC decision used to write, among others.
    for (const bad of ['APPROVE', 'REJECT', 'ROLE_ASSIGNED', 'anything']) {
      expect(isAuditAction(bad), bad).toBe(false)
    }
  })

  it('never names an action as a bare instruction', () => {
    /*
     * An audit log records what happened. The KYC decision used to write `KYC_APPROVE` and
     * `KYC_REJECT`, built by interpolating the transition name — present-tense instructions in a
     * table whose every other row describes a completed event, and unverifiable against any
     * vocabulary because they were assembled from a string.
     *
     * Checked against the imperative forms rather than by a suffix rule, because a suffix rule
     * cannot tell `SIGNED_IN` from `SIGN_IN` without listing one of them anyway.
     */
    const imperatives = ['APPROVE', 'REJECT', 'CLAIM', 'SUBMIT', 'GRANT', 'REVOKE', 'SUSPEND']

    for (const action of AUDIT_ACTIONS) {
      const tail = action.slice(action.lastIndexOf('_') + 1)
      expect(imperatives, `${action} reads as an instruction`).not.toContain(tail)
    }
  })

  it('names a closed set of entity types', () => {
    expect(isAuditEntityType('user')).toBe(true)
    expect(isAuditEntityType('Farm')).toBe(false)
    expect(new Set(AUDIT_ENTITY_TYPES).size).toBe(AUDIT_ENTITY_TYPES.length)
  })
})

describe('when an IP address is kept', () => {
  it('keeps one for the events that answer a security question', () => {
    for (const action of [
      'OTP_VERIFY_FAILED',
      'ACCOUNT_SUSPENDED',
      'KYC_IDENTITY_NUMBER_REVEALED',
    ]) {
      expect(shouldRecordIp(action as never), action).toBe(true)
    }
  })

  it('drops one for ordinary business events', () => {
    /*
     * An IP address is personal data. Collecting it on a farm update would be collection for its
     * own sake, and the audit port drops it even when a caller passes one — so over-collection is
     * impossible rather than discouraged.
     */
    for (const action of ['FARM_UPDATED', 'PLOT_CREATED', 'ADDRESS_UPDATED', 'AGRI_ID_ISSUED']) {
      expect(shouldRecordIp(action as never), action).toBe(false)
    }
  })

  it('only names actions that exist', () => {
    for (const action of IP_BEARING_ACTIONS) {
      expect(isAuditAction(action), action).toBe(true)
    }
  })
})

/* ================================================================== safety */

describe('what must never reach the audit table', () => {
  it('scrubs a raw identity number from a reason', () => {
    const result = sanitiseAuditEntry({
      action: 'KYC_REJECTED',
      reason: 'NID 1234567890 does not match the photograph',
    })

    expect(result.reason).toBe(AUDIT_REDACTED)
    expect(result.redactions).toContain('reason:IDENTITY_NUMBER')
  })

  it('scrubs a phone number however it was written', () => {
    for (const written of ['+8801712345678', '01712345678', '+880 1712 345678']) {
      const result = sanitiseAuditEntry({ action: 'PROFILE_UPDATED', reason: `called ${written}` })
      expect(result.reason, written).toBe(AUDIT_REDACTED)
    }
  })

  it('scrubs a password hash', () => {
    const result = sanitiseAuditEntry({
      action: 'PROFILE_UPDATED',
      meta: { note: 'scrypt$32768$8$1$abc$def' },
    })
    expect(result.meta?.['note']).toBe(AUDIT_REDACTED)
  })

  it('scrubs an authentication token', () => {
    const result = sanitiseAuditEntry({
      action: 'SIGN_OUT',
      meta: { header: 'Bearer abc.def.ghi' },
    })
    expect(result.meta?.['header']).toBe(AUDIT_REDACTED)
  })

  it('scrubs an opaque token even under an innocent key', () => {
    // Session tokens, document grants and verification links are all long base64url strings.
    const result = sanitiseAuditEntry({
      action: 'SIGN_OUT',
      meta: { note: 'x'.repeat(48) },
    })
    expect(result.meta?.['note']).toBe(AUDIT_REDACTED)
  })

  it('scrubs a KYC document key', () => {
    /*
     * A storage key is a durable pointer at somebody's identity document. In the audit table it
     * would outlive the review that needed it, in a place with a wider audience.
     */
    const result = sanitiseAuditEntry({
      action: 'KYC_DOCUMENT_VIEWED',
      meta: { object: 'kyc-documents/9f2c.jpg' },
    })
    expect(result.meta?.['object']).toBe(AUDIT_REDACTED)
  })

  it('scrubs anything under a forbidden key, whatever its value', () => {
    const result = sanitiseAuditEntry({
      action: 'OTP_VERIFY_FAILED',
      meta: {
        otp: '123456',
        password: 'hunter2',
        sessionToken: 'abc',
        nidNumber: '99',
        payoutAccount: 'x',
        revenuePoisha: 45000,
      },
    })

    for (const key of ['otp', 'password', 'sessionToken', 'nidNumber', 'payoutAccount']) {
      expect(result.meta?.[key], key).toBe(AUDIT_REDACTED)
    }
    // A number under a money key too — the key alone is enough.
    expect(result.meta?.['revenuePoisha']).toBe(AUDIT_REDACTED)
  })

  it('catches a forbidden key however it is spelled', () => {
    for (const key of ['otp', 'otpCode', 'session_token', 'nidHash', 'documentKey', 'cardCvv']) {
      expect(isForbiddenAuditKey(key), key).toBe(true)
    }
  })

  it('records what it removed, so a cleaned entry is not mistaken for an empty one', () => {
    /*
     * An entry that was quietly cleaned looks identical to one that never carried anything, which
     * is exactly the ambiguity an audit trail exists to remove.
     */
    const result = sanitiseAuditEntry({
      action: 'KYC_REJECTED',
      reason: 'card shows 1234567890',
      meta: { otp: '123456' },
    })

    expect(result.redactions).toHaveLength(2)
    expect(result.redactions.some((entry) => entry.startsWith('reason:'))).toBe(true)
    expect(result.redactions.some((entry) => entry.startsWith('meta.otp:'))).toBe(true)
  })
})

describe('what an audit entry is still allowed to say', () => {
  it('leaves an ordinary reason alone', () => {
    /*
     * Over-scrubbing would make the log unreadable, and a log nobody can read is a log nobody
     * consults. The rule has to leave the sentences a reviewer actually writes.
     */
    const reasons = [
      'The photo of the back is too blurred to read',
      'Repeated fraudulent listings reported by three buyers',
      'Duplicate account, merged into the older one',
      'Blurred on line 3',
    ]

    for (const reason of reasons) {
      expect(isAuditSafe({ action: 'KYC_REJECTED', reason }), reason).toBe(true)
    }
  })

  it('leaves a year, a count and a short number alone', () => {
    // A rule that scrubbed these would be switched off within a week, and then it protects nothing.
    expect(forbiddenShape('season 2026, 4 plots, 125 kg')).toBeNull()
  })

  it('keeps the field names that make an entry useful', () => {
    const result = sanitiseAuditEntry({
      action: 'ROLE_ADDED',
      meta: { role: 'FARMER', grantedBy: 'admin', permission: 'KYC_VIEW' },
    })

    expect(result.meta?.['role']).toBe('FARMER')
    expect(result.meta?.['permission']).toBe('KYC_VIEW')
    expect(result.redactions).toHaveLength(0)
  })

  it('keeps a masked identity number, which is what the KYC flow deliberately records', () => {
    // The mask is the whole point of storing one: enough to tell two submissions apart, and not a
    // disclosure. Scrubbing it would remove the only useful thing on that row.
    const result = sanitiseAuditEntry({
      action: 'KYC_SUBMITTED',
      meta: { identityNumberMasked: '••••••7890' },
    })
    expect(result.redactions).toHaveLength(0)
  })

  it('passes an entry carrying nothing at all', () => {
    const result = sanitiseAuditEntry({ action: 'AGRI_ID_ISSUED' })
    expect(result.reason).toBeNull()
    expect(result.meta).toBeNull()
    expect(result.redactions).toHaveLength(0)
  })
})
