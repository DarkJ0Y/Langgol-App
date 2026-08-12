/**
 * Delivery funding tests.
 *
 * The invariant `chargedToBuyer + fundedBySeller + fundedByRetailer + promotionalSubsidy ==
 * tariff` is asserted across every model, because it is the property the ledger relies on: `4010`
 * is always credited the full tariff, and any shortfall is an explicit, named expense.
 *
 * Refs: docs/04_MARKETPLACE.md §3.1; docs/06_FINANCIAL_ARCHITECTURE.md §5.7
 */

import { describe, expect, it } from 'vitest'
import * as Money from '../money/money.js'
import { applyFunding, isSubsidyReason, SUBSIDY_REASONS } from './funding.js'
import type { DeliveryFundingModel, FundingContext, FundingSplit } from './funding.js'

const TARIFF = Money.fromTaka('96.00')

const ALL_MODELS: readonly DeliveryFundingModel[] = [
  'COST_RECOVERING',
  'PROMOTIONAL_SUBSIDY',
  'FREE_DELIVERY',
  'RETAILER_FUNDED',
  'SELLER_FUNDED',
  'SHARED',
]

function context(overrides: Partial<FundingContext> = {}): FundingContext {
  return {
    enabledModels: ALL_MODELS,
    subsidyBudgetAvailable: true,
    subsidyReason: 'MARKET_SEEDING',
    requestedSubsidyPoisha: Money.fromTaka('46.00'),
    sellerOffersFundedDelivery: true,
    sellerShareBps: 5000,
    ...overrides,
  }
}

function total(split: FundingSplit): bigint {
  return Money.sum([
    split.chargedToBuyerPoisha,
    split.fundedBySellerPoisha,
    split.fundedByRetailerPoisha,
    split.promotionalSubsidyPoisha,
  ])
}

describe('the funding invariant holds for every model', () => {
  for (const model of ALL_MODELS) {
    it(`${model}: parts sum exactly to the tariff`, () => {
      expect(total(applyFunding(TARIFF, model, context()))).toBe(TARIFF)
    })
  }
})

describe('individual models', () => {
  it('COST_RECOVERING charges the buyer the full tariff', () => {
    const split = applyFunding(TARIFF, 'COST_RECOVERING', context())
    expect(Money.toTakaString(split.chargedToBuyerPoisha)).toBe('96.00')
    expect(split.subsidyReason).toBeNull()
  })

  it('PROMOTIONAL_SUBSIDY charges the buyer the tariff less the subsidy — docs/06 §5.7', () => {
    const split = applyFunding(TARIFF, 'PROMOTIONAL_SUBSIDY', context())
    expect(Money.toTakaString(split.chargedToBuyerPoisha)).toBe('50.00')
    expect(Money.toTakaString(split.promotionalSubsidyPoisha)).toBe('46.00')
    expect(split.subsidyReason).toBe('MARKET_SEEDING')
  })

  it('FREE_DELIVERY charges the buyer nothing and books the whole tariff as subsidy', () => {
    const split = applyFunding(TARIFF, 'FREE_DELIVERY', context())
    expect(Money.isZero(split.chargedToBuyerPoisha)).toBe(true)
    expect(Money.toTakaString(split.promotionalSubsidyPoisha)).toBe('96.00')
  })

  it('SELLER_FUNDED moves the whole tariff onto the farmer who opted in', () => {
    const split = applyFunding(TARIFF, 'SELLER_FUNDED', context())
    expect(Money.toTakaString(split.fundedBySellerPoisha)).toBe('96.00')
    expect(Money.isZero(split.chargedToBuyerPoisha)).toBe(true)
  })

  it('RETAILER_FUNDED books the tariff against the retailer', () => {
    const split = applyFunding(TARIFF, 'RETAILER_FUNDED', context())
    expect(Money.toTakaString(split.fundedByRetailerPoisha)).toBe('96.00')
  })

  it('SHARED splits by the agreed basis points', () => {
    const split = applyFunding(TARIFF, 'SHARED', context({ sellerShareBps: 2500 }))
    expect(Money.toTakaString(split.fundedBySellerPoisha)).toBe('24.00')
    expect(Money.toTakaString(split.chargedToBuyerPoisha)).toBe('72.00')
  })

  it('SHARED never rounds a residual poisha onto the farmer', () => {
    // ৳0.99 at 33.33% does not divide evenly. The farmer pays exactly their agreed ratio and the
    // buyer covers the remainder — docs/04 §3.1 rule 3.
    const odd = Money.fromTaka('0.99')
    const split = applyFunding(odd, 'SHARED', context({ sellerShareBps: 3333 }))
    expect(total(split)).toBe(odd)
    expect(split.fundedBySellerPoisha).toBe(Money.percentBps(odd, 3333))
  })
})

describe('subsidy is never unexplained', () => {
  it('refuses a subsidising model with no reason', () => {
    expect(() => applyFunding(TARIFF, 'FREE_DELIVERY', context({ subsidyReason: null }))).toThrow(
      expect.objectContaining({ code: 'SUBSIDY_REASON_REQUIRED' }),
    )
  })

  it('refuses a reason outside the controlled vocabulary', () => {
    expect(() =>
      applyFunding(
        TARIFF,
        'FREE_DELIVERY',
        context({ subsidyReason: 'because marketing said so' }),
      ),
    ).toThrow(expect.objectContaining({ code: 'SUBSIDY_REASON_UNKNOWN' }))
  })

  it('accepts every reason in the controlled vocabulary and nothing else', () => {
    for (const reason of SUBSIDY_REASONS) expect(isSubsidyReason(reason)).toBe(true)
    expect(isSubsidyReason('MARKETING')).toBe(false)
    expect(isSubsidyReason(42)).toBe(false)
  })

  it('does NOT require a reason for a non-subsidising model', () => {
    expect(() =>
      applyFunding(TARIFF, 'COST_RECOVERING', context({ subsidyReason: null })),
    ).not.toThrow()
  })
})

describe('the pilot loss budget is a hard gate in the quoting path', () => {
  it('refuses subsidising models when the budget is exhausted', () => {
    for (const model of ['PROMOTIONAL_SUBSIDY', 'FREE_DELIVERY'] as const) {
      expect(() => applyFunding(TARIFF, model, context({ subsidyBudgetAvailable: false }))).toThrow(
        expect.objectContaining({ code: 'SUBSIDY_BUDGET_EXHAUSTED' }),
      )
    }
  })

  it('keeps the marketplace working on every non-subsidising model', () => {
    // docs/06 §6.1: the marketplace stops paying for itself to be used; it does not stop.
    for (const model of [
      'COST_RECOVERING',
      'RETAILER_FUNDED',
      'SELLER_FUNDED',
      'SHARED',
    ] as const) {
      expect(() =>
        applyFunding(TARIFF, model, context({ subsidyBudgetAvailable: false })),
      ).not.toThrow()
    }
  })
})

describe('guard rails', () => {
  it('refuses a model that is not enabled', () => {
    expect(() =>
      applyFunding(TARIFF, 'FREE_DELIVERY', context({ enabledModels: ['COST_RECOVERING'] })),
    ).toThrow(expect.objectContaining({ code: 'FUNDING_MODEL_DISABLED' }))
  })

  it('refuses SELLER_FUNDED without the farmer opting in', () => {
    expect(() =>
      applyFunding(TARIFF, 'SELLER_FUNDED', context({ sellerOffersFundedDelivery: false })),
    ).toThrow(expect.objectContaining({ code: 'SELLER_FUNDING_NOT_OFFERED' }))
  })

  it('refuses SHARED without the farmer opting in', () => {
    expect(() =>
      applyFunding(TARIFF, 'SHARED', context({ sellerOffersFundedDelivery: false })),
    ).toThrow(expect.objectContaining({ code: 'SELLER_FUNDING_NOT_OFFERED' }))
  })

  it('refuses a subsidy larger than the tariff', () => {
    expect(() =>
      applyFunding(TARIFF, 'PROMOTIONAL_SUBSIDY', {
        ...context(),
        requestedSubsidyPoisha: Money.fromTaka('120.00'),
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })

  it('refuses a SHARED split without an explicit ratio', () => {
    expect(() =>
      applyFunding(TARIFF, 'SHARED', { ...context(), sellerShareBps: undefined }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })
})
