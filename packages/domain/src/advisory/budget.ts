/**
 * The advisory spend circuit breaker.
 *
 * Deliberately the same shape as `hasSmsBudget` in `identity/otp.ts`, because it is the same
 * problem with a bigger number attached: an endpoint that calls a paid provider on request is an
 * open invoice to anyone with a script. A vision call costs more than an SMS, so the argument for
 * a cap is stronger here, not weaker.
 *
 * Two separate limits, and they answer different questions:
 *
 *  - **The daily budget** protects the platform. It is spend across every farmer, and when it is
 *    reached the feature stops for everyone until tomorrow.
 *  - **The per-farmer daily cap** protects the budget from a single account. Without it one
 *    farmer — or one compromised session — can spend the whole day's allowance before anyone
 *    else opens the app.
 *
 * Refs: docs/07_SECURITY.md §3.2, T14; docs/06_FINANCIAL_ARCHITECTURE.md §4
 */

import { Money, type Poisha } from '../money/index.js'

export interface AdvisorySpend {
  /** Diagnoses already served today, across the whole platform. */
  readonly servedToday: number
  /** Diagnoses already served today to the farmer asking. */
  readonly servedTodayForUser: number
}

export interface AdvisoryLimits {
  readonly unitCost: Poisha
  readonly dailyBudget: Poisha
  readonly perUserDailyLimit: number
}

export type BudgetVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'BUDGET_EXHAUSTED' | 'USER_LIMIT_REACHED' }

/**
 * Whether one more diagnosis may be served.
 *
 * Projects the cost of the NEXT call rather than checking spend so far, so the budget is a ceiling
 * that is never crossed rather than one that is noticed afterwards.
 */
export function evaluateAdvisoryBudget(
  spend: AdvisorySpend,
  limits: AdvisoryLimits,
): BudgetVerdict {
  if (spend.servedTodayForUser >= limits.perUserDailyLimit) {
    return { allowed: false, reason: 'USER_LIMIT_REACHED' }
  }

  const projected = Money.multiply(limits.unitCost, spend.servedToday + 1)
  if (Money.compare(projected, limits.dailyBudget) > 0) {
    return { allowed: false, reason: 'BUDGET_EXHAUSTED' }
  }

  return { allowed: true }
}
