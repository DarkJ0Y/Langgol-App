/**
 * The ranking engine.
 *
 * Candidate generation happens in the application layer (it needs the database); this module is
 * the pure decision: given priced candidates, produce an ordered, explained result list.
 *
 * **The hard rule about self-interest.** Platform contribution margin is not a ranking factor.
 * It is used in exactly two ways, both implemented here and nowhere else:
 *
 *   1. a **feasibility filter** — candidates below a configured margin floor are excluded from
 *      default results, though they remain reachable by explicit search;
 *   2. a **tiebreak** between candidates whose scores are within a configured band (1%).
 *
 * Ranking sellers by how much Langgol earns from them is how marketplaces lose farmer trust, and
 * farmer trust is the entire asset. If this is ever relaxed it must be disclosed in the UI.
 *
 * Refs: docs/04_MARKETPLACE.md §5; docs/P2_DELIVERED_COST.md §5
 */

import type { ConfigSnapshot } from '../config/snapshot.js'
import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import type { InternalNote, Reason } from './rationale.js'
import {
  combineScores,
  freshnessScore,
  newFarmerBoost,
  priceScore,
  quantityFitScore,
  ratingScore,
  reliabilityScore,
  speedScore,
  type FactorScores,
  type Ppm,
  PPM,
} from './scoring.js'

const BPS = 10000n

export interface RankingCandidate {
  readonly listingId: string
  readonly farmerProfileId: string
  /** Delivered cost per kilogram — the figure `priceScore` compares. */
  readonly deliveredPricePerKgPoisha: Poisha
  readonly buyerTotalPoisha: Poisha
  /** Modelled contribution margin for this candidate. Filter and tiebreak only. */
  readonly contributionMarginPoisha: Poisha
  readonly completedOrders: number
  readonly acceptedOrders: number
  readonly hoursSinceHarvestAtDelivery: number | null
  readonly shelfLifeHours: number
  readonly hoursUntilDelivery: number
  readonly fullyCoversRequest: boolean
  readonly ratingSumStarsMilli: number
  readonly ratingCount: number
  readonly distanceMeters: number
  readonly isNewVerifiedFarmer: boolean
}

export interface RankedCandidate {
  readonly listingId: string
  readonly farmerProfileId: string
  readonly rank: number
  readonly scorePpm: Ppm
  readonly factors: FactorScores
  readonly boostPpm: Ppm
  readonly deliveredPricePerKgPoisha: Poisha
  readonly buyerTotalPoisha: Poisha
  readonly contributionMarginPoisha: Poisha
  /** Buyer-facing, safe to serialise to a browser. */
  readonly reasons: readonly Reason[]
  /** Langgol-only. Strip before any client response. */
  readonly internalNotes: readonly InternalNote[]
}

export interface RankingResult {
  readonly ranked: readonly RankedCandidate[]
  /**
   * Candidates excluded by the margin feasibility filter. Returned separately rather than
   * silently dropped so the exclusion is countable and reportable, and so an explicit search can
   * still surface them.
   */
  readonly excludedByMarginFloor: readonly RankedCandidate[]
  readonly negativeMarginCount: number
}

function isWithinTiebreakBand(leaderPpm: Ppm, candidatePpm: Ppm, tiebreakBps: number): boolean {
  if (leaderPpm <= 0n) return false
  const allowed = (leaderPpm * BigInt(tiebreakBps)) / BPS
  return leaderPpm - candidatePpm <= allowed
}

/**
 * Rank priced candidates.
 *
 * @param candidates Already priced by the delivered-cost engine — this function does no pricing.
 * @param config Supplies the weights, priors, margin floor and tiebreak band. Nothing economic
 *   is decided in this file.
 */
export function rankCandidates(
  candidates: readonly RankingCandidate[],
  config: ConfigSnapshot,
): RankingResult {
  if (candidates.length === 0) {
    return { ranked: [], excludedByMarginFloor: [], negativeMarginCount: 0 }
  }

  const weightsBps = config.require('ranking.weightsBps')
  const reliabilityPrior = config.require('ranking.reliabilityPrior')
  const ratingPrior = config.require('ranking.ratingPrior')
  const quantityFitBps = config.require('ranking.quantityFitBps')
  const marginFloorPoisha = Money.fromPoisha(config.require('ranking.marginFloorPoisha'))
  const tiebreakBps = config.require('ranking.tiebreakBps')
  const boostConfig = config.require('ranking.newFarmerBoost')

  // The cheapest delivered price sets the price-score denominator for every candidate.
  const bestDeliveredPerKg = candidates.reduce<bigint>(
    (best, candidate) =>
      candidate.deliveredPricePerKgPoisha > 0n && candidate.deliveredPricePerKgPoisha < best
        ? candidate.deliveredPricePerKgPoisha
        : best,
    candidates[0]!.deliveredPricePerKgPoisha,
  )

  const scored = candidates.map((candidate) => {
    const factors: FactorScores = {
      price: priceScore(candidate.deliveredPricePerKgPoisha, bestDeliveredPerKg),
      reliability: reliabilityScore(
        candidate.completedOrders,
        candidate.acceptedOrders,
        reliabilityPrior,
      ),
      freshness: freshnessScore(candidate.hoursSinceHarvestAtDelivery, candidate.shelfLifeHours),
      speed: speedScore(candidate.hoursUntilDelivery),
      quantityFit: quantityFitScore(candidate.fullyCoversRequest, quantityFitBps),
      rating: ratingScore(candidate.ratingSumStarsMilli, candidate.ratingCount, ratingPrior),
    }

    const baseScore = combineScores(factors, weightsBps)
    const boostPpm = candidate.isNewVerifiedFarmer
      ? newFarmerBoost(candidate.completedOrders, boostConfig)
      : 0n

    const scorePpm = baseScore + boostPpm > PPM ? PPM : baseScore + boostPpm

    return { candidate, factors, boostPpm, scorePpm }
  })

  /* ------------------------------------------------- feasibility filter (use 1 of 2) */

  const feasible: typeof scored = []
  const infeasible: typeof scored = []
  for (const entry of scored) {
    if (Money.compare(entry.candidate.contributionMarginPoisha, marginFloorPoisha) < 0) {
      infeasible.push(entry)
    } else {
      feasible.push(entry)
    }
  }

  /* --------------------------------------------------------- sort, then tiebreak */

  const ordered = [...feasible].sort((a, b) => {
    if (a.scorePpm === b.scorePpm) return a.candidate.listingId.localeCompare(b.candidate.listingId)
    return a.scorePpm > b.scorePpm ? -1 : 1
  })

  // Group candidates whose scores sit within the tiebreak band of the group leader, then order
  // within each group by contribution margin. This is permitted use 2 of 2.
  const tiebroken: typeof ordered = []
  const tiebreakApplied = new Set<string>()

  let index = 0
  while (index < ordered.length) {
    const leader = ordered[index]!
    const group = [leader]
    let next = index + 1
    while (
      next < ordered.length &&
      isWithinTiebreakBand(leader.scorePpm, ordered[next]!.scorePpm, tiebreakBps)
    ) {
      group.push(ordered[next]!)
      next += 1
    }

    if (group.length > 1) {
      group.sort((a, b) => {
        const byMargin = Money.compare(
          b.candidate.contributionMarginPoisha,
          a.candidate.contributionMarginPoisha,
        )
        if (byMargin !== 0) return byMargin
        return a.candidate.listingId.localeCompare(b.candidate.listingId)
      })
      for (const entry of group) tiebreakApplied.add(entry.candidate.listingId)
    }

    tiebroken.push(...group)
    index = next
  }

  /* ----------------------------------------------------------------- explain */

  const ranked = tiebroken.map((entry, position) =>
    explain(entry, position + 1, tiebroken, {
      tiebreakApplied: tiebreakApplied.has(entry.candidate.listingId),
      belowFloor: false,
    }),
  )

  const excludedByMarginFloor = infeasible.map((entry) =>
    explain(entry, 0, tiebroken, { tiebreakApplied: false, belowFloor: true }),
  )

  const negativeMarginCount = scored.filter((entry) =>
    Money.isNegative(entry.candidate.contributionMarginPoisha),
  ).length

  return { ranked, excludedByMarginFloor, negativeMarginCount }
}

interface ExplainFlags {
  readonly tiebreakApplied: boolean
  readonly belowFloor: boolean
}

type ScoredEntry = {
  readonly candidate: RankingCandidate
  readonly factors: FactorScores
  readonly boostPpm: Ppm
  readonly scorePpm: Ppm
}

/** Thresholds for narrative labels, expressed in PPM so they stay integers. */
const HIGHLY_RELIABLE_PPM = 900000n
const WELL_RATED_PPM = 800000n
const VERY_FRESH_PPM = 850000n
const NEARBY_METERS = 15000
const HARVESTED_TODAY_HOURS = 24

function explain(
  entry: ScoredEntry,
  rank: number,
  ordered: readonly ScoredEntry[],
  flags: ExplainFlags,
): RankedCandidate {
  const { candidate, factors, boostPpm, scorePpm } = entry
  const reasons: Reason[] = []
  const internalNotes: InternalNote[] = []

  const cheapest =
    ordered.length > 0 &&
    ordered.every(
      (other) => other.candidate.deliveredPricePerKgPoisha >= candidate.deliveredPricePerKgPoisha,
    )

  if (cheapest) {
    const runnerUp = ordered
      .filter((other) => other.candidate.listingId !== candidate.listingId)
      .reduce<bigint | null>(
        (best, other) =>
          best === null || other.candidate.deliveredPricePerKgPoisha < best
            ? other.candidate.deliveredPricePerKgPoisha
            : best,
        null,
      )

    reasons.push({
      code: 'CHEAPEST_DELIVERED',
      ...(runnerUp === null
        ? {}
        : {
            detail: {
              vsNextPoishaPerKg: Money.serialize(
                Money.subtract(
                  Money.fromPoisha(runnerUp),
                  Money.fromPoisha(candidate.deliveredPricePerKgPoisha),
                ),
              ),
            },
          }),
    })
  } else if (factors.price >= 900000n) {
    reasons.push({ code: 'GOOD_VALUE_DELIVERED' })
  }

  if (
    candidate.hoursSinceHarvestAtDelivery !== null &&
    candidate.hoursSinceHarvestAtDelivery <= HARVESTED_TODAY_HOURS
  ) {
    reasons.push({
      code: 'HARVESTED_TODAY',
      detail: { hoursSinceHarvest: Math.round(candidate.hoursSinceHarvestAtDelivery) },
    })
  } else if (factors.freshness >= VERY_FRESH_PPM) {
    reasons.push({ code: 'FRESHEST' })
  }

  if (candidate.distanceMeters > 0 && candidate.distanceMeters <= NEARBY_METERS) {
    reasons.push({
      code: 'NEARBY',
      detail: { distanceKm: Math.round(candidate.distanceMeters / 100) / 10 },
    })
  }

  if (factors.reliability >= HIGHLY_RELIABLE_PPM && candidate.acceptedOrders > 0) {
    reasons.push({
      code: 'HIGHLY_RELIABLE',
      detail: { completed: candidate.completedOrders, accepted: candidate.acceptedOrders },
    })
  }

  if (factors.rating >= WELL_RATED_PPM && candidate.ratingCount > 0) {
    reasons.push({ code: 'WELL_RATED', detail: { reviews: candidate.ratingCount } })
  }

  reasons.push(
    candidate.fullyCoversRequest ? { code: 'COVERS_FULL_QUANTITY' } : { code: 'PARTIAL_FILL_ONLY' },
  )

  if (boostPpm > 0n) {
    reasons.push({ code: 'NEW_FARMER' })
    internalNotes.push({
      code: 'NEW_FARMER_BOOST_APPLIED',
      detail: { boostPpm: boostPpm.toString() },
    })
  }

  if (Money.isNegative(candidate.contributionMarginPoisha)) {
    internalNotes.push({
      code: 'NEGATIVE_CONTRIBUTION_MARGIN',
      detail: { marginPoisha: Money.serialize(candidate.contributionMarginPoisha) },
    })
  }
  if (flags.belowFloor) {
    internalNotes.push({
      code: 'BELOW_MARGIN_FLOOR',
      detail: { marginPoisha: Money.serialize(candidate.contributionMarginPoisha) },
    })
  }
  if (flags.tiebreakApplied) {
    internalNotes.push({ code: 'TIEBREAK_APPLIED_ON_MARGIN' })
  }

  return {
    listingId: candidate.listingId,
    farmerProfileId: candidate.farmerProfileId,
    rank,
    scorePpm,
    factors,
    boostPpm,
    deliveredPricePerKgPoisha: candidate.deliveredPricePerKgPoisha,
    buyerTotalPoisha: candidate.buyerTotalPoisha,
    contributionMarginPoisha: candidate.contributionMarginPoisha,
    reasons,
    internalNotes,
  }
}

/** Strip Langgol-only fields before a ranked list is serialised to a client. */
export function toBuyerFacingRanking(
  ranked: readonly RankedCandidate[],
): readonly Omit<RankedCandidate, 'internalNotes' | 'contributionMarginPoisha'>[] {
  return ranked.map(({ internalNotes: _notes, contributionMarginPoisha: _margin, ...rest }) => rest)
}
