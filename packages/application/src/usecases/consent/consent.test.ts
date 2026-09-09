/**
 * Consent use-case tests.
 *
 * The fake store reproduces the real adapter's semantics — append-only, one live decision per
 * type, superseding rather than editing — because a permissive fake would let the history and
 * bundling assertions pass while the properties they name went unenforced.
 *
 * Refs: docs/07_SECURITY.md §9.2, §9.4, §10
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createConfigSnapshot, type ConfigSnapshot } from '@langgol/domain/config'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import { CONSENT_TYPES, OPTIONAL_CONSENTS } from '@langgol/domain/consent'
import type {
  AuditPort,
  Clock,
  ConsentDecisionInput,
  ConsentRecordRow,
  ConsentRepository,
} from '../../ports/index.js'
import {
  acceptRequiredConsents,
  getMyConsentHistory,
  getMyConsents,
  readConsentFor,
  recordConsentDecisions,
} from './consent.js'

const USER = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-08-22T09:00:00.000Z')

function actor(overrides: Partial<Actor> = {}): Actor {
  return { userId: USER, roles: ['FARMER'], status: 'ACTIVE', ...overrides }
}

// Reading somebody else's consent record is under USER_VIEW since P13: the role admits an
// operator to the back office and grants nothing inside it.
const admin = actor({ userId: STRANGER, roles: ['ADMIN'], permissions: ['USER_VIEW'] })

/* ------------------------------------------------------------------- doubles */

type MutableRow = { -readonly [K in keyof ConsentRecordRow]: ConsentRecordRow[K] } & {
  ipAddress: string | null
  userAgent: string | null
}

class FakeConsents implements ConsentRepository {
  rows: MutableRow[] = []
  private nextId = 1

  private live(userId: string): MutableRow[] {
    return this.rows.filter((r) => r.userId === userId && r.revokedAt === null)
  }

  listLiveForUser(userId: string): Promise<readonly ConsentRecordRow[]> {
    return Promise.resolve(this.live(userId))
  }

  listHistoryForUser(userId: string): Promise<readonly ConsentRecordRow[]> {
    // Superseded rows included — keeping them is why the table is append-only.
    return Promise.resolve([...this.rows.filter((r) => r.userId === userId)].reverse())
  }

  supersede(input: ConsentDecisionInput): Promise<ConsentRecordRow> {
    // End the live row rather than editing it, exactly as the SQL does.
    for (const row of this.live(input.userId)) {
      if (row.consentType === input.consentType) row.revokedAt = input.at
    }
    const row: MutableRow = {
      id: `consent-${String(this.nextId++)}`,
      userId: input.userId,
      consentType: input.consentType,
      granted: input.granted,
      version: input.version,
      grantedAt: input.at,
      revokedAt: null,
      source: input.source,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    }
    this.rows.push(row)
    return Promise.resolve(row)
  }

  async supersedeMany(
    inputs: readonly ConsentDecisionInput[],
  ): Promise<readonly ConsentRecordRow[]> {
    const written: ConsentRecordRow[] = []
    for (const input of inputs) written.push(await this.supersede(input))
    return written
  }
}

class FakeAudit implements AuditPort {
  entries: { action: string; entityId: string; meta?: Record<string, unknown> }[] = []
  record(input: Parameters<AuditPort['record']>[0]): Promise<void> {
    this.entries.push({
      action: input.action,
      entityId: input.entityId,
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    })
    return Promise.resolve()
  }
  actions(): string[] {
    return this.entries.map((e) => e.action)
  }
}

const V1 = {
  TERMS_OF_SERVICE: 1,
  PRIVACY_POLICY: 1,
  LOCATION: 1,
  FARM_DATA: 1,
  FINANCIAL_DATA: 1,
  MARKETING: 1,
  PERSONALIZATION: 1,
  AI_DATA_PROCESSING: 1,
  TRANSACTION_DATA: 1,
}

function configWith(versions: Record<string, number>): ConfigSnapshot {
  return createConfigSnapshot(
    [{ key: 'consent.versions', version: 1, value: versions }],
    new Date(),
  )
}

function harness(versions = V1) {
  const consents = new FakeConsents()
  const audit = new FakeAudit()
  const clock: Clock = { now: () => NOW }
  return {
    consents,
    audit,
    deps: { config: configWith(versions), clock, consents, audit },
  }
}

const FROM = { source: 'ACCOUNT_SETTINGS', ipAddress: '203.0.113.7', userAgent: 'test' }

/* ---------------------------------------------------- never silently enabled */

describe('a new account has agreed to nothing', () => {
  it('reports every permission refused', async () => {
    const h = harness()
    const result = await getMyConsents(actor(), 'en', h.deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.consents).toHaveLength(CONSENT_TYPES.length)
    expect(result.value.consents.every((c) => !c.granted)).toBe(true)
  })

  it('reports the required consents as outstanding', async () => {
    const h = harness()
    const result = await getMyConsents(actor(), 'en', h.deps)
    if (!result.ok) return

    expect(result.value.satisfied).toBe(false)
    expect([...result.value.outstandingRequired]).toEqual(['TERMS_OF_SERVICE', 'PRIVACY_POLICY'])
  })

  it('writes nothing to the store just by being read', async () => {
    // Reading consent must never create a record — that would be consent by inspection.
    const h = harness()
    await getMyConsents(actor(), 'en', h.deps)
    expect(h.consents.rows).toHaveLength(0)
  })
})

/* ------------------------------------------------------------ not bundled */

describe('optional consent is never bundled', () => {
  let h: ReturnType<typeof harness>
  beforeEach(() => {
    h = harness()
  })

  it('records each answer as its own decision', async () => {
    const result = await recordConsentDecisions(
      actor(),
      {
        ...FROM,
        answers: [
          { type: 'MARKETING', granted: true },
          { type: 'LOCATION', granted: false },
          { type: 'FARM_DATA', granted: true },
        ],
      },
      h.deps,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.recorded).toBe(3)
    expect(h.consents.rows).toHaveLength(3)
  })

  it('honours a mixed answer rather than collapsing it to one', async () => {
    /*
     * The shape of the bug this prevents: a screen posting "agreed" and the server granting
     * everything. Here the refusal has to survive alongside the grants.
     */
    await recordConsentDecisions(
      actor(),
      {
        ...FROM,
        answers: [
          { type: 'MARKETING', granted: true },
          { type: 'LOCATION', granted: false },
        ],
      },
      h.deps,
    )

    const result = await getMyConsents(actor(), 'en', h.deps)
    if (!result.ok) return
    expect(result.value.consents.find((c) => c.type === 'MARKETING')?.granted).toBe(true)
    expect(result.value.consents.find((c) => c.type === 'LOCATION')?.granted).toBe(false)
  })

  it('leaves permissions the caller did not mention untouched', async () => {
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )

    const result = await getMyConsents(actor(), 'en', h.deps)
    if (!result.ok) return
    // One decision recorded; eight permissions still undecided and therefore refused.
    expect(result.value.consents.filter((c) => c.decidedAt !== null)).toHaveLength(1)
    expect(result.value.consents.filter((c) => c.granted)).toHaveLength(1)
  })

  it('audits one entry per decision, naming the permission and version', async () => {
    // "They changed their preferences" is not a fact anyone can act on later.
    await recordConsentDecisions(
      actor(),
      {
        ...FROM,
        answers: [
          { type: 'MARKETING', granted: true },
          { type: 'LOCATION', granted: false },
        ],
      },
      h.deps,
    )

    expect(h.audit.entries).toHaveLength(2)
    expect(h.audit.actions()).toEqual(['CONSENT_GRANTED', 'CONSENT_REVOKED'])
    expect(h.audit.entries[0]?.entityId).toBe('MARKETING')
    expect(h.audit.entries[0]?.meta?.['version']).toBe(1)
  })

  it('accepts an empty submission without inventing decisions', async () => {
    const result = await recordConsentDecisions(actor(), { ...FROM, answers: [] }, h.deps)
    expect(result.ok).toBe(true)
    expect(h.consents.rows).toHaveLength(0)
  })
})

/* ------------------------------------------------------- required is separate */

describe('required consent is not a preference', () => {
  it('refuses to withdraw the terms through the settings surface', async () => {
    const h = harness()
    const result = await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'TERMS_OF_SERVICE', granted: false }] },
      h.deps,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('VALIDATION_FAILED')
    expect(h.consents.rows).toHaveLength(0)
  })

  it('refuses to GRANT it there either — that belongs where the text is shown', async () => {
    const h = harness()
    const result = await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'PRIVACY_POLICY', granted: true }] },
      h.deps,
    )
    expect(result.ok).toBe(false)
  })

  it('refuses the whole submission rather than silently dropping the required one', async () => {
    // Quietly ignoring it would save the optional answers and hide the caller's misunderstanding.
    const h = harness()
    const result = await recordConsentDecisions(
      actor(),
      {
        ...FROM,
        answers: [
          { type: 'MARKETING', granted: true },
          { type: 'TERMS_OF_SERVICE', granted: false },
        ],
      },
      h.deps,
    )

    expect(result.ok).toBe(false)
    expect(h.consents.rows).toHaveLength(0)
  })

  it('accepts both required consents through the signup route, individually', async () => {
    const h = harness()
    const result = await acceptRequiredConsents(
      actor(),
      { source: 'SIGNUP', ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect([...result.value.accepted]).toEqual(['TERMS_OF_SERVICE', 'PRIVACY_POLICY'])
    // Two rows, not one combined acceptance: which document, and when, stays answerable.
    expect(h.consents.rows).toHaveLength(2)
  })

  it('has no shape that means "the user declined the terms"', async () => {
    /*
     * Structural: `acceptRequiredConsents` takes no boolean. Declining is not a state the
     * platform can hold — it is not creating the account — so there is no parameter for it.
     */
    const h = harness()
    await acceptRequiredConsents(
      actor(),
      { source: 'SIGNUP', ipAddress: null, userAgent: null },
      h.deps,
    )
    expect(h.consents.rows.every((r) => r.granted)).toBe(true)
  })

  it('does not re-record an acceptance that is already current', async () => {
    const h = harness()
    await acceptRequiredConsents(
      actor(),
      { source: 'SIGNUP', ipAddress: null, userAgent: null },
      h.deps,
    )
    const again = await acceptRequiredConsents(
      actor(),
      { source: 'SIGNUP', ipAddress: null, userAgent: null },
      h.deps,
    )

    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.accepted).toEqual([])
    // A row that says nothing new makes the history harder to read.
    expect(h.consents.rows).toHaveLength(2)
  })

  it('asks again when a document version is raised', async () => {
    const h = harness()
    await acceptRequiredConsents(
      actor(),
      { source: 'SIGNUP', ipAddress: null, userAgent: null },
      h.deps,
    )

    const bumped = {
      consents: h.consents,
      audit: h.audit,
      clock: h.deps.clock,
      config: configWith({ ...V1, PRIVACY_POLICY: 2 }),
    }

    const status = await getMyConsents(actor(), 'en', bumped)
    if (!status.ok) return
    expect([...status.value.outstandingRequired]).toEqual(['PRIVACY_POLICY'])
    expect(status.value.satisfied).toBe(false)
  })
})

/* ----------------------------------------------------------------- revoking */

describe('optional consent can be withdrawn', () => {
  it('flips a grant to a refusal', async () => {
    const h = harness()
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: false }] },
      h.deps,
    )

    const result = await getMyConsents(actor(), 'en', h.deps)
    if (!result.ok) return
    expect(result.value.consents.find((c) => c.type === 'MARKETING')?.granted).toBe(false)
  })

  it('supersedes rather than edits, so the earlier grant survives', async () => {
    const h = harness()
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: false }] },
      h.deps,
    )

    expect(h.consents.rows).toHaveLength(2)
    expect(h.consents.rows[0]?.granted).toBe(true)
    expect(h.consents.rows[0]?.revokedAt).not.toBeNull()
    expect(h.consents.rows[1]?.granted).toBe(false)
    expect(h.consents.rows[1]?.revokedAt).toBeNull()
  })

  it('leaves exactly one live decision per permission', async () => {
    const h = harness()
    for (const granted of [true, false, true]) {
      await recordConsentDecisions(
        actor(),
        { ...FROM, answers: [{ type: 'LOCATION', granted }] },
        h.deps,
      )
    }
    const live = h.consents.rows.filter((r) => r.revokedAt === null)
    expect(live).toHaveLength(1)
    expect(live[0]?.granted).toBe(true)
  })

  it('every optional permission is revocable, and no required one is', async () => {
    const h = harness()
    const result = await getMyConsents(actor(), 'en', h.deps)
    if (!result.ok) return

    for (const view of result.value.consents) {
      expect(view.revocable).toBe(!view.required)
    }
    expect(result.value.consents.filter((c) => c.revocable)).toHaveLength(OPTIONAL_CONSENTS.length)
  })
})

/* ------------------------------------------------------------------ history */

describe('history is kept', () => {
  it('returns every decision ever made, newest first', async () => {
    const h = harness()
    for (const granted of [true, false, true]) {
      await recordConsentDecisions(
        actor(),
        { ...FROM, answers: [{ type: 'MARKETING', granted }] },
        h.deps,
      )
    }

    const result = await getMyConsentHistory(actor(), h.deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(3)
    expect(result.value.map((e) => e.granted)).toEqual([true, false, true])
  })

  it('records which version each decision answered', async () => {
    const h = harness()
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )

    const result = await getMyConsentHistory(actor(), h.deps)
    if (!result.ok) return
    expect(result.value[0]?.version).toBe(1)
    expect(result.value[0]?.source).toBe('ACCOUNT_SETTINGS')
  })

  it('never returns the IP address or user agent', async () => {
    /*
     * They are stored so an agreement can be evidenced if challenged, not so a screen can show
     * them back. "Never expose unnecessary metadata."
     */
    const h = harness()
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )

    const result = await getMyConsentHistory(actor(), h.deps)
    if (!result.ok) return
    const serialised = JSON.stringify(result.value)
    expect(serialised).not.toContain('203.0.113.7')
    expect(serialised).not.toContain('test')
    // But it IS stored.
    expect(h.consents.rows[0]?.ipAddress).toBe('203.0.113.7')
  })
})

/* ----------------------------------------------------------------- security */

describe('only the subject decides', () => {
  it('refuses an anonymous caller everywhere', async () => {
    const h = harness()
    expect((await getMyConsents(ANONYMOUS, 'en', h.deps)).ok).toBe(false)
    expect((await getMyConsentHistory(ANONYMOUS, h.deps)).ok).toBe(false)
    expect((await recordConsentDecisions(ANONYMOUS, { ...FROM, answers: [] }, h.deps)).ok).toBe(
      false,
    )
    expect(
      (
        await acceptRequiredConsents(
          ANONYMOUS,
          { source: 'SIGNUP', ipAddress: null, userAgent: null },
          h.deps,
        )
      ).ok,
    ).toBe(false)
  })

  it('refuses a suspended account', async () => {
    const h = harness()
    const result = await recordConsentDecisions(
      actor({ status: 'SUSPENDED' }),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )
    expect(result.ok).toBe(false)
    expect(h.consents.rows).toHaveLength(0)
  })

  it('gives an administrator no way to decide for someone else', async () => {
    /*
     * Structural, and the most important assertion here. Neither writing function takes a subject
     * id — the subject is always the actor — so an admin calling them can only change their OWN
     * consent. There is no `consent:decide-any` in the policy vocabulary for one to exist against.
     */
    expect(recordConsentDecisions.length).toBe(3)
    expect(acceptRequiredConsents.length).toBe(3)

    const h = harness()
    await recordConsentDecisions(
      admin,
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )

    // The admin changed their own consent, and the target user's is untouched.
    expect(h.consents.rows.every((r) => r.userId === STRANGER)).toBe(true)
    const victim = await getMyConsents(actor(), 'en', h.deps)
    if (!victim.ok) return
    expect(victim.value.consents.every((c) => !c.granted)).toBe(true)
  })

  it('lets an administrator READ another user’s consent, and audits that they did', async () => {
    // A data-subject request has to be answerable, and looking is itself worth recording.
    const h = harness()
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )
    h.audit.entries.length = 0

    const result = await readConsentFor(admin, USER, 'en', h.deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.consents.find((c) => c.type === 'MARKETING')?.granted).toBe(true)
    expect(h.audit.actions()).toContain('CONSENT_VIEWED_BY_ADMIN')
  })

  it('refuses a non-administrator reading someone else’s consent', async () => {
    const h = harness()
    const result = await readConsentFor(actor(), STRANGER, 'en', h.deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('FORBIDDEN')
  })

  it('does not let an admin read exposing more than the subject sees', async () => {
    const h = harness()
    await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'MARKETING', granted: true }] },
      h.deps,
    )

    const asAdmin = await readConsentFor(admin, USER, 'en', h.deps)
    if (!asAdmin.ok) return
    expect(JSON.stringify(asAdmin.value)).not.toContain('203.0.113.7')
  })
})

describe('rejects nonsense input', () => {
  it('refuses a permission that does not exist', async () => {
    const h = harness()
    const result = await recordConsentDecisions(
      actor(),
      { ...FROM, answers: [{ type: 'SELL_MY_DATA', granted: true }] },
      h.deps,
    )
    expect(result.ok).toBe(false)
    expect(h.consents.rows).toHaveLength(0)
  })

  it('refuses a source the platform does not define — including an admin console', async () => {
    const h = harness()
    for (const source of ['ADMIN', 'BACKFILL', '']) {
      const result = await recordConsentDecisions(
        actor(),
        { ...FROM, source, answers: [{ type: 'MARKETING', granted: true }] },
        h.deps,
      )
      expect(result.ok).toBe(false)
    }
    expect(h.consents.rows).toHaveLength(0)
  })
})
