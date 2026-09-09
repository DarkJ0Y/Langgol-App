/**
 * KYC use-case tests, with unauthorized access as the main subject.
 *
 * The requirement is explicit — "especially unauthorized KYC access" — so the cases below are
 * organised around who is asking rather than around what the code does. For every operation the
 * questions are the same four:
 *
 *  1. can an anonymous caller reach it?
 *  2. can a signed-in stranger reach somebody else's file?
 *  3. can an ordinary user reach a reviewer's operation?
 *  4. can a reviewer reach their OWN file?
 *
 * The fourth is the one that gets forgotten. An administrator is also a user, and self-approval
 * is both trivially obtainable and invisible afterwards.
 *
 * The fakes below behave like the real implementations in the ways that matter: the repository
 * scopes by owner rather than returning whatever it is asked for, and the cipher really does bind
 * a ciphertext to a user. A fake that ignored ownership would make every test here pass while the
 * real query leaked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor, type Role } from '@langgol/domain/policy'
import { MIN_DOCUMENT_BYTES } from '@langgol/domain/kyc'
import { isErr, isOk } from '@langgol/shared'
import { myVerifications, submitIdentity, type KycDeps } from './identity.js'
import { listPendingReviews, reviewVerification, verificationHistory } from './review.js'
import {
  issueDocumentGrant,
  revealIdentityNumber,
  serveDocument,
  type DocumentDeps,
} from './documents.js'
import type {
  PendingQueueEntry,
  SubmitIdentityInput,
  VerificationEventRecord,
  VerificationRecord,
} from '../../ports/index.js'

const ME = 'a0000000-0000-4000-8000-00000000000a'
const STRANGER = 'b0000000-0000-4000-8000-00000000000b'
const ADMIN = 'c0000000-0000-4000-8000-00000000000c'
const NOW = new Date('2026-09-07T09:00:00.000Z')

const NID = '1234567890'
const OTHER_NID = '9876543210'

const actor = (userId: string, ...roles: Role[]): Actor => ({ userId, roles, status: 'ACTIVE' })

const me = () => actor(ME, 'FARMER')
const stranger = () => actor(STRANGER, 'FARMER')

/**
 * A reviewer who actually holds the identity permissions.
 *
 * P13 made the ADMIN role a door rather than a key. An actor carrying only the role can open the
 * back office and decide nothing, so these tests name the two permissions the KYC workflow needs:
 * `KYC_VIEW` to see a queue and `KYC_REVIEW` to decide a file or decrypt a number.
 */
const admin = (): Actor => ({
  userId: ADMIN,
  roles: ['ADMIN'],
  status: 'ACTIVE',
  permissions: ['KYC_VIEW', 'KYC_REVIEW'],
})

/** The ADMIN role with an empty permission set — admitted to the building, and nothing else. */
const bareAdmin = (): Actor => ({ userId: ADMIN, roles: ['ADMIN'], status: 'ACTIVE' })

const opsAgent = () => actor(ADMIN, 'OPS_AGENT')

function jpeg(bytes = MIN_DOCUMENT_BYTES + 10): Uint8Array {
  const data = new Uint8Array(bytes)
  data.set([0xff, 0xd8, 0xff], 0)
  return data
}

const frontFile = () => ({ side: 'FRONT' as const, contentType: 'image/jpeg', bytes: jpeg() })
const backFile = () => ({ side: 'BACK' as const, contentType: 'image/jpeg', bytes: jpeg() })

const submission = () => ({
  identityType: 'NID',
  identityNumber: NID,
  documentFront: frontFile(),
  documentBack: backFile(),
})

/**
 * A cipher that behaves like the real one where it counts.
 *
 * The binding to a user is real: decrypting against a different id fails, exactly as AES-GCM's
 * additional authenticated data makes it fail. Without that, the test proving a ciphertext cannot
 * be moved between rows would prove nothing.
 */
function fakeCipher(configured = true) {
  return {
    isConfigured: configured,
    encrypt: (plaintext: string, context: { userId: string }) =>
      `v1$${Buffer.from(`${context.userId}:${plaintext}`).toString('base64url')}`,
    decrypt: (stored: string, context: { userId: string }) => {
      const decoded = Buffer.from(stored.replace('v1$', ''), 'base64url').toString('utf8')
      const marker = `${context.userId}:`
      if (!decoded.startsWith(marker)) throw new Error('bad tag')
      return decoded.slice(marker.length)
    },
    blindIndex: (plaintext: string) => `bi:${plaintext}`,
  }
}

interface StoredIdentity {
  readonly ciphertext: string
  readonly ownerUserId: string
  readonly front: string
  readonly back: string | null
}

function harness(options: { readonly cipherConfigured?: boolean } = {}) {
  const audit = vi.fn(async (_line: Record<string, unknown>) => undefined)
  const records = new Map<string, VerificationRecord>()
  const identities = new Map<string, StoredIdentity>()
  const events: VerificationEventRecord[] = []
  const blindIndexOwners = new Map<string, string>()
  const objects = new Map<string, { contentType: string; data: Uint8Array }>()

  let sequence = 0

  const base = (userId: string): VerificationRecord => ({
    id: `ver-${userId}`,
    userId,
    type: 'IDENTITY',
    status: 'PENDING',
    method: 'MANUAL_REVIEW',
    submittedAt: NOW,
    reviewedAt: null,
    reviewerUserId: null,
    rejectionReason: null,
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    identityType: 'NID',
    identityNumberMasked: '••••••7890',
    hasDocumentFront: true,
    hasDocumentBack: true,
  })

  const verifications = {
    listForUser: async (userId: string) =>
      [...records.values()].filter((record) => record.userId === userId),

    // Ownership is in the lookup, exactly as it is in the real query. A fake that ignored the
    // second argument would make the IDOR tests below vacuous.
    findOwned: async (id: string, userId: string) => {
      const found = records.get(id)
      return found !== undefined && found.userId === userId ? found : null
    },

    findById: async (id: string) => records.get(id) ?? null,

    blindIndexBelongsToOther: async (blindIndex: string, userId: string) => {
      const owner = blindIndexOwners.get(blindIndex)
      return owner !== undefined && owner !== userId
    },

    submitIdentity: async (input: SubmitIdentityInput) => {
      const record: VerificationRecord = {
        ...base(input.userId),
        identityType: input.identityType,
        identityNumberMasked: input.identityNumberMasked,
        submittedAt: input.now,
        hasDocumentBack: input.documentBackKey !== null,
      }
      records.set(record.id, record)
      identities.set(record.id, {
        ciphertext: input.identityNumberCiphertext,
        ownerUserId: input.userId,
        front: input.documentFrontKey,
        back: input.documentBackKey,
      })
      blindIndexOwners.set(input.identityNumberBlindIndex, input.userId)
      events.push({
        id: `ev-${String(++sequence)}`,
        verificationId: record.id,
        actorUserId: input.userId,
        action: 'SUBMIT',
        fromStatus: null,
        toStatus: 'PENDING',
        reason: null,
        createdAt: input.now,
      })
      return record
    },

    review: vi.fn(
      async (input: {
        verificationId: string
        reviewerUserId: string
        toStatus: VerificationRecord['status']
        action: string
        reason: string | null
        now: Date
      }) => {
        const current = records.get(input.verificationId)
        if (current === undefined) return null
        const next: VerificationRecord = {
          ...current,
          status: input.toStatus,
          reviewerUserId: input.reviewerUserId,
          reviewedAt: input.now,
          rejectionReason: input.toStatus === 'REJECTED' ? input.reason : null,
        }
        records.set(next.id, next)
        events.push({
          id: `ev-${String(++sequence)}`,
          verificationId: next.id,
          actorUserId: input.reviewerUserId,
          action: input.action,
          fromStatus: current.status,
          toStatus: input.toStatus,
          reason: input.reason,
          createdAt: input.now,
        })
        return next
      },
    ),

    listAwaitingReview: async (limit: number): Promise<readonly PendingQueueEntry[]> =>
      [...records.values()]
        .filter((record) => record.status === 'PENDING' || record.status === 'UNDER_REVIEW')
        .slice(0, limit)
        .map((verification) => ({
          verification,
          subjectName: 'Rahim Uddin',
          subjectPhoneMasked: '+880171****5678',
        })),

    history: async (id: string) => events.filter((event) => event.verificationId === id),

    documentKeys: async (id: string) => {
      const identity = identities.get(id)
      return identity === undefined ? null : { front: identity.front, back: identity.back }
    },

    revealCiphertext: async (id: string) => {
      const identity = identities.get(id)
      return identity === undefined
        ? null
        : { ciphertext: identity.ciphertext, ownerUserId: identity.ownerUserId }
    },
  }

  let uploadCount = 0
  const storage = {
    isAvailable: true,
    providerName: 'test',
    upload: async (input: { folder: string; contentType: string; data: Uint8Array }) => {
      uploadCount += 1
      const storageKey = `${input.folder}/object-${String(uploadCount)}.jpg`
      objects.set(storageKey, { contentType: input.contentType, data: input.data })
      return {
        ok: true as const,
        object: {
          storageKey,
          url: '',
          contentType: input.contentType,
          bytes: input.data.byteLength,
        },
      }
    },
    publicUrl: async () => null,
    download: async (storageKey: string) => objects.get(storageKey) ?? null,
  }

  /** A signer with the real one's binding properties and none of its cryptography. */
  const grants = {
    issue: (
      grant: { storageKey: string; viewerUserId: string; verificationId: string },
      now: Date,
    ) => JSON.stringify({ ...grant, exp: now.getTime() + 600_000 }),
    verify: (token: string, now: Date) => {
      try {
        const parsed = JSON.parse(token) as {
          storageKey: string
          viewerUserId: string
          verificationId: string
          exp: number
        }
        if (parsed.exp <= now.getTime()) return null
        return {
          storageKey: parsed.storageKey,
          viewerUserId: parsed.viewerUserId,
          verificationId: parsed.verificationId,
          expiresAt: new Date(parsed.exp),
        }
      } catch {
        return null
      }
    },
  }

  const deps = {
    clock: { now: () => NOW },
    verifications,
    cipher: fakeCipher(options.cipherConfigured ?? true),
    storage,
    audit: { record: audit },
    grants,
  } as unknown as DocumentDeps & KycDeps

  return {
    deps,
    audit,
    records,
    events,
    identities,
    review: verifications.review,
    uploads: () => uploadCount,
  }
}

let h: ReturnType<typeof harness>
beforeEach(() => {
  h = harness()
})

/* ================================================================ submit */

describe('submitting an identity document', () => {
  it('accepts a valid submission and leaves it PENDING', async () => {
    const result = await submitIdentity(me(), submission(), h.deps)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.value.status).toBe('PENDING')
      // Never VERIFIED, whatever was submitted.
      expect(result.value.status).not.toBe('VERIFIED')
    }
  })

  it('refuses an anonymous submitter', async () => {
    const result = await submitIdentity(ANONYMOUS, submission(), h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('refuses a suspended account', async () => {
    const suspended: Actor = { userId: ME, roles: ['FARMER'], status: 'SUSPENDED' }
    const result = await submitIdentity(suspended, submission(), h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('never returns the number it was given', async () => {
    const result = await submitIdentity(me(), submission(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(JSON.stringify(result.value)).not.toContain(NID)
    expect(result.value.identityNumberMasked).toBe('••••••7890')
  })

  it('never writes the number to the audit log', async () => {
    /*
     * "No raw NID in logs" as an assertion rather than a promise. The audit row carries the mask,
     * which tells two submissions apart without being a disclosure.
     */
    await submitIdentity(me(), submission(), h.deps)
    const written = JSON.stringify(h.audit.mock.calls)
    expect(written).not.toContain(NID)
    expect(written).toContain('••••••7890')
  })

  it('stores the number only as ciphertext', async () => {
    const result = await submitIdentity(me(), submission(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    const stored = h.identities.get(result.value.id)
    expect(stored?.ciphertext).toMatch(/^v1\$/)
    expect(stored?.ciphertext).not.toContain(NID)
  })

  it('refuses to store anything when no encryption key is configured', async () => {
    /*
     * Fail closed. The alternative — storing in clear and encrypting later — is how plaintext
     * identity numbers end up in a database permanently.
     */
    const unconfigured = harness({ cipherConfigured: false })
    const result = await submitIdentity(me(), submission(), unconfigured.deps)

    expect(isErr(result)).toBe(true)
    expect(unconfigured.uploads()).toBe(0)
    expect(unconfigured.records.size).toBe(0)
  })

  it('does not upload anything when the document is rejected', async () => {
    // An endpoint that stores bytes before it validates is a file host with somebody else's bill.
    const result = await submitIdentity(
      me(),
      {
        ...submission(),
        documentFront: { side: 'FRONT', contentType: 'application/zip', bytes: jpeg() },
      },
      h.deps,
    )
    expect(isErr(result)).toBe(true)
    expect(h.uploads()).toBe(0)
  })

  it('does not upload anything when the number is malformed', async () => {
    const result = await submitIdentity(me(), { ...submission(), identityNumber: '12' }, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.uploads()).toBe(0)
  })

  it('puts documents in the private folder', async () => {
    await submitIdentity(me(), submission(), h.deps)
    const stored = [...h.identities.values()][0]
    expect(stored?.front).toMatch(/^kyc-documents\//)
  })

  it('refuses a document already registered to somebody else', async () => {
    // One document verifies one person. Without this the same NID can be submitted on any number
    // of accounts and every one of them can be approved.
    await submitIdentity(me(), submission(), h.deps)
    const result = await submitIdentity(stranger(), submission(), h.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.meta['code']).toBe('IDENTITY_ALREADY_REGISTERED')
  })

  it('does not confirm that a particular number is registered', async () => {
    /*
     * The refusal must not become an oracle for testing whether a given person holds an account.
     * A duplicate and a plain refusal read identically to the caller.
     */
    await submitIdentity(me(), submission(), h.deps)
    const duplicate = await submitIdentity(stranger(), submission(), h.deps)
    if (!isErr(duplicate)) throw new Error('expected refusal')

    expect(duplicate.error.message).not.toContain(NID)
    expect(duplicate.error.message.toLowerCase()).not.toContain('already registered')
  })

  it('records a duplicate refusal, so probing a list of numbers is visible', async () => {
    /*
     * The refusal is inherent to duplicate detection: submitting a number and being told it is
     * unusable reveals that somebody holds it. That cannot be removed without removing the check,
     * so what matters is that a run of these against one account is something an operator can
     * see afterwards.
     */
    await submitIdentity(me(), submission(), h.deps)
    h.audit.mockClear()
    await submitIdentity(stranger(), submission(), h.deps)

    const actions = h.audit.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('KYC_DUPLICATE_DOCUMENT_REFUSED')
  })

  it('does not put the probed number in that audit row', async () => {
    // The probed number may belong to somebody who has no account here at all. Writing it down
    // would put a stranger's identity number in the audit table.
    await submitIdentity(me(), submission(), h.deps)
    h.audit.mockClear()
    await submitIdentity(stranger(), submission(), h.deps)

    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(NID)
  })

  it('lets the same person re-submit their own number', async () => {
    // The duplicate rule is about OTHER users. Somebody correcting their own photograph must not
    // be told their own document belongs to somebody else.
    await submitIdentity(me(), submission(), h.deps)
    await h.deps.verifications.review({
      verificationId: `ver-${ME}`,
      reviewerUserId: ADMIN,
      toStatus: 'REJECTED',
      action: 'REJECT',
      reason: 'blurred',
      now: NOW,
    })

    const again = await submitIdentity(me(), submission(), h.deps)
    expect(isOk(again)).toBe(true)
  })

  it('refuses a second submission while one is still being reviewed', async () => {
    await submitIdentity(me(), submission(), h.deps)
    const again = await submitIdentity(me(), { ...submission(), identityNumber: OTHER_NID }, h.deps)

    expect(isErr(again)).toBe(true)
    if (isErr(again)) expect(again.error.code).toBe('CONFLICT')
  })

  it('refuses a document type that is not accepted yet', async () => {
    const result = await submitIdentity(me(), { ...submission(), identityType: 'PASSPORT' }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.meta['code']).toBe('IDENTITY_TYPE_UNSUPPORTED')
  })
})

/* ================================================================== read */

describe('reading your own verifications', () => {
  it('returns only the caller’s own records', async () => {
    await submitIdentity(me(), submission(), h.deps)
    await submitIdentity(stranger(), { ...submission(), identityNumber: OTHER_NID }, h.deps)

    const mine = await myVerifications(me(), h.deps)
    if (!isOk(mine)) throw new Error('expected ok')

    expect(mine.value).toHaveLength(1)
    expect(mine.value[0]?.id).toBe(`ver-${ME}`)
  })

  it('refuses an anonymous caller', async () => {
    const result = await myVerifications(ANONYMOUS, h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('takes no user id, so there is no argument to point at somebody else', () => {
    // The guarantee is structural rather than a check. Stated as a test so a future signature
    // change that adds a subject parameter has to break something.
    expect(myVerifications).toHaveLength(2)
  })

  it('shows a rejection reason only while the record is rejected', async () => {
    await submitIdentity(me(), submission(), h.deps)
    await reviewVerification(
      admin(),
      `ver-${ME}`,
      { action: 'REJECT', reason: 'Too blurred' },
      h.deps,
    )

    const rejected = await myVerifications(me(), h.deps)
    if (!isOk(rejected)) throw new Error('expected ok')
    expect(rejected.value[0]?.rejectionReason).toBe('Too blurred')
    expect(rejected.value[0]?.status).toBe('REJECTED')

    // Re-submitting clears it: the old refusal beside an unjudged file reads as a fresh failure.
    await submitIdentity(me(), submission(), h.deps)
    const pending = await myVerifications(me(), h.deps)
    if (!isOk(pending)) throw new Error('expected ok')
    expect(pending.value[0]?.rejectionReason).toBeNull()
  })
})

/* ============================================================ the queue */

describe('the reviewer queue', () => {
  it('is reachable by an administrator', async () => {
    await submitIdentity(me(), submission(), h.deps)
    const result = await listPendingReviews(admin(), h.deps)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value).toHaveLength(1)
  })

  it('refuses an anonymous caller', async () => {
    expect(isErr(await listPendingReviews(ANONYMOUS, h.deps))).toBe(true)
  })

  it('refuses an ordinary user', async () => {
    await submitIdentity(me(), submission(), h.deps)
    const result = await listPendingReviews(me(), h.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses a field agent', async () => {
    /*
     * OPS_AGENT is trusted with a great deal, and deliberately not with this. A field agent helps
     * a farmer submit; approving the document you helped gather is one person on both sides of
     * the check, which is the shape of every KYC fraud that has ever been written up.
     */
    const result = await listPendingReviews(opsAgent(), h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses an administrator who holds the role and not the permission', async () => {
    /*
     * The P13 tightening, applied to the queue somebody's national identity documents sit in. The
     * role admits an operator to the back office; seeing this list is a separate grant.
     */
    await submitIdentity(me(), submission(), h.deps)
    const result = await listPendingReviews(bareAdmin(), h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('never carries an identity number', async () => {
    await submitIdentity(me(), submission(), h.deps)
    const result = await listPendingReviews(admin(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(JSON.stringify(result.value)).not.toContain(NID)
  })
})

/* ============================================================== review */

describe('deciding a file', () => {
  beforeEach(async () => {
    await submitIdentity(me(), submission(), h.deps)
  })

  it('lets an administrator approve', async () => {
    const result = await reviewVerification(admin(), `ver-${ME}`, { action: 'APPROVE' }, h.deps)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.status).toBe('VERIFIED')
  })

  it('refuses an anonymous reviewer', async () => {
    const result = await reviewVerification(ANONYMOUS, `ver-${ME}`, { action: 'APPROVE' }, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.review).not.toHaveBeenCalled()
  })

  it('refuses the subject approving their own file', async () => {
    // The attack this whole phase exists to prevent, attempted directly.
    const result = await reviewVerification(me(), `ver-${ME}`, { action: 'APPROVE' }, h.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
    expect(h.review).not.toHaveBeenCalled()
  })

  it('refuses a stranger approving somebody else’s file', async () => {
    const result = await reviewVerification(stranger(), `ver-${ME}`, { action: 'APPROVE' }, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.review).not.toHaveBeenCalled()
  })

  it('refuses a field agent', async () => {
    const result = await reviewVerification(opsAgent(), `ver-${ME}`, { action: 'APPROVE' }, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.review).not.toHaveBeenCalled()
  })

  it('refuses an administrator deciding their OWN file', async () => {
    /*
     * The case that gets forgotten. An administrator is also a user and can hold an identity
     * record like anybody else; a self-approval is trivially obtainable and invisible afterwards.
     */
    await submitIdentity(
      actor(ADMIN, 'ADMIN'),
      { ...submission(), identityNumber: OTHER_NID },
      h.deps,
    )
    const result = await reviewVerification(admin(), `ver-${ADMIN}`, { action: 'APPROVE' }, h.deps)

    expect(isErr(result)).toBe(true)
    expect(h.review).not.toHaveBeenCalled()
  })

  it('records the refusal when somebody tries to decide their own file', async () => {
    await submitIdentity(
      actor(ADMIN, 'ADMIN'),
      { ...submission(), identityNumber: OTHER_NID },
      h.deps,
    )
    await reviewVerification(admin(), `ver-${ADMIN}`, { action: 'APPROVE' }, h.deps)

    const actions = h.audit.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('KYC_SELF_REVIEW_REFUSED')
  })

  it('refuses a rejection with no reason', async () => {
    const result = await reviewVerification(admin(), `ver-${ME}`, { action: 'REJECT' }, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.review).not.toHaveBeenCalled()
  })

  it('records a rejection with its reason', async () => {
    const result = await reviewVerification(
      admin(),
      `ver-${ME}`,
      { action: 'REJECT', reason: 'The back of the card is unreadable' },
      h.deps,
    )
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.status).toBe('REJECTED')
  })

  it('says not found for a record that does not exist', async () => {
    const result = await reviewVerification(admin(), 'ver-nobody', { action: 'APPROVE' }, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('never writes an identity number to the audit log', async () => {
    await reviewVerification(admin(), `ver-${ME}`, { action: 'APPROVE' }, h.deps)
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(NID)
  })
})

/* ============================================================= history */

describe('verification history', () => {
  beforeEach(async () => {
    await submitIdentity(me(), submission(), h.deps)
    await reviewVerification(admin(), `ver-${ME}`, { action: 'REJECT', reason: 'Blurred' }, h.deps)
  })

  it('is readable by the subject', async () => {
    const result = await verificationHistory(me(), `ver-${ME}`, h.deps)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value).toHaveLength(2)
  })

  it('is readable by an administrator', async () => {
    expect(isOk(await verificationHistory(admin(), `ver-${ME}`, h.deps))).toBe(true)
  })

  it('is not readable by a stranger', async () => {
    const result = await verificationHistory(stranger(), `ver-${ME}`, h.deps)
    expect(isErr(result)).toBe(true)
    // NOT_FOUND rather than FORBIDDEN: the id itself must disclose nothing by the shape of its
    // refusal.
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('is not readable anonymously', async () => {
    expect(isErr(await verificationHistory(ANONYMOUS, `ver-${ME}`, h.deps))).toBe(true)
  })

  it('hides who decided from the subject', async () => {
    /*
     * A farmer who disagrees with a decision should take it up with Langgol, not with the
     * individual who made it.
     */
    const mine = await verificationHistory(me(), `ver-${ME}`, h.deps)
    if (!isOk(mine)) throw new Error('expected ok')
    expect(mine.value.every((line) => line.actorUserId === null)).toBe(true)
  })

  it('shows who decided to an administrator', async () => {
    const theirs = await verificationHistory(admin(), `ver-${ME}`, h.deps)
    if (!isOk(theirs)) throw new Error('expected ok')
    expect(theirs.value.some((line) => line.actorUserId === ADMIN)).toBe(true)
  })
})

/* =========================================================== documents */

describe('reaching a document', () => {
  beforeEach(async () => {
    await submitIdentity(me(), submission(), h.deps)
  })

  it('lets the owner see their own', async () => {
    const grant = await issueDocumentGrant(me(), `ver-${ME}`, 'FRONT', h.deps)
    expect(isOk(grant)).toBe(true)
  })

  it('lets an administrator see it', async () => {
    expect(isOk(await issueDocumentGrant(admin(), `ver-${ME}`, 'FRONT', h.deps))).toBe(true)
  })

  it('refuses a stranger', async () => {
    const result = await issueDocumentGrant(stranger(), `ver-${ME}`, 'FRONT', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_FOUND')
  })

  it('refuses an anonymous caller', async () => {
    expect(isErr(await issueDocumentGrant(ANONYMOUS, `ver-${ME}`, 'FRONT', h.deps))).toBe(true)
  })

  it('refuses a field agent', async () => {
    const result = await issueDocumentGrant(opsAgent(), `ver-${ME}`, 'FRONT', h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('serves the bytes to the person the grant names', async () => {
    const grant = await issueDocumentGrant(me(), `ver-${ME}`, 'FRONT', h.deps)
    if (!isOk(grant)) throw new Error('expected ok')

    const served = await serveDocument(me(), grant.value.token, h.deps)
    expect(isOk(served)).toBe(true)
    if (isOk(served)) expect(served.value.data.byteLength).toBeGreaterThan(0)
  })

  it('refuses a grant presented by somebody else', async () => {
    /*
     * The property a bare expiring URL does not have. A link copied out of a reviewer's browser
     * is inert in anybody else's hands.
     */
    const grant = await issueDocumentGrant(admin(), `ver-${ME}`, 'FRONT', h.deps)
    if (!isOk(grant)) throw new Error('expected ok')

    const stolen = await serveDocument(stranger(), grant.value.token, h.deps)
    expect(isErr(stolen)).toBe(true)
    if (isErr(stolen)) expect(stolen.error.code).toBe('NOT_FOUND')
  })

  it('records an attempt to use somebody else’s grant', async () => {
    const grant = await issueDocumentGrant(admin(), `ver-${ME}`, 'FRONT', h.deps)
    if (!isOk(grant)) throw new Error('expected ok')
    await serveDocument(stranger(), grant.value.token, h.deps)

    const actions = h.audit.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('KYC_DOCUMENT_GRANT_MISUSED')
  })

  it('refuses a forged grant', async () => {
    expect(isErr(await serveDocument(admin(), 'not-a-real-token', h.deps))).toBe(true)
  })

  it('refuses an expired grant', async () => {
    const grant = await issueDocumentGrant(admin(), `ver-${ME}`, 'FRONT', h.deps)
    if (!isOk(grant)) throw new Error('expected ok')

    // Redeemed an hour later, past the ten-minute life the signer gives a grant.
    const expiredDeps = {
      ...h.deps,
      clock: { now: () => new Date(NOW.getTime() + 3_600_000) },
    } as unknown as DocumentDeps

    expect(isErr(await serveDocument(admin(), grant.value.token, expiredDeps))).toBe(true)
  })

  it('records every document that is actually viewed', async () => {
    const grant = await issueDocumentGrant(admin(), `ver-${ME}`, 'FRONT', h.deps)
    if (!isOk(grant)) throw new Error('expected ok')
    await serveDocument(admin(), grant.value.token, h.deps)

    const actions = h.audit.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('KYC_DOCUMENT_VIEWED')
  })

  it('never writes a storage key into the audit log', async () => {
    // A durable pointer at the object, in a table with a wider audience than the one holding it.
    await issueDocumentGrant(admin(), `ver-${ME}`, 'FRONT', h.deps)
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain('kyc-documents/')
  })
})

/* ============================================================== reveal */

describe('revealing the number itself', () => {
  beforeEach(async () => {
    await submitIdentity(me(), submission(), h.deps)
  })

  it('gives an administrator the number when they say why', async () => {
    const result = await revealIdentityNumber(
      admin(),
      `ver-${ME}`,
      'Checking against the card',
      h.deps,
    )
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.identityNumber).toBe(NID)
  })

  it('refuses the owner', async () => {
    /*
     * Deliberate, and worth stating. A person does not need Langgol to tell them their own NID —
     * they are holding the card. Allowing it would add a decryption path reachable with an
     * ordinary session, which is the widest attack surface this function could have.
     */
    const result = await revealIdentityNumber(me(), `ver-${ME}`, 'Curious about my own', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses a stranger', async () => {
    const result = await revealIdentityNumber(stranger(), `ver-${ME}`, 'Just looking', h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('refuses an anonymous caller', async () => {
    expect(isErr(await revealIdentityNumber(ANONYMOUS, `ver-${ME}`, 'Reason here', h.deps))).toBe(
      true,
    )
  })

  it('refuses a field agent', async () => {
    const result = await revealIdentityNumber(opsAgent(), `ver-${ME}`, 'Reason here', h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('refuses an administrator who holds the role and not the permission', async () => {
    /*
     * The highest-value capability in the system, and the clearest case for P13 existing. Before
     * the permission layer, every administrator could decrypt every national identity number on
     * the platform. Now it takes KYC_REVIEW, granted deliberately and by somebody else.
     */
    const result = await revealIdentityNumber(
      bareAdmin(),
      `ver-${ME}`,
      'Checking against the card',
      h.deps,
    )
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
  })

  it('refuses an administrator who can see the queue but may not decide', async () => {
    // KYC_VIEW is for the person working through a list; KYC_REVIEW is for the person deciding.
    // The second carries decryption and the first must not imply it.
    const viewer: Actor = {
      userId: ADMIN,
      roles: ['ADMIN'],
      status: 'ACTIVE',
      permissions: ['KYC_VIEW'],
    }
    const result = await revealIdentityNumber(viewer, `ver-${ME}`, 'Just looking', h.deps)
    expect(isErr(result)).toBe(true)
  })

  it('refuses without a reason', async () => {
    const result = await revealIdentityNumber(admin(), `ver-${ME}`, '  ', h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION_FAILED')
  })

  it('audits before it decrypts, so an interrupted read is still recorded', async () => {
    await revealIdentityNumber(admin(), `ver-${ME}`, 'Checking against the card', h.deps)
    const actions = h.audit.mock.calls.map((call) => (call[0] as { action: string }).action)
    expect(actions).toContain('KYC_IDENTITY_NUMBER_REVEALED')
  })

  it('records the reason the reader gave', async () => {
    await revealIdentityNumber(admin(), `ver-${ME}`, 'Comparing with the submitted photo', h.deps)
    const reasons = h.audit.mock.calls.map((call) => (call[0] as { reason?: string }).reason)
    expect(reasons).toContain('Comparing with the submitted photo')
  })

  it('never writes the revealed number to the audit log', async () => {
    // The one function that returns a number must still not record one.
    await revealIdentityNumber(admin(), `ver-${ME}`, 'Checking against the card', h.deps)
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain(NID)
  })

  it('cannot decrypt a ciphertext that belongs to another row', async () => {
    /*
     * The ciphertext is bound to its owner. This proves the binding is load-bearing rather than
     * decorative: swapping one row's ciphertext into another's makes it unreadable instead of
     * moving an identity between accounts.
     */
    await submitIdentity(stranger(), { ...submission(), identityNumber: OTHER_NID }, h.deps)

    const mine = h.identities.get(`ver-${ME}`)
    const theirs = h.identities.get(`ver-${STRANGER}`)
    if (mine === undefined || theirs === undefined) throw new Error('fixture')

    h.identities.set(`ver-${STRANGER}`, { ...theirs, ciphertext: mine.ciphertext })

    const result = await revealIdentityNumber(
      admin(),
      `ver-${STRANGER}`,
      'Checking the card',
      h.deps,
    )
    expect(isErr(result)).toBe(true)
  })
})
