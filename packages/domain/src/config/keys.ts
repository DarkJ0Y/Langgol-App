/**
 * The platform configuration contract.
 *
 * Every business parameter in Langgol is declared here with a schema. This is what makes
 * `langgol/no-business-rate-literal` a workable rule rather than an obstruction: there is a
 * named, typed, validated place for every rate, tariff, window and threshold to live.
 *
 * A key whose value is `null` is an **open product decision**. Reading it with `require()`
 * raises `CONFIG_NOT_SET`, so the code path refuses rather than substituting a plausible
 * default. Guessing a commission rate or a settlement hold would be worse than stopping.
 *
 * Refs: docs/03_ARCHITECTURE.md §7; docs/01_MVP_REQUIREMENTS.md §9
 */

import { z } from 'zod'

/** Basis points: 300 = 3%. Rates are never fractions. */
const bps = z.number().int().min(0).max(10000)

const poisha = z.number().int().min(0)

export const configSchemas = {
  // --- Commission (decision D2) -------------------------------------------
  'commission.bps': bps,
  'commission.incidence': z.enum(['SELLER', 'BUYER', 'SPLIT']),
  'platformFee.bps': bps,

  // --- Delivery (decision D3) ---------------------------------------------
  'delivery.fundingModel.default': z.enum([
    'COST_RECOVERING',
    'PROMOTIONAL_SUBSIDY',
    'FREE_DELIVERY',
    'RETAILER_FUNDED',
    'SELLER_FUNDED',
    'SHARED',
  ]),
  'delivery.fundingModel.enabled': z.array(
    z.enum([
      'COST_RECOVERING',
      'PROMOTIONAL_SUBSIDY',
      'FREE_DELIVERY',
      'RETAILER_FUNDED',
      'SELLER_FUNDED',
      'SHARED',
    ]),
  ),
  'delivery.circuityFactor': z.object({ default: z.number().positive() }).catchall(z.number()),
  'delivery.tariff': z.object({
    currency: z.literal('BDT'),
    provisional: z.boolean(),
    bands: z.array(
      z.object({
        maxChargeableKg: z.number().positive(),
        baseFeePoisha: poisha,
        includedKm: z.number().min(0),
        perKmPoisha: poisha,
      }),
    ),
    aboveTopBand: z.literal('OPS_QUOTE_ONLY'),
  }),

  // --- Discovery ----------------------------------------------------------
  'discovery.radiusKm': z.object({
    CONSUMER: z.number().positive(),
    RETAILER: z.number().positive(),
  }),

  // --- Order lifecycle ----------------------------------------------------
  'order.acceptanceWindowMinutes': z.number().int().positive(),
  'order.quietHours': z.object({
    timezone: z.string(),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  }),
  'quote.ttlMinutes': z.number().int().positive(),

  // --- Settlement (decision D5) -------------------------------------------
  'settlement.rail.default': z.enum(['AGENT_CASH', 'MFS', 'BANK', 'REGULATED_PROVIDER']),
  'settlement.holdHours': z.object({
    NEW: z.number().min(0),
    STANDARD: z.number().min(0),
    TRUSTED: z.number().min(0),
  }),

  // --- Cancellation (decision D7) -----------------------------------------
  'cancellation.feeDestination': z.enum(['FARMER', 'PLATFORM', 'SPLIT']),
  'cancellation.feeSchedule': z.object({
    byState: z.record(z.string(), z.object({ bps, minPoisha: poisha, maxPoisha: poisha })),
    platformOpsCostPoisha: poisha,
  }),

  // --- Payments (decision D4) ---------------------------------------------
  'payments.prepaidEnabled': z.boolean(),
  'payments.methods.enabled': z.array(z.enum(['CASH_ON_DELIVERY', 'MFS', 'CARD', 'BANK_TRANSFER'])),

  // --- Pilot loss budget --------------------------------------------------
  'pilot.lossBudget': z.object({
    periodStart: z.string(),
    periodEnd: z.string(),
    caps: z.record(z.string(), poisha),
  }),

  // --- Authentication -----------------------------------------------------
  'auth.otp.ttlSeconds': z.number().int().positive(),
  'auth.otp.maxAttempts': z.number().int().positive(),
  'auth.otp.rateLimits': z.object({
    perPhone: z.object({
      limit: z.number().int().positive(),
      windowSeconds: z.number().int().positive(),
      dailyLimit: z.number().int().positive(),
    }),
    perIp: z.object({
      limit: z.number().int().positive(),
      windowSeconds: z.number().int().positive(),
    }),
    perDevice: z.object({
      limit: z.number().int().positive(),
      windowSeconds: z.number().int().positive(),
    }),
  }),
  'auth.session.idleTimeoutDays': z.object({
    DEFAULT: z.number().positive(),
    ADMIN: z.number().positive(),
  }),
} as const

export type ConfigKey = keyof typeof configSchemas

export type ConfigValue<K extends ConfigKey> = z.infer<(typeof configSchemas)[K]>

export const CONFIG_KEYS = Object.keys(configSchemas) as ConfigKey[]

export function isConfigKey(value: string): value is ConfigKey {
  return Object.prototype.hasOwnProperty.call(configSchemas, value)
}
