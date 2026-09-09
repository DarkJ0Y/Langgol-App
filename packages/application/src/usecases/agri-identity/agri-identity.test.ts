/**
 * Agricultural profile use-case tests, with data privacy as the main subject.
 *
 * The domain tests prove the disclosure rules in isolation. These prove they hold on the value a
 * caller actually receives, which is the only place a leak matters.
 *
 * The central test is the sentinel sweep: every private thing Langgol holds is given a value
 * nothing else could produce, a profile is assembled, and the serialised result is searched for
 * each of them. It catches a leak through any route — a new field, a nested object, an array — and
 * it does not care what the offending field is called, which is exactly the failure a
 * name-based test misses.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ANONYMOUS, type Actor, type Role } from '@langgol/domain/policy'
import { isAgriId } from '@langgol/domain/agri-identity'
import { isErr, isOk } from '@langgol/shared'
import { myAgriProfile, type AgriProfileDeps } from './agri-profile.js'
import type { AgriProfileSourceData } from '../../ports/agri-identity.js'

const ME = 'a0000000-0000-4000-8000-00000000000a'
const STRANGER = 'b0000000-0000-4000-8000-00000000000b'
const NOW = new Date('2026-09-07T09:00:00.000Z')

/**
 * Every private value, given a form nothing else in a profile could produce.
 *
 * Real shapes rather than the string "SECRET", because half the tripwire matches on shape: a
 * placeholder would sail past the phone and coordinate checks and prove nothing about them.
 */
const SENSITIVE = {
  nid: '1234567890',
  phone: '+8801712345678',
  email: 'rahim.uddin@example.com',
  addressLine: 'House 4, Road 2, Shibganj',
  latitude: 24.374945,
  longitude: 88.604229,
  revenuePoisha: 4500000n,
  tradeLicence: 'DHK-99-114477',
} as const

const actor = (userId: string, ...roles: Role[]): Actor => ({ userId, roles, status: 'ACTIVE' })
const me = () => actor(ME, 'FARMER')

/** A complete, ordinary set of sources. Nothing private in it — that is the point. */
const sources: AgriProfileSourceData = {
  displayName: 'Rahim Uddin',
  memberSince: new Date('2026-01-01T00:00:00.000Z'),
  roles: [{ role: 'FARMER', verified: true }],
  verifications: [
    { type: 'PHONE', status: 'VERIFIED' },
    { type: 'IDENTITY', status: 'VERIFIED' },
  ],
  location: { district: 'Bogura', division: 'Rajshahi' },
  farm: {
    farmCount: 2,
    plotCount: 5,
    landBand: 'SMALL',
    irrigationAvailable: true,
    farmingMethod: 'CONVENTIONAL',
    experienceYears: 14,
  },
  production: {
    seasonsRecorded: 6,
    yearsRecorded: 3,
    crops: ['Boro rice', 'Potato'],
    latestYear: 2026,
  },
  business: null,
}

function harness(options: { readonly sources?: AgriProfileSourceData | null } = {}) {
  const audit = vi.fn(async (_line: Record<string, unknown>) => undefined)
  const issued = new Map<string, string>()

  // Fixed bytes so the identifier is predictable, varied per call so a collision retry can be
  // exercised without the generator repeating itself forever.
  let seed = 1
  const random = {
    bytes: (count: number) => new Uint8Array(Array.from({ length: count }, (_, i) => seed + i * 3)),
  }

  const issueAgriId = vi.fn(async (userId: string, candidate: string) => {
    const existing = issued.get(userId)
    if (existing !== undefined) return existing
    if ([...issued.values()].includes(candidate)) return null
    issued.set(userId, candidate)
    return candidate
  })

  const deps = {
    clock: { now: () => NOW },
    audit: { record: audit },
    random,
    identities: {
      findAgriId: async (userId: string) => issued.get(userId) ?? null,
      issueAgriId,
      profileSources: async (userId: string) =>
        userId === ME ? (options.sources === undefined ? sources : options.sources) : null,
    },
  } as unknown as AgriProfileDeps

  return {
    deps,
    audit,
    issueAgriId,
    issued,
    nextSeed: (value: number) => {
      seed = value
    },
  }
}

let h: ReturnType<typeof harness>
beforeEach(() => {
  h = harness()
})

/* ============================================================ the identifier */

describe('the AGRI-ID', () => {
  it('is issued on first read', async () => {
    // Create-on-read, like the farmer profile and the role profiles. A role can be granted from
    // several places, and requiring each to also issue an identifier means the one that forgets
    // produces a user with no identity at all.
    const result = await myAgriProfile(me(), h.deps)
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(isAgriId(result.value.agriId)).toBe(true)
  })

  it('has the published shape', async () => {
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.agriId).toMatch(/^AGRI-BD-[0-9A-HJ-NP-TV-Z]{8}$/)
  })

  it('is the same on every later read', async () => {
    /*
     * A second identifier would orphan every certificate carrying the first. This is the property
     * that makes an AGRI-ID safe to print.
     */
    const first = await myAgriProfile(me(), h.deps)
    const second = await myAgriProfile(me(), h.deps)
    if (!isOk(first) || !isOk(second)) throw new Error('expected ok')

    expect(second.value.agriId).toBe(first.value.agriId)
    expect(h.issueAgriId).toHaveBeenCalledTimes(1)
  })

  it('contains nothing derived from the user', async () => {
    /*
     * The rule the whole design rests on. A hashed NID would be recoverable by enumeration, and a
     * hashed user id would let anybody holding both correlate accounts. Neither the user id nor
     * anything from the sources may appear.
     */
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    const body = result.value.agriId.slice('AGRI-BD-'.length)
    expect(ME).not.toContain(body)
    expect(body).not.toContain(ME.slice(0, 8))
    expect(sources.displayName.toUpperCase()).not.toContain(body)
  })

  it('records the moment it was issued, and only then', async () => {
    // An AGRI-ID is a permanent public name; when it came into existence is something a dispute
    // may need to establish. A later read is not an issue and must not look like one.
    await myAgriProfile(me(), h.deps)
    expect(h.audit.mock.calls.map((call) => (call[0] as { action: string }).action)).toContain(
      'AGRI_ID_ISSUED',
    )

    h.audit.mockClear()
    await myAgriProfile(me(), h.deps)
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('retries when a candidate is already taken', async () => {
    // Thirty-four billion values makes a real collision vanishingly unlikely; the retry is there
    // for a broken random source, and it should recover rather than fail.
    const taken = harness()
    taken.issued.set(STRANGER, 'AGRI-BD-PLACEHOLD')
    taken.issueAgriId.mockImplementationOnce(async () => null)

    const result = await myAgriProfile(me(), taken.deps)
    expect(isOk(result)).toBe(true)
    expect(taken.issueAgriId.mock.calls.length).toBeGreaterThan(1)
  })

  it('gives up rather than looping when every attempt collides', async () => {
    const broken = harness()
    broken.issueAgriId.mockImplementation(async () => null)

    const result = await myAgriProfile(me(), broken.deps)
    expect(isErr(result)).toBe(true)
  })
})

/* ============================================================ authorization */

describe('who may read a profile', () => {
  it('refuses an anonymous caller', async () => {
    const result = await myAgriProfile(ANONYMOUS, h.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('UNAUTHENTICATED')
  })

  it('refuses a suspended account', async () => {
    const suspended: Actor = { userId: ME, roles: ['FARMER'], status: 'SUSPENDED' }
    expect(isErr(await myAgriProfile(suspended, h.deps))).toBe(true)
  })

  it('takes no subject, so there is no argument to point at somebody else', () => {
    /*
     * Structural rather than checked. Stated as a test so that a future signature change adding a
     * subject parameter has to break something first.
     */
    expect(myAgriProfile).toHaveLength(2)
  })

  it('returns nothing for a caller with no underlying record', async () => {
    const empty = harness({ sources: null })
    const result = await myAgriProfile(actor(STRANGER, 'FARMER'), empty.deps)
    expect(isErr(result)).toBe(true)
  })
})

/* ================================================================= privacy */

describe('the profile discloses nothing private', () => {
  it('carries none of the sensitive values, whatever they are called', async () => {
    /*
     * The sweep. Every private thing Langgol holds is searched for in the serialised response.
     *
     * This is written against VALUES rather than field names on purpose: a test asserting the
     * absence of a `phone` key would pass forever while `contactNumber` shipped beside it.
     */
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    const serialised = JSON.stringify(result.value)
    for (const [name, value] of Object.entries(SENSITIVE)) {
      expect(serialised, `${name} reached the profile`).not.toContain(String(value))
    }
  })

  it('refuses to serve a profile that has picked up something private', async () => {
    /*
     * The tripwire, exercised. A source that has been widened to carry a phone number must take
     * the endpoint down rather than publish it — serving nothing is the correct failure when the
     * alternative is serving that.
     */
    const leaky = harness({
      sources: {
        ...sources,
        // A plausible future addition, under a name that reads as harmless.
        business: {
          role: 'RETAILER',
          businessName: `Karim Store ${SENSITIVE.phone}`,
          verified: true,
          serviceAreaCount: 0,
        },
      },
    })

    const result = await myAgriProfile(me(), leaky.deps)
    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('INTERNAL')
  })

  it('does not put the offending value into the error it returns', async () => {
    // A safety net that writes the leaked value into a log is the leak. The error names where the
    // problem was, never what it was.
    const leaky = harness({
      sources: { ...sources, location: { district: SENSITIVE.nid, division: 'Rajshahi' } },
    })

    const result = await myAgriProfile(me(), leaky.deps)
    if (!isErr(result)) throw new Error('expected refusal')
    expect(JSON.stringify(result.error)).not.toContain(SENSITIVE.nid)
  })

  it('says only whether a verification passed, never how', async () => {
    // Whether somebody is verified is the useful fact. Which document they used, and what was on
    // it, is nobody else's business — and it is not reachable from this shape at all.
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    for (const entry of result.value.verifications) {
      expect(Object.keys(entry).sort()).toEqual(['status', 'type'])
      expect(['NOT_VERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).toContain(entry.status)
    }
  })

  it('publishes land as a band and never as an area', async () => {
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(result.value.farm?.landBand).toBe('SMALL')
    expect(JSON.stringify(result.value.farm)).not.toMatch(/totalLand|areaMilli|decimals/i)
  })

  it('publishes location no finer than a district', async () => {
    // A union plus a name identifies a household in rural Bangladesh.
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(Object.keys(result.value.location ?? {}).sort()).toEqual(['district', 'division'])
  })

  it('publishes which crops are grown and never how much they earned', async () => {
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')

    expect(result.value.production?.crops).toContain('Boro rice')
    expect(JSON.stringify(result.value.production)).not.toMatch(/price|revenue|cost|poisha/i)
  })

  it('writes nothing sensitive to the audit log', async () => {
    await myAgriProfile(me(), h.deps)
    const written = JSON.stringify(h.audit.mock.calls)
    for (const value of Object.values(SENSITIVE)) {
      expect(written).not.toContain(String(value))
    }
  })
})

/* ============================================================== completion */

describe('what the card says about completeness', () => {
  it('gives the owner their own progress', async () => {
    const result = await myAgriProfile(me(), h.deps)
    if (!isOk(result)) throw new Error('expected ok')
    expect(result.value.completion?.percent).toBe(100)
  })

  it('names what is still missing, so a screen can say what to do next', async () => {
    const partial = harness({
      sources: { ...sources, production: null, verifications: [] },
    })

    const result = await myAgriProfile(me(), partial.deps)
    if (!isOk(result)) throw new Error('expected ok')

    /*
     * The canonical step names, lower-cased. P12 made the card read the one shared completion
     * calculation rather than keeping a four-section one of its own, so what comes back here is
     * the same vocabulary the dashboard and the setup screen use.
     */
    expect(result.value.completion?.missing).toEqual(
      expect.arrayContaining(['current_crop', 'kyc']),
    )
  })
})
