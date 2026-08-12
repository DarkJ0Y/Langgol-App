export { PricingError, type PricingErrorCode } from './errors.js'

export {
  chargeableWeightMilligrams,
  computeTariff,
  selectBand,
  type ChargeableWeightInput,
  type TariffBand,
  type TariffConfig,
  type TariffQuote,
} from './tariff.js'

export {
  applyFunding,
  isSubsidisingModel,
  isSubsidyReason,
  SUBSIDY_REASONS,
  type DeliveryFundingModel,
  type FundingContext,
  type FundingSplit,
  type SubsidyReason,
} from './funding.js'

export {
  allocateTripCost,
  computeContributionMargin,
  computeLanggolCost,
  computePaymentCost,
  computeSpoilageCost,
  computeTripCost,
  type AllocationInput,
  type ContributionMargin,
  type ContributionMarginInput,
  type FulfilmentCostConfig,
  type InternalCostConfig,
  type LanggolCost,
  type LanggolCostInput,
  type PaymentCostConfig,
  type PerishabilityClass,
  type SpoilageConfig,
  type TripCostInput,
  type VehicleCostProfile,
} from './internal-cost.js'

export {
  computeBreakdown,
  computeLineTotal,
  PRICING_VERSION,
  type Breakdown,
  type BreakdownInput,
  type BuyerBreakdown,
  type FulfilmentMode,
  type InternalBreakdown,
  type QuoteLine,
  type QuoteLineInput,
  type SellerBreakdown,
} from './breakdown.js'

export {
  serializeBreakdown,
  toBuyerFacing,
  type SerializedBreakdown,
  type SerializedBuyerBreakdown,
  type SerializedInternalBreakdown,
  type SerializedLine,
  type SerializedSellerBreakdown,
} from './serialize.js'

import * as breakdown from './breakdown.js'
import * as funding from './funding.js'
import * as internalCost from './internal-cost.js'
import * as serialize from './serialize.js'
import * as tariff from './tariff.js'

/** Namespace object: `Pricing.computeBreakdown(input, config)`. */
export const Pricing = {
  ...tariff,
  ...funding,
  ...internalCost,
  ...breakdown,
  ...serialize,
} as const
