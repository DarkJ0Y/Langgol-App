/**
 * Crop diagnosis use-case tests.
 *
 * The assertions that earn their place here are about ORDER and REFUSAL, not about the happy
 * path. Every check before the provider call is free; the provider call costs money and sends a
 * farmer's photograph out of the country. So the tests below mostly prove that the expensive step
 * did NOT happen — `expect(provider).not.toHaveBeenCalled()` is the point of the file.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor } from '@langgol/domain/policy'
import { Money } from '@langgol/domain/money'
import { EMPTY_FARMING_FIELDS } from '@langgol/domain/farming'
import { MAX_IMAGE_BYTES } from '@langgol/domain/advisory'
import { isErr, isOk } from '@langgol/shared'
import { diagnoseCropDisease, type DiagnoseDeps } from './diagnose.js'

const USER = 'f0000000-0000-4000-8000-000000000001'
const farmer: Actor = { userId: USER, roles: ['FARMER'], status: 'ACTIVE' }
const consumer: Actor = { userId: USER, roles: ['CONSUMER'], status: 'ACTIVE' }
const NOW = new Date('2026-08-28T10:00:00.000Z')

const image = (bytes = 1000) => new Uint8Array(bytes)
const command = { image: image(), contentType: 'image/jpeg', locale: 'bn' as const }

/** A live AI consent, granted at the current version. */
const granted = (over: Record<string, unknown> = {}) => [
  {
    id: 'c1',
    userId: USER,
    consentType: 'AI_DATA_PROCESSING' as const,
    granted: true,
    version: 1,
    grantedAt: new Date('2026-08-01T00:00:00.000Z'),
    revokedAt: null,
    source: 'ACCOUNT_SETTINGS' as const,
    ...over,
  },
]

interface Harness {
  readonly deps: DiagnoseDeps
  readonly provider: ReturnType<typeof vi.fn>
  readonly record: ReturnType<typeof vi.fn>
  readonly audit: ReturnType<typeof vi.fn>
}

function harness(
  over: {
    consents?: unknown[]
    servedToday?: number
    servedForUser?: number
    available?: boolean
    answer?: unknown
    currentVersion?: number
  } = {},
): Harness {
  const provider = vi.fn(
    async () =>
      over.answer ?? {
        ok: true,
        diagnosis: {
          answer: 'রোগ নির্ণয়: পাতা ঝলসানো',
          confidence: 'MEDIUM',
          unusableImage: false,
        },
      },
  )
  const record = vi.fn(async () => ({ id: 'd1' }))
  const audit = vi.fn(async () => undefined)

  return {
    provider,
    record,
    audit,
    deps: {
      clock: { now: () => NOW },
      advisory: {
        isAvailable: over.available ?? true,
        providerName: 'test',
        unitCost: Money.fromPoisha(300),
        diagnose: provider,
      },
      consents: { listLiveForUser: async () => over.consents ?? granted() },
      farmers: { findByUserId: async () => ({ ...EMPTY_FARMING_FIELDS, farmerType: 'VEGETABLE' }) },
      diagnoses: {
        record,
        countSince: async () => over.servedToday ?? 0,
        countForUserSince: async () => over.servedForUser ?? 0,
      },
      audit: { record: audit },
      consentVersions: { AI_DATA_PROCESSING: over.currentVersion ?? 1 },
      limits: { dailyBudget: Money.fromPoisha(3000), perUserDailyLimit: 5 },
    } as unknown as DiagnoseDeps,
  }
}

let h: Harness
beforeEach(() => {
  h = harness()
})

describe('a farmer who agreed', () => {
  it('gets a diagnosis', async () => {
    const result = await diagnoseCropDisease(farmer, command, h.deps)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.diagnosis.answer).toContain('রোগ নির্ণয়')
  })

  it('always gets the disclaimer with it', async () => {
    // Attached by the domain, so no screen can render an answer without it.
    const result = await diagnoseCropDisease(farmer, command, h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.disclaimer).toContain('ভুল হতে পারে')
  })

  it('has their profile passed to the model as context', async () => {
    // The highest-value thing this port adds over the prototype.
    await diagnoseCropDisease(farmer, command, h.deps)
    expect(h.provider.mock.calls[0]?.[0].systemPrompt).toContain('VEGETABLE')
  })

  it('has the answer stored but never the photograph', async () => {
    await diagnoseCropDisease(farmer, command, h.deps)
    const stored = h.record.mock.calls[0]?.[0]

    expect(stored.answer).toContain('রোগ নির্ণয়')
    // The record must carry nothing that could reconstruct the image.
    expect(Object.keys(stored)).not.toContain('image')
    expect(Object.keys(stored)).not.toContain('storageKey')
    expect(Object.keys(stored)).not.toContain('imageUrl')
  })

  it('records the prompt version, so an old answer can be explained', async () => {
    await diagnoseCropDisease(farmer, command, h.deps)
    expect(h.record.mock.calls[0]?.[0].promptVersion).toBeGreaterThan(0)
  })
})

describe('nothing is sent without consent', () => {
  it('refuses when AI consent was never given', async () => {
    /*
     * The gate that matters. The photograph leaves the country, so this check stands between the
     * farmer's decision and the bytes.
     */
    const noConsent = harness({ consents: [] })
    const result = await diagnoseCropDisease(farmer, command, noConsent.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
    expect(noConsent.provider).not.toHaveBeenCalled()
  })

  it('refuses when consent was withdrawn', async () => {
    const withdrawn = harness({ consents: granted({ granted: false }) })
    const result = await diagnoseCropDisease(farmer, command, withdrawn.deps)

    expect(isErr(result)).toBe(true)
    expect(withdrawn.provider).not.toHaveBeenCalled()
  })

  it('refuses when the farmer agreed to an older wording', async () => {
    /*
     * `stale` counts as refused. The consent text names what the data is used for, so agreeing to
     * version 1 is not agreeing to version 2 — the farmer is asked again.
     */
    const stale = harness({ consents: granted({ version: 1 }), currentVersion: 2 })

    const result = await diagnoseCropDisease(farmer, command, stale.deps)
    expect(isErr(result)).toBe(true)
    expect(stale.provider).not.toHaveBeenCalled()
  })
})

describe('who may ask at all', () => {
  it('refuses an anonymous caller', async () => {
    const result = await diagnoseCropDisease(ANONYMOUS, command, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED')
    expect(h.provider).not.toHaveBeenCalled()
  })

  it('refuses a consumer, who has no crops', async () => {
    const result = await diagnoseCropDisease(consumer, command, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('FORBIDDEN')
    expect(h.provider).not.toHaveBeenCalled()
  })

  it('reports unavailable rather than failing when no provider is configured', async () => {
    // A deployment without a key is not the farmer's fault and not something they can act on.
    const off = harness({ available: false })
    const result = await diagnoseCropDisease(farmer, command, off.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(off.provider).not.toHaveBeenCalled()
  })
})

describe('the image is checked before anything is paid for', () => {
  it('refuses a file that is not a photograph', async () => {
    const result = await diagnoseCropDisease(
      farmer,
      { ...command, contentType: 'application/pdf' },
      h.deps,
    )
    expect(isErr(result)).toBe(true)
    expect(h.provider).not.toHaveBeenCalled()
  })

  it('refuses an oversized photograph', async () => {
    const result = await diagnoseCropDisease(
      farmer,
      { ...command, image: image(MAX_IMAGE_BYTES + 1) },
      h.deps,
    )
    expect(isErr(result)).toBe(true)
    expect(h.provider).not.toHaveBeenCalled()
  })

  it('refuses a missing photograph', async () => {
    const result = await diagnoseCropDisease(farmer, { ...command, image: image(0) }, h.deps)
    expect(isErr(result)).toBe(true)
    expect(h.provider).not.toHaveBeenCalled()
  })
})

describe('the spend breaker', () => {
  it('stops the platform when the day is spent', async () => {
    const spent = harness({ servedToday: 500 })
    const result = await diagnoseCropDisease(farmer, command, spent.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('RATE_LIMITED')
    expect(spent.provider).not.toHaveBeenCalled()
  })

  it('stops one farmer before they spend the whole allowance', async () => {
    const capped = harness({ servedForUser: 5 })
    const result = await diagnoseCropDisease(farmer, command, capped.deps)

    expect(isErr(result)).toBe(true)
    expect(capped.provider).not.toHaveBeenCalled()
  })

  it('does not attribute a platform-wide exhaustion to whoever asked last', async () => {
    /*
     * An audit row saying this farmer caused the budget to run out would be a false statement —
     * they merely arrived after it did.
     */
    const spent = harness({ servedToday: 500 })
    await diagnoseCropDisease(farmer, command, spent.deps)

    expect(spent.audit.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: null,
      reason: 'BUDGET_EXHAUSTED',
    })
  })

  it('does attribute a per-farmer refusal to that farmer', async () => {
    const capped = harness({ servedForUser: 5 })
    await diagnoseCropDisease(farmer, command, capped.deps)

    expect(capped.audit.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: USER,
      reason: 'USER_LIMIT_REACHED',
    })
  })
})

describe('when the provider fails', () => {
  it('reports unavailable and stores nothing', async () => {
    // A farmer on a bad connection should be told to try again, not shown an error boundary.
    const failing = harness({ answer: { ok: false, reason: 'TIMED_OUT' } })
    const result = await diagnoseCropDisease(farmer, command, failing.deps)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE')
    expect(failing.record).not.toHaveBeenCalled()
  })

  it('audits the failure without inventing a diagnosis', async () => {
    const failing = harness({ answer: { ok: false, reason: 'PROVIDER_REFUSED' } })
    await diagnoseCropDisease(farmer, command, failing.deps)

    expect(failing.audit.mock.calls[0]?.[0]).toMatchObject({
      action: 'ADVISORY_FAILED',
      reason: 'PROVIDER_REFUSED',
    })
  })
})

describe('what reaches the audit log', () => {
  it('never copies the answer or the photograph into it', async () => {
    /*
     * That a diagnosis was served is what an investigation needs. The advice itself lives on its
     * own record with its own retention; copying it here would spread it into a table with a
     * different policy.
     */
    await diagnoseCropDisease(farmer, command, h.deps)
    const line = JSON.stringify(h.audit.mock.calls[0]?.[0])

    expect(line).not.toContain('পাতা ঝলসানো')
    expect(line).toContain('ADVISORY_DIAGNOSIS_SERVED')
  })
})
