/**
 * AGRI-ID and disclosure tests.
 *
 * The privacy tests are the point of this file. They are written as properties rather than as
 * examples, because the failure they guard against is not a bug in today's code — it is the field
 * somebody adds in six months. A test that checked "the profile does not contain `phone`" would
 * pass forever while `contactNumber` shipped.
 */

import { describe, expect, it } from 'vitest'
import {
  AGRI_ID_RANDOM_BYTES,
  AgriIdError,
  agriIdFromBytes,
  isAgriId,
  normalizeAgriId,
  parseAgriId,
} from './agri-id.js'
import {
  DisclosureError,
  auditDisclosure,
  isForbiddenKey,
  isSafeToDisclose,
  visibleTo,
} from './disclosure.js'
import { assembleAgriProfile, landBandFor, type AgriProfileSources } from './profile.js'
import { NO_PROGRESS, onboardingCompletion } from '../onboarding/index.js'

/** Fixed bytes, so a test can pin an exact identifier. */
const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6])

function bytesFrom(values: readonly number[]): Uint8Array {
  return new Uint8Array(values)
}

/* ============================================================== the AGRI-ID */

describe('the shape of an AGRI-ID', () => {
  it('looks like the specified format', () => {
    const id = agriIdFromBytes(BYTES, 'BD')
    expect(id).toMatch(/^AGRI-BD-[0-9A-HJ-NP-TV-Z]{8}$/)
  })

  it('is deterministic in its bytes, so the format is testable', () => {
    expect(agriIdFromBytes(BYTES, 'BD')).toBe(agriIdFromBytes(BYTES, 'BD'))
  })

  it('changes completely when the bytes change', () => {
    expect(agriIdFromBytes(BYTES, 'BD')).not.toBe(
      agriIdFromBytes(bytesFrom([7, 7, 7, 7, 7, 7, 7]), 'BD'),
    )
  })

  it('refuses to build one from too little random material', () => {
    expect(() => agriIdFromBytes(new Uint8Array(3), 'BD')).toThrow(AgriIdError)
  })

  it('needs exactly the bytes it advertises', () => {
    // The constant is what infrastructure asks the CSPRNG for. If the two disagreed, generation
    // would throw in production and nowhere else.
    expect(() => agriIdFromBytes(new Uint8Array(AGRI_ID_RANDOM_BYTES), 'BD')).not.toThrow()
  })

  it('never uses a letter that can be misread', () => {
    /*
     * I, L, O and U are absent by construction. The first three are unreadable beside 1 and 0 in
     * handwriting, which is how this will actually be copied; U is dropped so no accidental word
     * appears on somebody's certificate.
     */
    for (let seed = 0; seed < 256; seed += 1) {
      const id = agriIdFromBytes(bytesFrom(Array.from({ length: 7 }, (_, i) => seed + i)), 'BD')
      const body = id.slice('AGRI-BD-'.length)
      expect(body, `seed ${String(seed)}`).not.toMatch(/[ILOU]/)
    }
  })
})

describe('an AGRI-ID reveals nothing about its owner', () => {
  it('is built only from the bytes it is given', () => {
    /*
     * The rule the whole module exists for. A hash of an NID would be invertible by enumeration —
     * a national ID has few enough plausible values that anybody holding the identifier could
     * recover the number offline. This pins that no other input reaches the identifier.
     */
    expect(agriIdFromBytes.length).toBe(2)

    // The same bytes produce the same id regardless of anything else in scope: there is no other
    // input to depend on.
    const first = agriIdFromBytes(BYTES, 'BD')
    const second = agriIdFromBytes(new Uint8Array([...BYTES]), 'BD')
    expect(first).toBe(second)
  })

  it('never contains a run of digits long enough to be an identity number', () => {
    // Not a guarantee about entropy — a guarantee that an identifier cannot be mistaken for, or
    // accidentally carry, something that looks like an NID.
    for (let seed = 0; seed < 512; seed += 3) {
      const id = agriIdFromBytes(
        bytesFrom(Array.from({ length: 7 }, (_, i) => seed * (i + 1))),
        'BD',
      )
      expect(id.slice('AGRI-BD-'.length)).not.toMatch(/\d{10,}/)
    }
  })

  it('passes the disclosure tripwire, so it can sit in a public profile', () => {
    expect(isSafeToDisclose({ agriId: agriIdFromBytes(BYTES, 'BD') })).toBe(true)
  })
})

describe('reading an AGRI-ID back', () => {
  const id = agriIdFromBytes(BYTES, 'BD')

  it('round-trips its own output', () => {
    expect(parseAgriId(id).value).toBe(id)
  })

  it('accepts the confusable letters somebody would actually type', () => {
    // Reading O for 0 and I or L for 1 off a printed card is the commonest copying mistake there
    // is. Punishing it would be punishing the reader for the typeface.
    const withConfusables = agriIdFromBytes(bytesFrom([0, 1, 0, 1, 0, 1, 0]), 'BD')
    const body = withConfusables.slice('AGRI-BD-'.length)
    const typed = `AGRI-BD-${body.replace(/0/g, 'O').replace(/1/g, 'I')}`
    expect(parseAgriId(typed).value).toBe(withConfusables)
  })

  it('accepts it without dashes, in lower case, with spaces', () => {
    expect(parseAgriId(id.replace(/-/g, ' ').toLowerCase()).value).toBe(id)
  })

  it('catches every single-character mistake', () => {
    /*
     * The check character earns its place here. Without it a mistyped identifier either finds
     * nothing — wasting everybody's time — or, far worse, finds somebody else.
     */
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    const body = id.slice('AGRI-BD-'.length)

    for (let position = 0; position < body.length; position += 1) {
      for (const replacement of alphabet) {
        if (replacement === body[position]) continue
        const broken = `AGRI-BD-${body.slice(0, position)}${replacement}${body.slice(position + 1)}`
        expect(isAgriId(broken), `${broken} was accepted`).toBe(false)
      }
    }
  })

  it('refuses a made-up identifier', () => {
    for (const bad of ['', 'AGRI-BD-', 'AGRI-BD-1234567', 'AGRI-XX-ABCDEFGH', 'hello']) {
      expect(isAgriId(bad), bad).toBe(false)
    }
  })

  it('refuses a country nobody issues', () => {
    let code: string | undefined
    try {
      parseAgriId('AGRI-ZZ-0123456A')
    } catch (error) {
      if (error instanceof AgriIdError) code = error.code
    }
    expect(code).toBe('AGRI_ID_COUNTRY')
  })

  it('normalises case and separators, and leaves the letters alone', () => {
    /*
     * The confusable folding belongs to the body, not to the whole string. Applied globally it
     * turns the `AGRI` prefix into `AGR1` and nothing ever parses — which is the bug this test
     * now pins.
     */
    expect(normalizeAgriId('agri-bd-o1l2')).toBe('AGRIBDO1L2')
    expect(normalizeAgriId(id)).toBe(id.replace(/-/g, ''))
  })
})

/* ============================================================== disclosure */

describe('keys that may never appear in a profile', () => {
  it('refuses the obvious ones', () => {
    for (const key of ['nid', 'phone', 'email', 'address', 'latitude', 'longitude']) {
      expect(isForbiddenKey(key), key).toBe(true)
    }
  })

  it('refuses them however they are spelled', () => {
    // Segment matching, so a future field cannot slip past by being camelCased or prefixed.
    for (const key of [
      'farmerPhone',
      'contact_email',
      'nidHash',
      'homeAddressLine',
      'farmLatitude',
      'payoutAccountRef',
      'revenuePoisha',
      'identityNumberMasked',
    ]) {
      expect(isForbiddenKey(key), key).toBe(true)
    }
  })

  it('allows the ordinary vocabulary a profile is made of', () => {
    // Over-refusal would make the rule unusable and it would be switched off.
    for (const key of ['agriId', 'displayName', 'district', 'crops', 'farmCount', 'landBand']) {
      expect(isForbiddenKey(key), key).toBe(false)
    }
  })
})

describe('values that may never appear in a profile', () => {
  it('catches a phone number hidden under an innocent key', () => {
    // A key check alone would miss this, which is why there is a value check too.
    expect(() => auditDisclosure({ note: '+8801712345678' })).toThrow(DisclosureError)
    expect(() => auditDisclosure({ note: '01712345678' })).toThrow(DisclosureError)
  })

  it('catches an identity-length digit run', () => {
    expect(() => auditDisclosure({ reference: '1234567890' })).toThrow(DisclosureError)
  })

  it('catches a coordinate pair', () => {
    // Dhaka, under a name that gives nothing away.
    expect(() => auditDisclosure({ point: { a: 23.8103, b: 90.4125 } })).toThrow(DisclosureError)
    expect(() => auditDisclosure({ point: [23.8103, 90.4125] })).toThrow(DisclosureError)
  })

  it('catches a coordinate pair written the other way round', () => {
    expect(() => auditDisclosure({ point: [90.4125, 23.8103] })).toThrow(DisclosureError)
  })

  it('catches money, which in this codebase is a bigint', () => {
    expect(() => auditDisclosure({ amount: 45000n })).toThrow(DisclosureError)
  })

  it('leaves ordinary profile values alone', () => {
    expect(() =>
      auditDisclosure({
        agriId: 'AGRI-BD-7K4M2QX9',
        displayName: 'Rahim Uddin',
        district: 'Bogura',
        crops: ['Boro rice', 'Potato'],
        farmCount: 2,
        experienceYears: 14,
        latestYear: 2026,
        memberSince: new Date('2026-01-01'),
      }),
    ).not.toThrow()
  })

  it('does not mistake a year or a quantity for an identity number', () => {
    // A rule that refused these would be turned off within a week, and then it would protect
    // nothing at all.
    expect(isSafeToDisclose({ year: 2026, seasons: 4, kilograms: 125000 })).toBe(true)
  })

  it('does not mistake a single number for a location', () => {
    expect(isSafeToDisclose({ experienceYears: 23.8 })).toBe(true)
  })

  it('reports where the offending value was, so it can be found', () => {
    let path: string | undefined
    try {
      auditDisclosure({ farm: { owner: { contact: '01712345678' } } })
    } catch (error) {
      if (error instanceof DisclosureError) path = error.path
    }
    expect(path).toBe('profile.farm.owner.contact')
  })

  it('survives a cycle rather than hanging on one', () => {
    const cyclic: Record<string, unknown> = { agriId: 'AGRI-BD-7K4M2QX9' }
    cyclic['self'] = cyclic
    expect(() => auditDisclosure(cyclic)).not.toThrow()
  })
})

/* ================================================================= profile */

describe('land is published as a band, never as an area', () => {
  it('places a holding without disclosing it', () => {
    /*
     * Land is wealth, and a precise holding published against a name is an invitation where land
     * disputes are common. A band answers what a lender or an insurer actually asks.
     */
    expect(landBandFor(0)).toBe('LANDLESS')
    expect(landBandFor(30)).toBe('MARGINAL')
    expect(landBandFor(120)).toBe('SMALL')
    expect(landBandFor(500)).toBe('MEDIUM')
    expect(landBandFor(5000)).toBe('LARGE')
  })

  it('does not claim somebody is landless when they simply have not said', () => {
    expect(landBandFor(null)).toBeNull()
  })

  it('refuses a nonsensical area rather than banding it', () => {
    expect(landBandFor(-1)).toBeNull()
    expect(landBandFor(Number.NaN)).toBeNull()
  })
})

describe('assembling a profile', () => {
  const sources: AgriProfileSources = {
    agriId: 'AGRI-BD-7K4M2QX9',
    displayName: 'Rahim Uddin',
    memberSince: new Date('2026-01-01T00:00:00.000Z'),
    roles: [{ role: 'FARMER', verified: true }],
    verifications: [
      { type: 'PHONE', status: 'VERIFIED' },
      { type: 'IDENTITY', status: 'PENDING' },
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

  it('is safe to disclose', () => {
    // The property the whole phase is for, asserted on the real assembled shape.
    expect(isSafeToDisclose(assembleAgriProfile(sources, 'SELF'))).toBe(true)
    expect(isSafeToDisclose(assembleAgriProfile(sources, 'PUBLIC'))).toBe(true)
  })

  it('gives the owner their completion, and a stranger none of it', () => {
    /*
     * A completion percentage published to a stranger is an inventory of which parts of somebody's
     * account are unfinished, which is a list of where to push.
     */
    expect(assembleAgriProfile(sources, 'SELF').completion).not.toBeNull()
    expect(assembleAgriProfile(sources, 'PUBLIC').completion).toBeNull()
  })

  it('counts a step as done only when it holds something', () => {
    /*
     * The card's completion delegates to the one calculation in `domain/onboarding`, so the
     * outstanding items come back under the canonical step names. The identity document is PENDING
     * here, not VERIFIED — submitted is not proven.
     */
    const completion = assembleAgriProfile(sources, 'SELF').completion
    expect(completion?.missing).toContain('kyc')
    expect(completion?.answered).toBe(6)
  })

  it('reaches a hundred once every applicable step is done', () => {
    const finished = assembleAgriProfile(
      {
        ...sources,
        verifications: [
          { type: 'PHONE', status: 'VERIFIED' },
          { type: 'IDENTITY', status: 'VERIFIED' },
        ],
      },
      'SELF',
    )
    expect(finished.completion?.percent).toBe(100)
  })

  it('does not let a verified phone stand in for a verified identity', () => {
    // Two different claims, and only one of them is proof of who somebody is.
    const phoneOnly = assembleAgriProfile(
      { ...sources, verifications: [{ type: 'PHONE', status: 'VERIFIED' }] },
      'SELF',
    )
    expect(phoneOnly.completion?.missing).toContain('kyc')
  })

  it('does not count a submitted document as a proven one', () => {
    const pending = assembleAgriProfile(
      {
        ...sources,
        verifications: [
          { type: 'PHONE', status: 'VERIFIED' },
          { type: 'IDENTITY', status: 'PENDING' },
        ],
      },
      'SELF',
    )
    expect(pending.completion?.missing).toContain('kyc')
  })

  it('shows the same percentage the dashboard would', () => {
    /*
     * The reason there is one calculation rather than two. A person seeing 96% on their identity
     * card and 60% on their dashboard has found a bug whichever number is right, so this pins that
     * the card is reading the canonical figure rather than one of its own.
     */
    const card = assembleAgriProfile(sources, 'SELF').completion
    const dashboard = onboardingCompletion({
      ...NO_PROGRESS,
      hasConfirmedName: true,
      phoneVerified: true,
      roles: ['FARMER'],
      hasLocation: true,
      hasFarm: true,
      hasCurrentCrop: true,
      kycStatus: 'PENDING',
    })

    expect(card?.percent).toBe(dashboard.percent)
  })

  it('publishes what an identifier is for', () => {
    // Withholding these would leave an identifier that identifies nothing.
    const publicView = assembleAgriProfile(sources, 'PUBLIC')
    expect(publicView.roles).toHaveLength(1)
    expect(publicView.location?.district).toBe('Bogura')
    expect(publicView.production?.crops).toContain('Boro rice')
  })

  it('keeps the same shape for both audiences', () => {
    // A consumer should never have to tell "withheld" from "not sent this time".
    const self = assembleAgriProfile(sources, 'SELF')
    const anyone = assembleAgriProfile(sources, 'PUBLIC')
    expect(Object.keys(self).sort()).toEqual(Object.keys(anyone).sort())
  })
})

describe('audience ordering', () => {
  it('lets the owner see everything a stranger can', () => {
    expect(visibleTo('PUBLIC', 'SELF')).toBe(true)
    expect(visibleTo('PUBLIC', 'PUBLIC')).toBe(true)
  })

  it('does not let a stranger see what is the owner’s alone', () => {
    expect(visibleTo('SELF', 'PUBLIC')).toBe(false)
    expect(visibleTo('SELF', 'SELF')).toBe(true)
  })
})
