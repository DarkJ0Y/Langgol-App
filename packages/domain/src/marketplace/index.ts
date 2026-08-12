export type {
  InternalNote,
  InternalNoteCode,
  Reason,
  ReasonCode,
  ReasonDetail,
} from './rationale.js'

export {
  combineScores,
  freshnessScore,
  newFarmerBoost,
  PPM,
  priceScore,
  quantityFitScore,
  ratingScore,
  reliabilityScore,
  speedScore,
  type FactorScores,
  type Ppm,
  type RankingWeightsBps,
} from './scoring.js'

export {
  rankCandidates,
  toBuyerFacingRanking,
  type RankedCandidate,
  type RankingCandidate,
  type RankingResult,
} from './rank.js'

import * as rank from './rank.js'
import * as scoring from './scoring.js'

/** Namespace object: `Marketplace.rankCandidates(candidates, config)`. */
export const Marketplace = { ...scoring, ...rank } as const
