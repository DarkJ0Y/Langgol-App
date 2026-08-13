/**
 * Ledger tests.
 *
 * These reproduce the worked journals in docs/06_FINANCIAL_ARCHITECTURE.md §5 line by line, and
 * assert the property the whole financial layer rests on: **every transaction balances, in every
 * funding model**. An unbalanced ledger is not recoverable after the fact, so it is tested rather
 * than trusted.
 */

import { describe, expect, it } from 'vitest'
import * as Money from '../money/money.js'
import {
  buildJournal,
  journalForAgentRemittance,
  journalForGoodsDelivered,
  journalForOrderPlaced,
  journalForSettlement,
  journalForTripCost,
  journalTotal,
  LedgerError,
  type Journal,
  type OrderJournalInput,
} from './journal.js'
import { CHART_OF_ACCOUNTS, isAccountCode } from './accounts.js'

/** The docs/06 §5 worked example: produce ৳150, delivery ৳96, handling ৳10, total ৳256. */
function order(overrides: Partial<OrderJournalInput> = {}): OrderJournalInput {
  return {
    orderId: 'order-1',
    farmerProfileId: 'farmer-rahim',
    buyerUserId: 'buyer-1',
    agentId: 'agent-karim',
    paymentMethod: 'CASH_ON_DELIVERY',
    sellerGrossPoisha: Money.fromTaka('150.00'),
    commissionPoisha: Money.fromTaka('4.50'),
    sellerNetPoisha: Money.fromTaka('145.50'),
    handlingFeePoisha: Money.fromTaka('10.00'),
    platformFeePoisha: Money.zero,
    buyerTotalPoisha: Money.fromTaka('256.00'),
    deliveryTariffPoisha: Money.fromTaka('96.00'),
    deliveryChargedToBuyerPoisha: Money.fromTaka('96.00'),
    deliveryFundedBySellerPoisha: Money.zero,
    deliveryFundedByRetailerPoisha: Money.zero,
    promotionalSubsidyPoisha: Money.zero,
    subsidyReason: null,
    ...overrides,
  }
}

function balances(journal: Journal): boolean {
  return Money.equals(journalTotal(journal, 'DEBIT'), journalTotal(journal, 'CREDIT'))
}

function amountOn(journal: Journal, accountCode: string, direction: 'DEBIT' | 'CREDIT'): string {
  const total = Money.sum(
    journal.lines
      .filter((line) => line.accountCode === accountCode && line.direction === direction)
      .map((line) => line.amountPoisha),
  )
  return Money.toTakaString(total)
}

describe('the chart of accounts', () => {
  it('matches docs/06 §3', () => {
    // 4 asset + 5 liability + 4 revenue + 6 expense.
    expect(CHART_OF_ACCOUNTS).toHaveLength(19)
    for (const code of ['1000', '1020', '2000', '4000', '4010', '4020', '5000', '5020']) {
      expect(isAccountCode(code)).toBe(true)
    }
    expect(isAccountCode('9999')).toBe(false)
  })

  it('has no duplicate codes', () => {
    const codes = CHART_OF_ACCOUNTS.map((account) => account.code)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('buildJournal', () => {
  it('refuses an unbalanced journal', () => {
    expect(() =>
      buildJournal('TEST:1', 'unbalanced', [
        {
          accountCode: '1000',
          ownerId: null,
          ownerType: 'PLATFORM',
          direction: 'DEBIT',
          amountPoisha: Money.fromTaka('10.00'),
          memo: 'x',
        },
        {
          accountCode: '2000',
          ownerId: null,
          ownerType: 'PLATFORM',
          direction: 'CREDIT',
          amountPoisha: Money.fromTaka('9.99'),
          memo: 'y',
        },
      ]),
    ).toThrow(expect.objectContaining({ code: 'UNBALANCED' }))
  })

  it('refuses a negative amount — direction carries the sign, not the number', () => {
    expect(() =>
      buildJournal('TEST:2', 'negative', [
        {
          accountCode: '1000',
          ownerId: null,
          ownerType: 'PLATFORM',
          direction: 'DEBIT',
          amountPoisha: Money.fromTaka('-10.00'),
          memo: 'x',
        },
      ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AMOUNT' }))
  })

  it('drops zero lines but refuses a journal that is entirely zero', () => {
    expect(() =>
      buildJournal('TEST:3', 'empty', [
        {
          accountCode: '1000',
          ownerId: null,
          ownerType: 'PLATFORM',
          direction: 'DEBIT',
          amountPoisha: Money.zero,
          memo: 'x',
        },
      ]),
    ).toThrow(expect.objectContaining({ code: 'EMPTY_JOURNAL' }))
  })
})

describe('docs/06 §5.1 — cash on delivery', () => {
  it('posts nothing when a COD order is placed: economically nothing has happened', () => {
    expect(journalForOrderPlaced(order())).toBeNull()
  })

  it('reproduces the GOODS_DELIVERED journal exactly', () => {
    const journal = journalForGoodsDelivered(order())

    expect(balances(journal)).toBe(true)
    expect(amountOn(journal, '1020', 'DEBIT')).toBe('256.00')
    expect(amountOn(journal, '2000', 'CREDIT')).toBe('145.50')
    expect(amountOn(journal, '4000', 'CREDIT')).toBe('4.50')
    expect(amountOn(journal, '4010', 'CREDIT')).toBe('96.00')
    expect(amountOn(journal, '4020', 'CREDIT')).toBe('10.00')
    expect(journal.idempotencyKey).toBe('ORDER:order-1:GOODS_DELIVERED')
  })

  it('reproduces the agent remittance', () => {
    const journal = journalForAgentRemittance({
      remittanceId: 'rem-1',
      agentId: 'agent-karim',
      amountPoisha: Money.fromTaka('256.00'),
    })
    expect(balances(journal)).toBe(true)
    expect(amountOn(journal, '1000', 'DEBIT')).toBe('256.00')
    expect(amountOn(journal, '1020', 'CREDIT')).toBe('256.00')
  })

  it('reproduces the ৳180 actual delivery cost', () => {
    const journal = journalForTripCost({
      tripId: 'trip-1',
      actualCostPoisha: Money.fromTaka('180.00'),
    })
    expect(balances(journal)).toBe(true)
    expect(amountOn(journal, '5000', 'DEBIT')).toBe('180.00')
    // ৳96 revenue against ৳180 cost is an ৳84 loss on this leg, and it is visible as such.
  })

  it('reproduces the settlement to the farmer', () => {
    const journal = journalForSettlement({
      settlementId: 'stl-1',
      farmerProfileId: 'farmer-rahim',
      amountPoisha: Money.fromTaka('145.50'),
    })
    expect(balances(journal)).toBe(true)
    expect(amountOn(journal, '2000', 'DEBIT')).toBe('145.50')
    expect(amountOn(journal, '1000', 'CREDIT')).toBe('145.50')
  })
})

describe('docs/06 §5.2 — prepaid, built to the interface but disabled at launch', () => {
  it('holds the buyer money as a liability, net of the provider fee', () => {
    const journal = journalForOrderPlaced(order({ paymentMethod: 'MFS' }), Money.fromTaka('3.84'))!
    expect(balances(journal)).toBe(true)
    expect(amountOn(journal, '1030', 'DEBIT')).toBe('252.16')
    expect(amountOn(journal, '5010', 'DEBIT')).toBe('3.84')
    // The buyer's money is a liability, not revenue, until delivery. This is escrow.
    expect(amountOn(journal, '2010', 'CREDIT')).toBe('256.00')
  })

  it('releases the liability on delivery rather than taking cash', () => {
    const journal = journalForGoodsDelivered(order({ paymentMethod: 'MFS' }))
    expect(balances(journal)).toBe(true)
    expect(amountOn(journal, '2010', 'DEBIT')).toBe('256.00')
    expect(amountOn(journal, '1020', 'DEBIT')).toBe('0.00')
  })
})

describe('docs/06 §5.7 — every funding model balances and credits 4010 the full tariff', () => {
  const tariff = Money.fromTaka('96.00')

  const models: [string, Partial<OrderJournalInput>][] = [
    ['COST_RECOVERING', {}],
    [
      'PROMOTIONAL_SUBSIDY',
      {
        deliveryChargedToBuyerPoisha: Money.fromTaka('50.00'),
        promotionalSubsidyPoisha: Money.fromTaka('46.00'),
        subsidyReason: 'MARKET_SEEDING',
        buyerTotalPoisha: Money.fromTaka('210.00'),
      },
    ],
    [
      'FREE_DELIVERY',
      {
        deliveryChargedToBuyerPoisha: Money.zero,
        promotionalSubsidyPoisha: tariff,
        subsidyReason: 'NEW_BUYER_ACQUISITION',
        buyerTotalPoisha: Money.fromTaka('160.00'),
      },
    ],
    [
      'SELLER_FUNDED',
      {
        deliveryChargedToBuyerPoisha: Money.zero,
        deliveryFundedBySellerPoisha: tariff,
        sellerNetPoisha: Money.fromTaka('49.50'),
        buyerTotalPoisha: Money.fromTaka('160.00'),
      },
    ],
    [
      'RETAILER_FUNDED',
      {
        deliveryChargedToBuyerPoisha: Money.zero,
        deliveryFundedByRetailerPoisha: tariff,
        buyerTotalPoisha: Money.fromTaka('160.00'),
      },
    ],
    [
      'SHARED',
      {
        deliveryChargedToBuyerPoisha: Money.fromTaka('48.00'),
        deliveryFundedBySellerPoisha: Money.fromTaka('48.00'),
        sellerNetPoisha: Money.fromTaka('97.50'),
        buyerTotalPoisha: Money.fromTaka('208.00'),
      },
    ],
  ]

  for (const [name, overrides] of models) {
    it(`${name} balances`, () => {
      const journal = journalForGoodsDelivered(order(overrides))
      expect(balances(journal)).toBe(true)
    })

    it(`${name} credits delivery revenue the FULL tariff`, () => {
      // "Revenue is recognised at the full tariff and the discount is an explicit expense."
      const journal = journalForGoodsDelivered(order(overrides))
      expect(amountOn(journal, '4010', 'CREDIT')).toBe('96.00')
    })
  }

  it('books a promotional subsidy to 5020 with its reason, not as reduced revenue', () => {
    const journal = journalForGoodsDelivered(
      order({
        deliveryChargedToBuyerPoisha: Money.fromTaka('50.00'),
        promotionalSubsidyPoisha: Money.fromTaka('46.00'),
        subsidyReason: 'MARKET_SEEDING',
        buyerTotalPoisha: Money.fromTaka('210.00'),
      }),
    )
    expect(amountOn(journal, '5020', 'DEBIT')).toBe('46.00')
    const subsidyLine = journal.lines.find((line) => line.accountCode === '5020')
    expect(subsidyLine?.memo).toContain('MARKET_SEEDING')
  })
})

describe('guard rails', () => {
  it('refuses a buyer-side platform fee, which has no revenue account at MVP', () => {
    expect(() =>
      journalForGoodsDelivered(
        order({
          platformFeePoisha: Money.fromTaka('5.00'),
          buyerTotalPoisha: Money.fromTaka('261.00'),
        }),
      ),
    ).toThrow(LedgerError)
  })

  it('gives every journal a deterministic idempotency key derived from the event', () => {
    // Layer 2 of docs/06 §7: the unique constraint makes a duplicate posting impossible even if
    // the application layer is wrong.
    expect(journalForGoodsDelivered(order()).idempotencyKey).toBe(
      journalForGoodsDelivered(order()).idempotencyKey,
    )
    expect(
      journalForTripCost({ tripId: 't1', actualCostPoisha: Money.fromTaka('1.00') }).idempotencyKey,
    ).toBe('TRIP:t1:COST')
  })

  it('only ever references accounts that exist in the chart', () => {
    const journal = journalForGoodsDelivered(order())
    for (const line of journal.lines) {
      expect(isAccountCode(line.accountCode)).toBe(true)
    }
  })
})
