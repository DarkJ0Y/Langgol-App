/**
 * The chart of accounts.
 *
 * Langgol acts as an **agent, not a principal**: it does not buy produce and resell it, it
 * facilitates a sale and earns a commission. That single decision shapes everything here —
 * revenue is commission and fees, never GMV, and the farmer's gross stays the farmer's money,
 * carried as a liability until it is settled.
 *
 * **No balance is ever stored.** A farmer's payable is `SUM(credits) − SUM(debits)` over account
 * `2000/<farmerId>`. Anything cached is a materialised view with an integrity check, never the
 * source of truth.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §1, §3
 */

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'

/** Who an account belongs to. Per-farmer and per-agent accounts are created lazily. */
export type AccountOwnerType = 'PLATFORM' | 'FARMER' | 'BUYER' | 'AGENT' | 'PROVIDER'

export interface AccountDefinition {
  readonly code: string
  readonly name: string
  readonly type: AccountType
  readonly ownerType: AccountOwnerType
}

export const CHART_OF_ACCOUNTS: readonly AccountDefinition[] = [
  { code: '1000', name: 'Cash — bank', type: 'ASSET', ownerType: 'PLATFORM' },
  { code: '1010', name: 'Cash — MFS merchant wallet', type: 'ASSET', ownerType: 'PLATFORM' },
  { code: '1020', name: 'Cash in transit — COD float', type: 'ASSET', ownerType: 'AGENT' },
  { code: '1030', name: 'Receivable from payment provider', type: 'ASSET', ownerType: 'PROVIDER' },

  { code: '2000', name: 'Payable to farmers', type: 'LIABILITY', ownerType: 'FARMER' },
  { code: '2010', name: 'Buyer prepayments held', type: 'LIABILITY', ownerType: 'BUYER' },
  { code: '2020', name: 'Refunds payable', type: 'LIABILITY', ownerType: 'PLATFORM' },
  { code: '2030', name: 'VAT payable', type: 'LIABILITY', ownerType: 'PLATFORM' },
  { code: '2040', name: 'Withholding tax payable', type: 'LIABILITY', ownerType: 'PLATFORM' },

  { code: '4000', name: 'Commission revenue', type: 'REVENUE', ownerType: 'PLATFORM' },
  { code: '4010', name: 'Delivery fee revenue', type: 'REVENUE', ownerType: 'PLATFORM' },
  { code: '4020', name: 'Handling fee revenue', type: 'REVENUE', ownerType: 'PLATFORM' },
  { code: '4030', name: 'Cancellation ops-cost recovery', type: 'REVENUE', ownerType: 'PLATFORM' },

  { code: '5000', name: 'Logistics cost', type: 'EXPENSE', ownerType: 'PLATFORM' },
  { code: '5010', name: 'Payment processing cost', type: 'EXPENSE', ownerType: 'PLATFORM' },
  {
    code: '5020',
    name: 'Promotional discount / delivery subsidy',
    type: 'EXPENSE',
    ownerType: 'PLATFORM',
  },
  { code: '5030', name: 'Spoilage and loss', type: 'EXPENSE', ownerType: 'PLATFORM' },
  {
    code: '5040',
    name: 'Packaging and handling materials',
    type: 'EXPENSE',
    ownerType: 'PLATFORM',
  },
  { code: '5050', name: 'Field-agent variable cost', type: 'EXPENSE', ownerType: 'PLATFORM' },
] as const

export type AccountCode = (typeof CHART_OF_ACCOUNTS)[number]['code']

const BY_CODE = new Map(CHART_OF_ACCOUNTS.map((account) => [account.code, account]))

export function accountDefinition(code: string): AccountDefinition | undefined {
  return BY_CODE.get(code)
}

export function isAccountCode(code: string): boolean {
  return BY_CODE.has(code)
}

/**
 * A debit increases assets and expenses, and decreases liabilities, equity and revenue.
 *
 * Stated explicitly because getting the sign convention wrong in one journal is the kind of bug
 * that balances perfectly and reports nonsense.
 */
export function debitIncreases(type: AccountType): boolean {
  return type === 'ASSET' || type === 'EXPENSE'
}
