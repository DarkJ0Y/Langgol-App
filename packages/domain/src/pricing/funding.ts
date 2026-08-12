/**
 * Delivery funding models — who actually pays for delivery.
 *
 * Between the tariff and what the buyer is charged sits an explicit, recorded decision. Any
 * difference is a subsidy, and subsidies are never hidden inside product economics: a deliberate
 * discount is posted to ledger account `5020` with a **mandatory reason** from a controlled
 * vocabulary, so "why are we losing money?" is answerable in one query.
 *
 * ```text
 * split = applyFunding(tariff, model, context)
 * invariant: chargedToBuyer + fundedBySeller + fundedByRetailer + promotionalSubsidy == tariff
 * ```
 *
 * Refs: docs/04_MARKETPLACE.md §3.1; docs/06_FINANCIAL_ARCHITECTURE.md §5.7; docs/10 §9.3
 */

import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import { PricingError } from './errors.js'

export type DeliveryFundingModel =
  | 'COST_RECOVERING'
  | 'PROMOTIONAL_SUBSIDY'
  | 'FREE_DELIVERY'
  | 'RETAILER_FUNDED'
  | 'SELLER_FUNDED'
  | 'SHARED'

/**
 * The controlled vocabulary. Free text is not accepted — a vocabulary is what makes subsidy
 * spend queryable rather than anecdotal. docs/10_ECONOMIC_MEASUREMENT.md §9.3.
 */
export const SUBSIDY_REASONS = [
  'MARKET_SEEDING',
  'BASKET_SIZE_EXPERIMENT',
  'DELIVERY_MODEL_EXPERIMENT',
  'NEW_BUYER_ACQUISITION',
  'NEW_FARMER_ACTIVATION',
  'SERVICE_RECOVERY',
  'OPS_ERROR',
  'ROUTE_DENSITY_BUILD',
] as const

export type SubsidyReason = (typeof SUBSIDY_REASONS)[number]

export function isSubsidyReason(value: unknown): value is SubsidyReason {
  return typeof value === 'string' && (SUBSIDY_REASONS as readonly string[]).includes(value)
}

/** The models that spend platform money and therefore need a reason and budget headroom. */
const SUBSIDISING_MODELS: ReadonlySet<DeliveryFundingModel> = new Set([
  'PROMOTIONAL_SUBSIDY',
  'FREE_DELIVERY',
])

export function isSubsidisingModel(model: DeliveryFundingModel): boolean {
  return SUBSIDISING_MODELS.has(model)
}

export interface FundingContext {
  /** From `PlatformConfig['delivery.fundingModel.enabled']`. */
  readonly enabledModels: readonly DeliveryFundingModel[]
  /**
   * False once the pilot loss budget is exhausted (or unset — an unset budget means the controls
   * have nothing to enforce, so subsidy is refused rather than assumed affordable).
   */
  readonly subsidyBudgetAvailable: boolean
  /*
   * These are written `?: T | undefined` rather than `?: T` because the workspace enables
   * `exactOptionalPropertyTypes`. A caller assembling a context from optional inputs would
   * otherwise be unable to pass an explicit `undefined`, and would have to build the object by
   * conditional spread — which is exactly where a required field gets dropped by accident.
   */

  /** Mandatory for a subsidising model. Validated against the controlled vocabulary. */
  readonly subsidyReason?: string | null | undefined
  /** Required by `PROMOTIONAL_SUBSIDY`: how much of the tariff the platform absorbs. */
  readonly requestedSubsidyPoisha?: Poisha | undefined
  /** `SELLER_FUNDED` and `SHARED` require the farmer's explicit opt-in on the listing. */
  readonly sellerOffersFundedDelivery?: boolean | undefined
  /** `SHARED` only: the seller's agreed share of the tariff, in basis points. */
  readonly sellerShareBps?: number | undefined
}

export interface FundingSplit {
  readonly model: DeliveryFundingModel
  readonly tariffPoisha: Poisha
  readonly chargedToBuyerPoisha: Poisha
  readonly fundedBySellerPoisha: Poisha
  readonly fundedByRetailerPoisha: Poisha
  readonly promotionalSubsidyPoisha: Poisha
  readonly subsidyReason: SubsidyReason | null
}

function assertBalanced(split: FundingSplit): FundingSplit {
  const parts = Money.sum([
    split.chargedToBuyerPoisha,
    split.fundedBySellerPoisha,
    split.fundedByRetailerPoisha,
    split.promotionalSubsidyPoisha,
  ])
  if (!Money.equals(parts, split.tariffPoisha)) {
    throw new PricingError(
      'FUNDING_SPLIT_UNBALANCED',
      'Delivery funding split does not reconcile to the tariff',
      `parts=${Money.serialize(parts)} tariff=${Money.serialize(split.tariffPoisha)}`,
    )
  }
  return split
}

/**
 * Validate the subsidy preconditions shared by every subsidising model.
 *
 * Both checks are non-negotiable per docs/04 §3.1: a subsidising model cannot be selected
 * without a reason, and it is refused outright once the loss budget is spent.
 */
function requireSubsidyPreconditions(
  model: DeliveryFundingModel,
  context: FundingContext,
): SubsidyReason {
  if (!context.subsidyBudgetAvailable) {
    throw new PricingError(
      'SUBSIDY_BUDGET_EXHAUSTED',
      'The pilot loss budget is exhausted, so subsidised delivery is unavailable',
      `model=${model}. Cost-recovering, pickup, seller-funded and retailer-funded remain available.`,
    )
  }
  if (context.subsidyReason == null || context.subsidyReason === '') {
    throw new PricingError(
      'SUBSIDY_REASON_REQUIRED',
      'A subsidising delivery funding model requires a subsidy reason',
      `model=${model}`,
    )
  }
  if (!isSubsidyReason(context.subsidyReason)) {
    throw new PricingError(
      'SUBSIDY_REASON_UNKNOWN',
      'Subsidy reason is not in the controlled vocabulary',
      `reason=${context.subsidyReason}; allowed=${SUBSIDY_REASONS.join(', ')}`,
    )
  }
  return context.subsidyReason
}

/**
 * Split a tariff across the parties that fund it.
 *
 * **Rounding decision for `SHARED`:** the seller's share is computed exactly from the agreed
 * basis points and the buyer pays the remainder of the tariff. The residual poisha therefore
 * never lands on the farmer, who agreed to a ratio rather than to an amount — docs/04 §3.1
 * rule 3, "Langgol never assigns a cost to a farmer on their behalf" — and the buyer always sees
 * the exact figure they are charged, per rule 4.
 */
export function applyFunding(
  tariffPoisha: Poisha,
  model: DeliveryFundingModel,
  context: FundingContext,
): FundingSplit {
  Money.requireNonNegative(tariffPoisha, 'Delivery tariff')

  if (!context.enabledModels.includes(model)) {
    throw new PricingError(
      'FUNDING_MODEL_DISABLED',
      'This delivery funding model is not enabled',
      `model=${model}; enabled=${context.enabledModels.join(', ')}`,
    )
  }

  const base = {
    model,
    tariffPoisha,
    chargedToBuyerPoisha: Money.zero,
    fundedBySellerPoisha: Money.zero,
    fundedByRetailerPoisha: Money.zero,
    promotionalSubsidyPoisha: Money.zero,
    subsidyReason: null,
  } satisfies FundingSplit

  switch (model) {
    case 'COST_RECOVERING':
      return assertBalanced({ ...base, chargedToBuyerPoisha: tariffPoisha })

    case 'FREE_DELIVERY': {
      const reason = requireSubsidyPreconditions(model, context)
      return assertBalanced({
        ...base,
        promotionalSubsidyPoisha: tariffPoisha,
        subsidyReason: reason,
      })
    }

    case 'PROMOTIONAL_SUBSIDY': {
      const reason = requireSubsidyPreconditions(model, context)
      const requested = context.requestedSubsidyPoisha
      if (requested === undefined) {
        throw new PricingError(
          'INVALID_INPUT',
          'PROMOTIONAL_SUBSIDY requires the subsidy amount to be stated explicitly',
        )
      }
      Money.requireNonNegative(requested, 'Promotional subsidy')
      if (Money.compare(requested, tariffPoisha) > 0) {
        throw new PricingError(
          'INVALID_INPUT',
          'Promotional subsidy cannot exceed the tariff; use FREE_DELIVERY instead',
          `subsidy=${Money.serialize(requested)} tariff=${Money.serialize(tariffPoisha)}`,
        )
      }
      return assertBalanced({
        ...base,
        chargedToBuyerPoisha: Money.subtract(tariffPoisha, requested),
        promotionalSubsidyPoisha: requested,
        subsidyReason: reason,
      })
    }

    case 'RETAILER_FUNDED':
      // The retailer settles delivery directly. Amounts above tariff are delivery revenue rather
      // than part of this split, and are deferred with the retailer-billing work (docs/04 §3.1).
      return assertBalanced({ ...base, fundedByRetailerPoisha: tariffPoisha })

    case 'SELLER_FUNDED': {
      if (context.sellerOffersFundedDelivery !== true) {
        throw new PricingError(
          'SELLER_FUNDING_NOT_OFFERED',
          'This farmer has not opted in to funding delivery on this listing',
        )
      }
      return assertBalanced({ ...base, fundedBySellerPoisha: tariffPoisha })
    }

    case 'SHARED': {
      if (context.sellerOffersFundedDelivery !== true) {
        throw new PricingError(
          'SELLER_FUNDING_NOT_OFFERED',
          'A shared delivery split requires the farmer to have opted in on this listing',
        )
      }
      const shareBps = context.sellerShareBps
      if (
        shareBps === undefined ||
        !Number.isInteger(shareBps) ||
        shareBps < 0 ||
        shareBps > 10000
      ) {
        throw new PricingError(
          'INVALID_INPUT',
          'SHARED funding requires an explicit seller share in basis points (0–10000)',
          `sellerShareBps=${String(shareBps)}`,
        )
      }
      const fundedBySellerPoisha = Money.percentBps(tariffPoisha, shareBps)
      return assertBalanced({
        ...base,
        fundedBySellerPoisha,
        chargedToBuyerPoisha: Money.subtract(tariffPoisha, fundedBySellerPoisha),
      })
    }
  }
}
