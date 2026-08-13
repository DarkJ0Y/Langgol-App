/**
 * Journal construction — every money movement in Langgol, as balanced double entry.
 *
 * These are **pure functions from a business event to a balanced journal**. They perform no I/O,
 * read no configuration beyond what is passed in, and never invent an amount: every figure comes
 * from the order, which got it from the quote.
 *
 * Two rules are enforced here rather than hoped for:
 *
 *  1. **Every transaction balances.** `buildJournal` refuses to return an unbalanced result, and
 *     the database repeats the check with a deferred constraint trigger. Belt and braces, because
 *     an unbalanced ledger is not recoverable after the fact.
 *  2. **Every transaction carries a deterministic idempotency key** derived from the business
 *     event (`ORDER:<id>:GOODS_DELIVERED`). The unique constraint on that key makes a duplicate
 *     posting impossible even when the application layer is wrong — which is the layer that
 *     actually protects the books.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §5, §7
 */

import * as Money from '../money/money.js'
import type { Poisha } from '../money/types.js'
import type { AccountOwnerType } from './accounts.js'

export class LedgerError extends Error {
  readonly code: 'UNBALANCED' | 'INVALID_AMOUNT' | 'EMPTY_JOURNAL'

  constructor(code: 'UNBALANCED' | 'INVALID_AMOUNT' | 'EMPTY_JOURNAL', message: string) {
    super(message)
    this.name = 'LedgerError'
    this.code = code
  }
}

export type Direction = 'DEBIT' | 'CREDIT'

export interface JournalLine {
  readonly accountCode: string
  /** Null for a platform-owned account; a farmer, buyer, agent or provider id otherwise. */
  readonly ownerId: string | null
  readonly ownerType: AccountOwnerType
  readonly direction: Direction
  readonly amountPoisha: Poisha
  readonly memo: string
}

export interface Journal {
  /** Deterministic, derived from the business event. The unique key that prevents double posting. */
  readonly idempotencyKey: string
  readonly description: string
  readonly lines: readonly JournalLine[]
}

function debit(
  accountCode: string,
  ownerType: AccountOwnerType,
  ownerId: string | null,
  amountPoisha: Poisha,
  memo: string,
): JournalLine {
  return { accountCode, ownerId, ownerType, direction: 'DEBIT', amountPoisha, memo }
}

function credit(
  accountCode: string,
  ownerType: AccountOwnerType,
  ownerId: string | null,
  amountPoisha: Poisha,
  memo: string,
): JournalLine {
  return { accountCode, ownerId, ownerType, direction: 'CREDIT', amountPoisha, memo }
}

/**
 * Assemble a journal, dropping zero-value lines and refusing anything that does not balance.
 *
 * Zero lines are dropped rather than rejected because a legitimate journal often has an optional
 * component — a subsidy of zero under `COST_RECOVERING`, a handling fee of zero on pickup — and
 * writing `amount > 0` rows only keeps the ledger readable. The database CHECK requires every
 * stored entry to be strictly positive.
 */
export function buildJournal(
  idempotencyKey: string,
  description: string,
  lines: readonly JournalLine[],
): Journal {
  const meaningful = lines.filter((line) => !Money.isZero(line.amountPoisha))

  for (const line of meaningful) {
    if (Money.isNegative(line.amountPoisha)) {
      throw new LedgerError(
        'INVALID_AMOUNT',
        `Ledger amounts are always positive; direction carries the sign. ` +
          `Account ${line.accountCode} had ${Money.serialize(line.amountPoisha)}`,
      )
    }
  }

  if (meaningful.length === 0) {
    throw new LedgerError('EMPTY_JOURNAL', `Journal ${idempotencyKey} has no non-zero lines`)
  }

  const debits = Money.sum(
    meaningful.filter((line) => line.direction === 'DEBIT').map((line) => line.amountPoisha),
  )
  const credits = Money.sum(
    meaningful.filter((line) => line.direction === 'CREDIT').map((line) => line.amountPoisha),
  )

  if (!Money.equals(debits, credits)) {
    throw new LedgerError(
      'UNBALANCED',
      `Journal ${idempotencyKey} does not balance: ` +
        `debits=${Money.serialize(debits)} credits=${Money.serialize(credits)}`,
    )
  }

  return { idempotencyKey, description, lines: meaningful }
}

/** Sum of one side of a journal. Used by callers that need the transaction total. */
export function journalTotal(journal: Journal, direction: Direction): Poisha {
  return Money.sum(
    journal.lines.filter((line) => line.direction === direction).map((line) => line.amountPoisha),
  )
}

/* ------------------------------------------------------------------ order lifecycle */

export interface OrderJournalInput {
  readonly orderId: string
  readonly farmerProfileId: string
  readonly buyerUserId: string
  /** The COD collecting agent. Null until one is assigned. */
  readonly agentId: string | null
  readonly paymentMethod: string

  readonly sellerGrossPoisha: Poisha
  readonly commissionPoisha: Poisha
  readonly sellerNetPoisha: Poisha
  readonly handlingFeePoisha: Poisha
  readonly platformFeePoisha: Poisha
  readonly buyerTotalPoisha: Poisha

  /** The full cost-recovering price. Revenue is always recognised at this figure. */
  readonly deliveryTariffPoisha: Poisha
  readonly deliveryChargedToBuyerPoisha: Poisha
  readonly deliveryFundedBySellerPoisha: Poisha
  readonly deliveryFundedByRetailerPoisha: Poisha
  readonly promotionalSubsidyPoisha: Poisha
  readonly subsidyReason: string | null
}

/**
 * Order placed.
 *
 * For COD this is deliberately **empty** — economically nothing has happened yet. The commitment
 * lives in the order record, not in the ledger. Writing a journal here would recognise revenue
 * before the goods moved.
 *
 * Returns `null` rather than an empty journal so a caller cannot accidentally post nothing and
 * believe it posted something.
 *
 * Refs: docs/06 §5.1
 */
export function journalForOrderPlaced(
  input: OrderJournalInput,
  /** What the provider keeps out of the captured amount. Not returned on a refund (docs/06 §5.3). */
  providerFeePoisha: Poisha = Money.zero,
): Journal | null {
  if (input.paymentMethod === 'CASH_ON_DELIVERY') return null

  // Prepaid: the buyer's money is a LIABILITY until delivery. This is escrow, in accounting form.
  // Built and tested now so that enabling prepaid later is a configuration change with a known
  // ledger shape rather than a financial design under time pressure. docs/06 §5.2, D4.
  //
  // The provider settles net, so the receivable is the captured amount less its fee.
  return buildJournal(
    `ORDER:${input.orderId}:PREPAYMENT_HELD`,
    'Buyer prepayment held pending delivery',
    [
      debit(
        '1030',
        'PROVIDER',
        null,
        Money.subtract(input.buyerTotalPoisha, providerFeePoisha),
        'Receivable from payment provider, net of fee',
      ),
      debit('5010', 'PLATFORM', null, providerFeePoisha, 'Payment processing cost'),
      credit('2010', 'BUYER', input.buyerUserId, input.buyerTotalPoisha, 'Buyer prepayment held'),
    ],
  )
}

/**
 * Goods delivered — the journal that recognises the transaction.
 *
 * Delivery revenue is credited at the **full tariff** in every funding model, and any shortfall
 * appears as an explicit expense in `5020`. That is what makes "how much are we paying for this
 * order?" answerable in one query instead of inferable from a gap between two numbers.
 *
 * Refs: docs/06 §5.1, §5.7
 */
export function journalForGoodsDelivered(input: OrderJournalInput): Journal {
  /*
   * docs/06 §4: there is NO buyer-side marketplace fee at MVP, so the chart of accounts has no
   * account to credit one to. Rather than let a non-zero value fall through and surface as a
   * confusing "journal does not balance", say plainly what is missing. Introducing a buyer-side
   * fee is a product decision that requires a revenue account first.
   */
  if (!Money.isZero(input.platformFeePoisha)) {
    throw new LedgerError(
      'INVALID_AMOUNT',
      'A non-zero buyer-side platform fee has no revenue account in the chart of accounts. ' +
        'docs/06_FINANCIAL_ARCHITECTURE.md §4 states there is no buyer-side marketplace fee at ' +
        'MVP; add an account to CHART_OF_ACCOUNTS before charging one.',
    )
  }

  const lines: JournalLine[] = []

  const prepaid = input.paymentMethod !== 'CASH_ON_DELIVERY'
  // What the buyer actually hands over: produce + delivery charged + handling + platform fee.
  const cashFromBuyer = input.buyerTotalPoisha

  if (prepaid) {
    lines.push(debit('2010', 'BUYER', input.buyerUserId, cashFromBuyer, 'Release buyer prepayment'))
  } else {
    lines.push(debit('1020', 'AGENT', input.agentId, cashFromBuyer, 'Cash collected on delivery'))
  }

  // A seller funding delivery reduces their payable; the farmer's net already reflects it.
  lines.push(
    credit('2000', 'FARMER', input.farmerProfileId, input.sellerNetPoisha, 'Payable to farmer'),
    credit('4000', 'PLATFORM', null, input.commissionPoisha, 'Commission revenue'),
    credit('4010', 'PLATFORM', null, input.deliveryTariffPoisha, 'Delivery fee revenue at tariff'),
    credit('4020', 'PLATFORM', null, input.handlingFeePoisha, 'Handling fee revenue'),
  )

  // The subsidy is an expense, not reduced revenue. docs/06 §5.7.
  lines.push(
    debit(
      '5020',
      'PLATFORM',
      null,
      input.promotionalSubsidyPoisha,
      `Delivery subsidy${input.subsidyReason === null ? '' : ` (${input.subsidyReason})`}`,
    ),
  )

  // A retailer settling delivery directly is cash Langgol receives outside the buyer total.
  lines.push(
    debit(
      '1020',
      'AGENT',
      input.agentId,
      input.deliveryFundedByRetailerPoisha,
      'Delivery funded directly by retailer',
    ),
  )

  return buildJournal(
    `ORDER:${input.orderId}:GOODS_DELIVERED`,
    'Goods delivered and transaction recognised',
    lines,
  )
}

/**
 * Actual delivery cost, recorded against the trip that incurred it.
 *
 * Delivery revenue against a larger actual cost is a loss on that leg, and the reporting layer
 * surfaces it as one. That gap is the number the pilot exists to move.
 *
 * Refs: docs/06 §5.1
 */
export function journalForTripCost(input: {
  readonly tripId: string
  readonly actualCostPoisha: Poisha
}): Journal {
  return buildJournal(`TRIP:${input.tripId}:COST`, 'Actual delivery cost paid', [
    debit('5000', 'PLATFORM', null, input.actualCostPoisha, 'Logistics cost'),
    credit('1000', 'PLATFORM', null, input.actualCostPoisha, 'Cash — bank'),
  ])
}

/** Agent remits collected COD cash to the bank. */
export function journalForAgentRemittance(input: {
  readonly remittanceId: string
  readonly agentId: string
  readonly amountPoisha: Poisha
}): Journal {
  return buildJournal(`REMITTANCE:${input.remittanceId}`, 'Agent remits collected cash', [
    debit('1000', 'PLATFORM', null, input.amountPoisha, 'Cash — bank'),
    credit('1020', 'AGENT', input.agentId, input.amountPoisha, 'Cash in transit cleared'),
  ])
}

/**
 * Settlement to the farmer.
 *
 * Debits the payable that has been carried since delivery. The farmer's money was never revenue
 * and never Langgol's; this entry simply discharges the liability.
 *
 * Refs: docs/06 §5.1, §8
 */
export function journalForSettlement(input: {
  readonly settlementId: string
  readonly farmerProfileId: string
  readonly amountPoisha: Poisha
}): Journal {
  return buildJournal(`SETTLEMENT:${input.settlementId}:PAY`, 'Settlement paid to farmer', [
    debit('2000', 'FARMER', input.farmerProfileId, input.amountPoisha, 'Discharge farmer payable'),
    credit('1000', 'PLATFORM', null, input.amountPoisha, 'Cash — bank'),
  ])
}

/** What accepting a payment method cost Langgol, booked when the payment settles. */
export function journalForPaymentCost(input: {
  readonly orderId: string
  readonly providerRef: string
  readonly costPoisha: Poisha
}): Journal | null {
  if (Money.isZero(input.costPoisha)) return null
  return buildJournal(`PAYMENT:${input.providerRef}:COST`, 'Payment processing cost', [
    debit('5010', 'PLATFORM', null, input.costPoisha, 'Payment processing cost'),
    credit('1000', 'PLATFORM', null, input.costPoisha, 'Cash — bank'),
  ])
}
