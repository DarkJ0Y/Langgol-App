/**
 * Identity, document and verification-state tests.
 *
 * The properties worth pinning here are the ones whose failure is silent. A mask that stops
 * masking still renders; a transition table that gains an edge still compiles; a file-type check
 * that trusts the declared type still accepts every real file anybody tries. None of those would
 * show up as a broken screen, so each has a test that fails loudly instead.
 */

import { describe, expect, it } from 'vitest'
import {
  IDENTITY_DESCRIPTORS,
  IDENTITY_TYPES,
  IdentityError,
  SUBMITTABLE_IDENTITY_TYPES,
  maskFromLast4,
  normalizeIdentity,
} from './identity-types.js'
import {
  DocumentError,
  MAX_DOCUMENT_BYTES,
  MIN_DOCUMENT_BYTES,
  validateDocument,
  validateSubmissionDocuments,
} from './documents.js'
import {
  AUTOMATIC_VERIFICATION_TYPES,
  REVIEWED_VERIFICATION_TYPES,
  VERIFICATION_STATUSES,
  VERIFICATION_TYPES,
  VerificationError,
  applyTransition,
  canResubmit,
  userFacingStatus,
  type ActorKind,
  type VerificationAction,
  type VerificationStatus,
} from './verification.js'

/** A valid ten-digit smart-card NID, used wherever the number itself is not the subject. */
const NID = '1234567890'

/** Bytes that really are a JPEG, padded past the minimum size. */
function jpeg(bytes = MIN_DOCUMENT_BYTES + 10): Uint8Array {
  const data = new Uint8Array(bytes)
  data.set([0xff, 0xd8, 0xff], 0)
  return data
}

function pdf(bytes = MIN_DOCUMENT_BYTES + 10): Uint8Array {
  const data = new Uint8Array(bytes)
  data.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0)
  return data
}

/* ------------------------------------------------------------- identity */

describe('the document types the platform knows about', () => {
  it('accepts only NID today', () => {
    // The requirement is "support NID" and "design so more can be added". Both halves are tested:
    // one type is submittable, and the others exist as entries rather than as absences.
    expect(SUBMITTABLE_IDENTITY_TYPES).toEqual(['NID'])
    expect(IDENTITY_TYPES.length).toBeGreaterThan(1)
  })

  it('gives every named type a descriptor, so adding one cannot be half done', () => {
    for (const type of IDENTITY_TYPES) {
      expect(IDENTITY_DESCRIPTORS[type], `${type} has no descriptor`).toBeDefined()
      expect(typeof IDENTITY_DESCRIPTORS[type].mask).toBe('function')
    }
  })

  it('refuses a type that is named but not yet accepted', () => {
    // Named-but-unsupported must fail as unsupported, not as a format error — an error about
    // length would imply the right length would have worked.
    let code: string | undefined
    try {
      normalizeIdentity('PASSPORT', 'A1234567')
    } catch (error) {
      if (error instanceof IdentityError) code = error.code
    }
    expect(code).toBe('IDENTITY_TYPE_UNSUPPORTED')
  })

  it('refuses a type nobody has ever declared', () => {
    expect(() => normalizeIdentity('LIBRARY_CARD', NID)).toThrow(IdentityError)
  })
})

describe('reading an NID', () => {
  it('accepts all three lengths that are in circulation', () => {
    // 10 is the smart card, 13 the older paper card, 17 the same prefixed with a birth year.
    // Refusing any of them would turn real people away at the door.
    for (const value of ['1234567890', '1234567890123', '19851234567890123']) {
      expect(() => normalizeIdentity('NID', value)).not.toThrow()
    }
  })

  it('refuses a length that is not one of them', () => {
    for (const value of ['123456789', '12345678901', '123456789012345678']) {
      expect(() => normalizeIdentity('NID', value), value).toThrow(IdentityError)
    }
  })

  it('strips the grouping the card is printed with', () => {
    // The number is printed in groups and people copy what they see. Rejecting a correct number
    // over its formatting is a refusal the submitter cannot act on.
    expect(normalizeIdentity('NID', '123 456 7890').number).toBe(NID)
    expect(normalizeIdentity('NID', '123-456-7890').number).toBe(NID)
  })

  it('accepts Bangla numerals', () => {
    expect(normalizeIdentity('NID', '১২৩৪৫৬৭৮৯০').number).toBe(NID)
  })

  it('refuses a run of one repeated digit', () => {
    // A placeholder somebody typed to get past the form. Caught here so no reviewer is ever shown
    // it, because a reviewer's time is the scarce thing in this whole workflow.
    expect(() => normalizeIdentity('NID', '1111111111')).toThrow(IdentityError)
  })

  it('refuses letters', () => {
    expect(() => normalizeIdentity('NID', '12345ABCDE')).toThrow(IdentityError)
  })

  it('refuses an empty submission rather than storing a blank', () => {
    expect(() => normalizeIdentity('NID', '   ')).toThrow(IdentityError)
  })
})

describe('masking', () => {
  it('reveals four digits and hides the rest', () => {
    const identity = normalizeIdentity('NID', NID)
    expect(identity.masked).toBe('••••••7890')
    expect(identity.last4).toBe('7890')
  })

  it('never lets the full number appear in the masked form', () => {
    // The property that matters, stated directly: whatever the length, the mask must not contain
    // the number. A mask that silently stopped masking would still render.
    for (const value of ['1234567890', '1234567890123', '19851234567890123']) {
      const identity = normalizeIdentity('NID', value)
      expect(identity.masked).not.toContain(value)
      expect(identity.masked).toHaveLength(value.length)
    }
  })

  it('hides more of a longer number, not less', () => {
    const short = normalizeIdentity('NID', '1234567890').masked
    const long = normalizeIdentity('NID', '19851234567890123').masked
    const bullets = (value: string) => [...value].filter((char) => char === '•').length
    expect(bullets(long)).toBeGreaterThan(bullets(short))
  })

  it('rebuilds the same mask from the stored tail, without the number', () => {
    // The read path never decrypts. This is what makes that possible, so it has to agree exactly
    // with what was stored at submission time.
    const identity = normalizeIdentity('NID', NID)
    expect(maskFromLast4('NID', identity.last4, NID.length)).toBe(identity.masked)
  })
})

/* ------------------------------------------------------------- documents */

describe('what may be uploaded as evidence', () => {
  it('accepts a real JPEG', () => {
    const result = validateDocument({ side: 'FRONT', contentType: 'image/jpeg', bytes: jpeg() })
    expect(result.extension).toBe('jpg')
  })

  it('accepts a PDF, because a scanner produces one', () => {
    const result = validateDocument({ side: 'FRONT', contentType: 'application/pdf', bytes: pdf() })
    expect(result.extension).toBe('pdf')
  })

  it('refuses a type that is not on the list', () => {
    const bytes = new Uint8Array(MIN_DOCUMENT_BYTES + 10)
    expect(() => validateDocument({ side: 'FRONT', contentType: 'image/svg+xml', bytes })).toThrow(
      DocumentError,
    )
  })

  it('refuses a file whose bytes contradict its declared type', () => {
    /*
     * The check that makes the allowlist mean anything. A Content-Type header is a claim by
     * whoever uploaded the file; without this, `image/jpeg` on a zip archive passes and the
     * allowlist has only ever inspected a string the attacker wrote.
     */
    const zip = new Uint8Array(MIN_DOCUMENT_BYTES + 10)
    zip.set([0x50, 0x4b, 0x03, 0x04], 0)

    let code: string | undefined
    try {
      validateDocument({ side: 'FRONT', contentType: 'image/jpeg', bytes: zip })
    } catch (error) {
      if (error instanceof DocumentError) code = error.code
    }
    expect(code).toBe('DOCUMENT_CONTENT_MISMATCH')
  })

  it('refuses a file that is too large', () => {
    const huge = jpeg(MAX_DOCUMENT_BYTES + 1)
    expect(() =>
      validateDocument({ side: 'FRONT', contentType: 'image/jpeg', bytes: huge }),
    ).toThrow(DocumentError)
  })

  it('refuses a file too small to be a photograph of anything', () => {
    const tiny = new Uint8Array([0xff, 0xd8, 0xff])
    expect(() =>
      validateDocument({ side: 'FRONT', contentType: 'image/jpeg', bytes: tiny }),
    ).toThrow(DocumentError)
  })

  it('names the side that failed, so only one photo has to be retaken', () => {
    let field: string | undefined
    try {
      validateDocument({ side: 'BACK', contentType: 'image/jpeg', bytes: new Uint8Array(4) })
    } catch (error) {
      if (error instanceof DocumentError) field = error.field
    }
    expect(field).toBe('documentBack')
  })

  it('requires a front, always', () => {
    expect(() =>
      validateSubmissionDocuments({ front: null, back: null, backRequired: false }),
    ).toThrow(DocumentError)
  })

  it('requires a back only for a document that has one', () => {
    const front = { side: 'FRONT' as const, contentType: 'image/jpeg', bytes: jpeg() }

    expect(() => validateSubmissionDocuments({ front, back: null, backRequired: true })).toThrow(
      DocumentError,
    )

    expect(validateSubmissionDocuments({ front, back: null, backRequired: false }).back).toBeNull()
  })
})

/* ---------------------------------------------------------- verification */

describe('the seven things that get verified', () => {
  it('covers exactly the types the requirements name', () => {
    expect([...VERIFICATION_TYPES]).toEqual([
      'PHONE',
      'EMAIL',
      'IDENTITY',
      'FARM',
      'BUSINESS',
      'EXPERT',
      'PAYMENT',
    ])
  })

  it('keeps the automatic ones out of the reviewer queue', () => {
    // A phone or an email in a human queue would sit there forever waiting for a decision nobody
    // is expected to make.
    expect(AUTOMATIC_VERIFICATION_TYPES).toEqual(['PHONE', 'EMAIL'])
    for (const type of AUTOMATIC_VERIFICATION_TYPES) {
      expect(REVIEWED_VERIFICATION_TYPES).not.toContain(type)
    }
  })

  it('partitions every type into exactly one of the two groups', () => {
    const combined = [...AUTOMATIC_VERIFICATION_TYPES, ...REVIEWED_VERIFICATION_TYPES].sort()
    expect(combined).toEqual([...VERIFICATION_TYPES].sort())
  })

  it('has the five statuses the requirements name', () => {
    expect([...VERIFICATION_STATUSES]).toEqual([
      'PENDING',
      'UNDER_REVIEW',
      'VERIFIED',
      'REJECTED',
      'EXPIRED',
    ])
  })
})

describe('a subject cannot verify themselves', () => {
  /*
   * The single most important property in this phase, so it is tested exhaustively rather than by
   * example. Every action, from every state, performed by a SUBJECT: none of them may reach
   * VERIFIED. A future edit that adds such an edge fails here rather than in production.
   */
  it('has no transition at all from a subject to VERIFIED', () => {
    const actions: readonly VerificationAction[] = [
      'SUBMIT',
      'CLAIM',
      'APPROVE',
      'REJECT',
      'EXPIRE',
    ]

    for (const action of actions) {
      for (const from of VERIFICATION_STATUSES) {
        let reached: VerificationStatus | null = null
        try {
          reached = applyTransition({ action, from, by: 'SUBJECT', reason: 'because' }).to
        } catch {
          reached = null
        }
        expect(reached, `SUBJECT reached ${String(reached)} via ${action} from ${from}`).not.toBe(
          'VERIFIED',
        )
      }
    }
  })

  it('lets a subject do nothing except submit', () => {
    const permitted: VerificationAction[] = []
    for (const action of ['SUBMIT', 'CLAIM', 'APPROVE', 'REJECT', 'EXPIRE'] as const) {
      for (const from of VERIFICATION_STATUSES) {
        try {
          applyTransition({ action, from, by: 'SUBJECT', reason: 'because' })
          if (!permitted.includes(action)) permitted.push(action)
        } catch {
          /* refused, which is the expected outcome for everything but SUBMIT */
        }
      }
    }
    expect(permitted).toEqual(['SUBMIT'])
  })

  it('refuses a subject approving even from a state an approval is legal from', () => {
    let code: string | undefined
    try {
      applyTransition({ action: 'APPROVE', from: 'PENDING', by: 'SUBJECT' })
    } catch (error) {
      if (error instanceof VerificationError) code = error.code
    }
    expect(code).toBe('ACTOR_NOT_PERMITTED')
  })
})

describe('the reviewer transitions', () => {
  const reviewer: ActorKind = 'REVIEWER'

  it('approves from pending and from under review', () => {
    expect(applyTransition({ action: 'APPROVE', from: 'PENDING', by: reviewer }).to).toBe(
      'VERIFIED',
    )
    expect(applyTransition({ action: 'APPROVE', from: 'UNDER_REVIEW', by: reviewer }).to).toBe(
      'VERIFIED',
    )
  })

  it('refuses to approve something already decided', () => {
    for (const from of ['VERIFIED', 'REJECTED', 'EXPIRED'] as const) {
      expect(() => applyTransition({ action: 'APPROVE', from, by: reviewer })).toThrow(
        VerificationError,
      )
    }
  })

  it('refuses a rejection with no reason', () => {
    /*
     * The person is going to re-submit. "Rejected" alone tells them nothing about what to change,
     * so they guess, send the same documents, and occupy the queue twice.
     */
    let code: string | undefined
    try {
      applyTransition({ action: 'REJECT', from: 'PENDING', by: reviewer, reason: '   ' })
    } catch (error) {
      if (error instanceof VerificationError) code = error.code
    }
    expect(code).toBe('REASON_REQUIRED')
  })

  it('accepts a rejection that says something', () => {
    const outcome = applyTransition({
      action: 'REJECT',
      from: 'PENDING',
      by: reviewer,
      reason: '  The photo of the back is too blurred to read.  ',
    })
    expect(outcome.to).toBe('REJECTED')
    expect(outcome.reason).toBe('The photo of the back is too blurred to read.')
  })

  it('refuses a reason too long to read', () => {
    expect(() =>
      applyTransition({ action: 'REJECT', from: 'PENDING', by: reviewer, reason: 'x'.repeat(501) }),
    ).toThrow(VerificationError)
  })
})

describe('re-submission', () => {
  it('is allowed after a rejection or an expiry', () => {
    for (const from of ['REJECTED', 'EXPIRED'] as const) {
      expect(applyTransition({ action: 'SUBMIT', from, by: 'SUBJECT' }).to).toBe('PENDING')
    }
  })

  it('is refused while a decision is still outstanding', () => {
    // Otherwise somebody in the queue can push themselves to the back of it, and a reviewer
    // part-way through a file has it change underneath them.
    for (const from of ['PENDING', 'UNDER_REVIEW'] as const) {
      expect(() => applyTransition({ action: 'SUBMIT', from, by: 'SUBJECT' })).toThrow(
        VerificationError,
      )
    }
  })

  it('agrees with what the screen offers', () => {
    // `canResubmit` decides whether the form is rendered at all. If it disagreed with the
    // transition table a person would be shown a form whose submission is always refused.
    for (const status of VERIFICATION_STATUSES) {
      let allowedByTable = true
      try {
        applyTransition({ action: 'SUBMIT', from: status, by: 'SUBJECT' })
      } catch {
        allowedByTable = false
      }
      expect(canResubmit(status), `disagreement at ${status}`).toBe(allowedByTable)
    }
  })

  it('is allowed for somebody who has never submitted', () => {
    expect(canResubmit(null)).toBe(true)
  })
})

describe('expiry', () => {
  it('applies only to something that was verified', () => {
    expect(applyTransition({ action: 'EXPIRE', from: 'VERIFIED', by: 'SYSTEM' }).to).toBe('EXPIRED')
  })

  it('never applies to something nobody has looked at', () => {
    // Marking an unreviewed file EXPIRED would tell the submitter their papers were out of date
    // when the truth is that nobody opened them.
    for (const from of ['PENDING', 'UNDER_REVIEW'] as const) {
      expect(() => applyTransition({ action: 'EXPIRE', from, by: 'SYSTEM' })).toThrow(
        VerificationError,
      )
    }
  })

  it('is not something a reviewer does by hand', () => {
    expect(() => applyTransition({ action: 'EXPIRE', from: 'VERIFIED', by: 'REVIEWER' })).toThrow(
      VerificationError,
    )
  })
})

describe('what the subject is told', () => {
  it('shows the four words the requirements name', () => {
    expect(userFacingStatus(null)).toBe('NOT_VERIFIED')
    expect(userFacingStatus('PENDING')).toBe('PENDING')
    expect(userFacingStatus('VERIFIED')).toBe('VERIFIED')
    expect(userFacingStatus('REJECTED')).toBe('REJECTED')
  })

  it('does not tell a person whether a reviewer has picked up their file', () => {
    // It would raise a question they cannot act on: "why has nobody looked at mine?"
    expect(userFacingStatus('UNDER_REVIEW')).toBe('PENDING')
  })

  it('shows an expired document as not verified, because the remedy is identical', () => {
    expect(userFacingStatus('EXPIRED')).toBe('NOT_VERIFIED')
  })

  it('maps every internal status to one of the four', () => {
    const allowedWords = ['NOT_VERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']
    for (const status of VERIFICATION_STATUSES) {
      expect(allowedWords).toContain(userFacingStatus(status))
    }
  })
})
