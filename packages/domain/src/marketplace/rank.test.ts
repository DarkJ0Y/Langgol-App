/**
 * Ranking tests.
 *
 * The most important test in this file is the first one: **platform contribution margin must not
 * move a candidate's score.** It is permitted only as a feasibility filter and a ≤1% tiebreak.
 * Ranking farmers by what Langgol earns from them is how a marketplace loses the asset it
 * actually owns, so the rule is asserted rather than trusted.
 *
 * Refs: docs/04_MARKETPLACE.md §5
 */

import { describe, expect, it } from 'vitest'
import * as Money from '../money/money.js'
import { fixtureConfig } from '../pricing/__fixtures__/config.js'
import { rankCandidates, toBuyerFacingRanking } from './rank.js'
import type { RankingCandidate } from './rank.js'

function candidate(overrides: Partial<RankingCandidate> = {}): RankingCandidate {
  return {
    listingId: 'listing-a',
    farmerProfileId: 'farmer-a',
    deliveredPricePerKgPoisha: Money.fromTaka('51.20'),
    buyerTotalPoisha: Money.fromTaka('256.00'),
    contributionMarginPoisha: Money.fromTaka('10.00'),
    completedOrders: 20,
    acceptedOrders: 22,
    hoursSinceHarvestAtDelivery: 10,
    shelfLifeHours: 96,
    hoursUntilDelivery: 12,
    fullyCoversRequest: true,
    ratingSumStarsMilli: 40000,
    ratingCount: 10,
    distanceMeters: 12000,
    isNewVerifiedFarmer: false,
    ...overrides,
  }
}

describe('the hard rule: contribution margin is not a ranking factor', () => {
  it('two otherwise identical candidates score identically regardless of margin', () => {
    const generous = candidate({
      listingId: 'listing-generous',
      contributionMarginPoisha: Money.fromTaka('500.00'),
    })
    const thin = candidate({
      listingId: 'listing-thin',
      contributionMarginPoisha: Money.fromTaka('0.50'),
    })

    const { ranked } = rankCandidates([generous, thin], fixtureConfig())
    expect(ranked).toHaveLength(2)
    expect(ranked[0]!.scorePpm).toBe(ranked[1]!.scorePpm)
  })

  it('a cheaper candidate outranks a higher-margin one', () => {
    const cheapLowMargin = candidate({
      listingId: 'listing-cheap',
      deliveredPricePerKgPoisha: Money.fromTaka('40.00'),
      contributionMarginPoisha: Money.fromTaka('0.10'),
    })
    const dearHighMargin = candidate({
      listingId: 'listing-dear',
      deliveredPricePerKgPoisha: Money.fromTaka('80.00'),
      contributionMarginPoisha: Money.fromTaka('900.00'),
    })

    const { ranked } = rankCandidates([dearHighMargin, cheapLowMargin], fixtureConfig())
    expect(ranked[0]!.listingId).toBe('listing-cheap')
  })
})

describe('permitted use 1 of 2 — feasibility filter', () => {
  it('excludes candidates below the configured margin floor from default results', () => {
    const viable = candidate({ listingId: 'listing-viable' })
    const ruinous = candidate({
      listingId: 'listing-ruinous',
      contributionMarginPoisha: Money.fromTaka('-500.00'),
    })

    const result = rankCandidates([viable, ruinous], fixtureConfig())
    expect(result.ranked.map((entry) => entry.listingId)).toEqual(['listing-viable'])
    expect(result.excludedByMarginFloor.map((entry) => entry.listingId)).toEqual([
      'listing-ruinous',
    ])
  })

  it('keeps a negative-margin candidate that is still above the floor, but flags it', () => {
    const flagged = candidate({ contributionMarginPoisha: Money.fromTaka('-50.00') })
    const result = rankCandidates([flagged], fixtureConfig())

    expect(result.ranked).toHaveLength(1)
    expect(result.negativeMarginCount).toBe(1)
    expect(result.ranked[0]!.internalNotes.map((note) => note.code)).toContain(
      'NEGATIVE_CONTRIBUTION_MARGIN',
    )
  })

  it('the floor itself comes from config, not from code', () => {
    const thin = candidate({ contributionMarginPoisha: Money.fromTaka('-1.00') })
    const strict = fixtureConfig([{ key: 'ranking.marginFloorPoisha', version: 2, value: 0 }])
    expect(rankCandidates([thin], strict).ranked).toHaveLength(0)
    expect(rankCandidates([thin], fixtureConfig()).ranked).toHaveLength(1)
  })
})

describe('permitted use 2 of 2 — tiebreak within 1%', () => {
  it('breaks a near-tie by contribution margin', () => {
    // Two candidates within the 1% band: prices ৳50.00 and ৳50.20 → priceScore differs ~0.4%.
    const lowMargin = candidate({
      listingId: 'listing-low-margin',
      deliveredPricePerKgPoisha: Money.fromTaka('50.00'),
      contributionMarginPoisha: Money.fromTaka('1.00'),
    })
    const highMargin = candidate({
      listingId: 'listing-high-margin',
      deliveredPricePerKgPoisha: Money.fromTaka('50.20'),
      contributionMarginPoisha: Money.fromTaka('80.00'),
    })

    const { ranked } = rankCandidates([lowMargin, highMargin], fixtureConfig())
    expect(ranked[0]!.listingId).toBe('listing-high-margin')
    expect(ranked[0]!.internalNotes.map((note) => note.code)).toContain(
      'TIEBREAK_APPLIED_ON_MARGIN',
    )
  })

  it('does NOT reorder when the score gap exceeds the tiebreak band', () => {
    const clearlyCheaper = candidate({
      listingId: 'listing-cheaper',
      deliveredPricePerKgPoisha: Money.fromTaka('40.00'),
      contributionMarginPoisha: Money.fromTaka('1.00'),
    })
    const dearerHighMargin = candidate({
      listingId: 'listing-dearer',
      deliveredPricePerKgPoisha: Money.fromTaka('60.00'),
      contributionMarginPoisha: Money.fromTaka('900.00'),
    })

    const { ranked } = rankCandidates([dearerHighMargin, clearlyCheaper], fixtureConfig())
    expect(ranked[0]!.listingId).toBe('listing-cheaper')
    expect(ranked[0]!.internalNotes.map((note) => note.code)).not.toContain(
      'TIEBREAK_APPLIED_ON_MARGIN',
    )
  })
})

describe('docs/04 §7.3 — at a 0.8% gap, reliability and freshness decide', () => {
  it('a fresher, more reliable local farmer outranks a marginally cheaper distant one', () => {
    const localFresh = candidate({
      listingId: 'listing-local',
      deliveredPricePerKgPoisha: Money.fromTaka('30.99'),
      contributionMarginPoisha: Money.fromTaka('5.00'),
      completedOrders: 40,
      acceptedOrders: 41,
      hoursSinceHarvestAtDelivery: 6,
      hoursUntilDelivery: 6,
      distanceMeters: 12000,
    })
    const distantStale = candidate({
      listingId: 'listing-distant',
      deliveredPricePerKgPoisha: Money.fromTaka('30.74'),
      contributionMarginPoisha: Money.fromTaka('5.00'),
      completedOrders: 5,
      acceptedOrders: 12,
      hoursSinceHarvestAtDelivery: 30,
      hoursUntilDelivery: 30,
      distanceMeters: 120000,
    })

    const { ranked } = rankCandidates([distantStale, localFresh], fixtureConfig())
    // "That is the correct answer, and it falls out of the model rather than being special-cased."
    expect(ranked[0]!.listingId).toBe('listing-local')
  })
})

describe('cold start', () => {
  it('gives a new farmer the configured prior rather than a zero score', () => {
    const newcomer = candidate({
      completedOrders: 0,
      acceptedOrders: 0,
      ratingCount: 0,
      ratingSumStarsMilli: 0,
    })
    const { ranked } = rankCandidates([newcomer], fixtureConfig())
    expect(ranked[0]!.factors.reliability).toBeGreaterThan(0n)
  })

  it('applies a decaying exposure boost to a new verified farmer, and logs it', () => {
    const boosted = candidate({
      listingId: 'listing-new',
      completedOrders: 0,
      acceptedOrders: 0,
      isNewVerifiedFarmer: true,
    })
    const { ranked } = rankCandidates([boosted], fixtureConfig())

    expect(ranked[0]!.boostPpm).toBeGreaterThan(0n)
    expect(ranked[0]!.internalNotes.map((note) => note.code)).toContain('NEW_FARMER_BOOST_APPLIED')
  })

  it('decays the boost to nothing once the farmer has a record', () => {
    const established = candidate({ completedOrders: 5, isNewVerifiedFarmer: true })
    const { ranked } = rankCandidates([established], fixtureConfig())
    expect(ranked[0]!.boostPpm).toBe(0n)
  })
})

describe('explainability', () => {
  it('gives every ranked candidate a machine-readable rationale', () => {
    const cheap = candidate({
      listingId: 'listing-cheap',
      deliveredPricePerKgPoisha: Money.fromTaka('40.00'),
    })
    const dear = candidate({
      listingId: 'listing-dear',
      deliveredPricePerKgPoisha: Money.fromTaka('60.00'),
    })

    const { ranked } = rankCandidates([cheap, dear], fixtureConfig())
    const winner = ranked[0]!

    expect(winner.reasons.length).toBeGreaterThan(0)
    const codes = winner.reasons.map((reason) => reason.code)
    expect(codes).toContain('CHEAPEST_DELIVERED')
    expect(codes).toContain('NEARBY')
    expect(codes).toContain('HARVESTED_TODAY')
    expect(codes).toContain('COVERS_FULL_QUANTITY')
  })

  it('quantifies the price advantage against the next-best option', () => {
    const cheap = candidate({
      listingId: 'listing-cheap',
      deliveredPricePerKgPoisha: Money.fromTaka('40.00'),
    })
    const dear = candidate({
      listingId: 'listing-dear',
      deliveredPricePerKgPoisha: Money.fromTaka('43.40'),
    })

    const { ranked } = rankCandidates([cheap, dear], fixtureConfig())
    const reason = ranked[0]!.reasons.find((entry) => entry.code === 'CHEAPEST_DELIVERED')
    expect(reason?.detail?.['vsNextPoishaPerKg']).toBe('340')
  })

  it('labels a partial fill honestly', () => {
    const partial = candidate({ fullyCoversRequest: false })
    const { ranked } = rankCandidates([partial], fixtureConfig())
    expect(ranked[0]!.reasons.map((reason) => reason.code)).toContain('PARTIAL_FILL_ONLY')
  })
})

describe('the buyer never sees Langgol economics', () => {
  it('strips margin and internal notes from the buyer-facing projection', () => {
    const { ranked } = rankCandidates([candidate()], fixtureConfig())
    const [buyerFacing] = toBuyerFacingRanking(ranked)

    const serialised = JSON.stringify(buyerFacing, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )
    expect(serialised).not.toContain('contributionMargin')
    expect(serialised).not.toContain('internalNotes')
    expect(serialised).not.toContain('MARGIN')
  })
})

describe('edge cases', () => {
  it('returns an empty result for no candidates rather than throwing', () => {
    expect(rankCandidates([], fixtureConfig())).toEqual({
      ranked: [],
      excludedByMarginFloor: [],
      negativeMarginCount: 0,
    })
  })

  it('is deterministic: equal scores are ordered by a stable key', () => {
    const first = candidate({ listingId: 'listing-b' })
    const second = candidate({ listingId: 'listing-a' })
    const once = rankCandidates([first, second], fixtureConfig())
    const twice = rankCandidates([second, first], fixtureConfig())
    expect(once.ranked.map((entry) => entry.listingId)).toEqual(
      twice.ranked.map((entry) => entry.listingId),
    )
  })
})
