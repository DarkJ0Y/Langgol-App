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

/**
 * Basis points for a multiplier that may legitimately exceed 1.0 — a round-trip factor is
 * 20000 bps (200%), a retailer-funded delivery may be priced above tariff.
 */
const unboundedBps = z.number().int().min(0)

const poisha = z.number().int().min(0)

/**
 * A poisha amount that may be negative. Used only for thresholds a business may deliberately
 * set below zero, such as the contribution-margin floor during a subsidised pilot.
 */
const signedPoisha = z.number().int()

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

  /**
   * Volumetric weight divisor. Pumpkins are light and huge; a vehicle runs out of space long
   * before it runs out of payload, so `chargeableWeight = max(actual, volumetric)`.
   * docs/04_MARKETPLACE.md §3.
   */
  'delivery.volumetricDivisorCm3PerKg': z.number().int().positive(),

  /**
   * Handling: a per-order flat component plus a per-kg component that varies by perishability
   * class, because a crate of tomatoes needs more packing care than a sack of potatoes.
   * docs/P2_DELIVERED_COST.md §3.
   */
  'delivery.handling': z.object({
    provisional: z.boolean(),
    perOrderPoisha: poisha,
    perKgPoishaByClass: z.object({
      HIGHLY_PERISHABLE: poisha,
      PERISHABLE: poisha,
      SEMI_DURABLE: poisha,
      DURABLE: poisha,
    }),
  }),

  /**
   * The INTERNAL cost model — cost 2 of the three costs in docs/04_MARKETPLACE.md §2. Never
   * shown to a buyer; used for ranking feasibility and margin forecasting only.
   *
   * `tripCost = vehicleBase + perKm × distanceKm × roundTripFactor + loadingFee + stopFee × stops`
   */
  'delivery.internalCost': z.object({
    provisional: z.boolean(),
    /** 13000 bps = 1.30 — the return leg is usually partly loaded. docs/04 §4. */
    roundTripFactorBps: unboundedBps,
    vehicles: z.record(
      z.string(),
      z.object({
        capacityKg: z.number().positive(),
        baseFeePoisha: poisha,
        perKmPoisha: poisha,
        loadingFeePoisha: poisha,
        stopFeePoisha: poisha,
      }),
    ),
  }),

  /**
   * Expected spoilage as a fraction of product cost, by perishability class and transit time.
   * A flat per-hour rate is deliberately crude — docs/04 §12 defers real cold-chain modelling.
   */
  'delivery.spoilage': z.object({
    provisional: z.boolean(),
    perHourBpsByClass: z.object({
      HIGHLY_PERISHABLE: bps,
      PERISHABLE: bps,
      SEMI_DURABLE: bps,
      DURABLE: bps,
    }),
    coldChainReductionBps: bps,
    maxBps: bps,
  }),

  /** Per-order fulfilment cost that is neither transport nor payment. docs/04 §4. */
  'fulfilment.cost': z.object({
    provisional: z.boolean(),
    packagingPerOrderPoisha: poisha,
    agentTimePerOrderPoisha: poisha,
  }),

  /**
   * What each payment method costs Langgol.
   * `COD: codHandlingRate × buyerTotal` · `MFS: mfsRate × buyerTotal + fixedFee`. docs/04 §4.
   */
  'payments.cost': z.object({
    provisional: z.boolean(),
    byMethod: z.record(z.string(), z.object({ rateBps: bps, fixedPoisha: poisha })),
  }),

  // --- Ranking (decision D1, docs/04 §5) ----------------------------------
  /**
   * Scoring weights in basis points, required to sum to exactly 10000. Expressing them as
   * integers rather than 0.45/0.18/… keeps the whole score computation exact, so a ranking is
   * reproducible from its stored `pricingVersion` years later.
   */
  'ranking.weightsBps': z
    .object({
      price: bps,
      reliability: bps,
      freshness: bps,
      speed: bps,
      quantityFit: bps,
      rating: bps,
    })
    .refine(
      (weights) => Object.values(weights).reduce((total, weight) => total + weight, 0) === 10000,
      { message: 'Ranking weights must sum to exactly 10000 bps' },
    ),

  /** Laplace smoothing for completion history: `(completed + k·prior) / (accepted + k)`. */
  'ranking.reliabilityPrior': z.object({
    smoothingK: z.number().int().positive(),
    priorBps: bps,
  }),

  /** Bayesian smoothing for star ratings, normalised to [0,1]. */
  'ranking.ratingPrior': z.object({
    smoothingK: z.number().int().positive(),
    priorStarsMilli: z.number().int().positive(),
    maxStars: z.number().int().positive(),
  }),

  /** Score awarded when a listing can only partially fill the request. docs/04 §5.2. */
  'ranking.quantityFitBps': z.object({ full: bps, partial: bps }),

  /**
   * Contribution-margin feasibility floor. Candidates modelled below this are excluded from
   * default results. This is one of exactly two permitted uses of margin in ranking — it is
   * NEVER a scoring factor. docs/04 §5.3.
   */
  'ranking.marginFloorPoisha': signedPoisha,

  /** Scores within this band are a tie, broken by contribution margin. 100 bps = 1%. docs/04 §5.3. */
  'ranking.tiebreakBps': bps,

  /** Cold-start exposure boost for new verified farmers, decaying over their first orders. */
  'ranking.newFarmerBoost': z.object({
    boostBps: bps,
    decayOverOrders: z.number().int().positive(),
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

  /*
   * Email verification. Deliberately its own budget rather than sharing `auth.otp.rateLimits`:
   * an email costs a fraction of an SMS and reaches a different inbox, so the limits that keep
   * the SMS bill sane would be needlessly harsh here — and, more importantly, verification
   * traffic must never consume the budget a user needs to log in.
   */
  'auth.emailVerification.ttlSeconds': z.number().int().positive(),
  'auth.emailVerification.rateLimits': z.object({
    perUser: z.object({
      limit: z.number().int().positive(),
      windowSeconds: z.number().int().positive(),
      dailyLimit: z.number().int().positive(),
    }),
    resendCooldownSeconds: z.number().int().positive(),
  }),
} as const

export type ConfigKey = keyof typeof configSchemas

export type ConfigValue<K extends ConfigKey> = z.infer<(typeof configSchemas)[K]>

export const CONFIG_KEYS = Object.keys(configSchemas) as ConfigKey[]

export function isConfigKey(value: string): value is ConfigKey {
  return Object.prototype.hasOwnProperty.call(configSchemas, value)
}
