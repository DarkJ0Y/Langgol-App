/**
 * The payment adapter registry — where every payment gate is enforced.
 *
 * Callers never construct or import an adapter directly; they ask the registry, which is the one
 * place that knows about:
 *
 *  1. `payments.methods.enabled` — the configured list
 *  2. `payments.prepaidEnabled` — the **hard gate** from decision D4. A prepaid adapter is
 *     refused while this is false even if the method appears in the enabled list, because
 *     holding buyer funds before delivery is a licensing question
 *  3. mock adapters, which are refused outside development and test
 *
 * Putting all three here rather than at call sites is deliberate: a gate that must be remembered
 * is a gate that will eventually be forgotten.
 *
 * Refs: docs/06_FINANCIAL_ARCHITECTURE.md §11, §13.8
 */

import {
  PaymentRegistryError,
  type PaymentAdapter,
  type PaymentRegistry,
} from '@langgol/application'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { codAdapter } from './cod.js'
import { createMockMfsAdapter } from './mfs-mock.js'

export interface RegistryOptions {
  readonly config: ConfigSnapshot
  /** `development` | `test` | `staging` | `production`. */
  readonly environment: string
  /** Override for tests. Defaults to the COD adapter plus the mock MFS simulator. */
  readonly adapters?: readonly PaymentAdapter[]
}

export function createPaymentRegistry(options: RegistryOptions): PaymentRegistry {
  const enabledMethods = options.config.require('payments.methods.enabled') as readonly string[]
  const prepaidEnabled = options.config.require('payments.prepaidEnabled')
  const paymentCost = options.config.require('payments.cost')
  const isProductionLike = options.environment === 'production' || options.environment === 'staging'

  const mfsProfile = paymentCost.byMethod['MFS'] ?? { rateBps: 0, fixedPoisha: 0 }

  const adapters =
    options.adapters ??
    ([
      codAdapter,
      createMockMfsAdapter({
        rateBps: mfsProfile.rateBps,
        fixedPoisha: mfsProfile.fixedPoisha,
      }),
    ] as const)

  const byMethod = new Map(adapters.map((adapter) => [adapter.method as string, adapter]))

  return {
    enabledMethods,

    resolve(method: string): PaymentAdapter {
      if (!enabledMethods.includes(method)) {
        throw new PaymentRegistryError(
          'METHOD_NOT_ENABLED',
          `Payment method "${method}" is not in payments.methods.enabled`,
        )
      }

      const adapter = byMethod.get(method)
      if (!adapter) {
        throw new PaymentRegistryError(
          'NO_ADAPTER',
          `No adapter is registered for payment method "${method}"`,
        )
      }

      if (adapter.timing === 'PREPAID' && !prepaidEnabled) {
        throw new PaymentRegistryError(
          'PREPAID_DISABLED',
          `Prepaid payments are disabled (decision D4). "${method}" holds buyer funds before ` +
            'delivery, which stays off until the custody and escrow review completes.',
        )
      }

      if (adapter.isMock && isProductionLike) {
        // docs/06 §13.8: no mock payment provider is registrable in production.
        throw new PaymentRegistryError(
          'MOCK_IN_PRODUCTION',
          `"${method}" resolves to a simulator, which must never handle real money. ` +
            `Refused in environment "${options.environment}".`,
        )
      }

      return adapter
    },
  }
}
