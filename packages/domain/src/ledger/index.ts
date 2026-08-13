export {
  CHART_OF_ACCOUNTS,
  accountDefinition,
  debitIncreases,
  isAccountCode,
  type AccountCode,
  type AccountDefinition,
  type AccountOwnerType,
  type AccountType,
} from './accounts.js'

export {
  LedgerError,
  buildJournal,
  journalForAgentRemittance,
  journalForGoodsDelivered,
  journalForOrderPlaced,
  journalForPaymentCost,
  journalForSettlement,
  journalForTripCost,
  journalTotal,
  type Direction,
  type Journal,
  type JournalLine,
  type OrderJournalInput,
} from './journal.js'

import * as accounts from './accounts.js'
import * as journal from './journal.js'

/** Namespace object: `Ledger.journalForGoodsDelivered(order)`. */
export const Ledger = { ...accounts, ...journal } as const
