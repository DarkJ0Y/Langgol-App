/**
 * PlatformConfig v1 — the approved business parameters.
 *
 * This file is one of the very few places a concrete business value may appear, and it is
 * exempted from the `langgol/no-business-rate-literal` lint rule for exactly that reason. Every
 * value here traces to an approved decision in docs/01_MVP_REQUIREMENTS.md §9.1.
 *
 * Values marked PROVISIONAL are structure, not calibration: they exist so the code paths are
 * exercised end to end, and the pilot replaces them with measured numbers. They are never
 * presented to a user as though they were validated.
 */

export interface ConfigSeed {
  readonly key: string
  readonly value: unknown
  readonly note: string
}

export const PLATFORM_CONFIG_V1: readonly ConfigSeed[] = [
  // --- Commission (decision D2) -------------------------------------------
  {
    key: 'commission.bps',
    value: 300,
    note: 'Approved 3% seller-side commission. Basis points, never a fraction. Decision D2.',
  },
  {
    key: 'commission.incidence',
    value: 'SELLER',
    note: 'Seller-side only. No buyer-side marketplace fee at MVP. Decision D2.',
  },
  {
    key: 'platformFee.bps',
    value: 0,
    note: 'Buyer-side marketplace fee is zero at MVP; the buyer sees product + delivery + charges.',
  },

  // --- Delivery (decision D3) ---------------------------------------------
  {
    key: 'delivery.fundingModel.default',
    value: 'COST_RECOVERING',
    note: 'Cost-recovering is the default economic model. Decision D3.',
  },
  {
    key: 'delivery.fundingModel.enabled',
    value: [
      'COST_RECOVERING',
      'PROMOTIONAL_SUBSIDY',
      'FREE_DELIVERY',
      'RETAILER_FUNDED',
      'SELLER_FUNDED',
      'SHARED',
    ],
    note: 'Subsidising models are additionally gated by the pilot loss budget at quote time.',
  },
  {
    key: 'delivery.circuityFactor',
    value: { default: 1.3 },
    note: 'PROVISIONAL. Haversine-to-road multiplier, per district. Calibrate against measured trips.',
  },
  {
    key: 'delivery.tariff',
    value: {
      currency: 'BDT',
      provisional: true,
      bands: [
        { maxChargeableKg: 5, baseFeePoisha: 4000, includedKm: 5, perKmPoisha: 800 },
        { maxChargeableKg: 20, baseFeePoisha: 7000, includedKm: 5, perKmPoisha: 1000 },
        { maxChargeableKg: 100, baseFeePoisha: 15000, includedKm: 5, perKmPoisha: 1400 },
        { maxChargeableKg: 500, baseFeePoisha: 45000, includedKm: 10, perKmPoisha: 2200 },
      ],
      aboveTopBand: 'OPS_QUOTE_ONLY',
    },
    note: 'PROVISIONAL structure from docs/04 §3. Amounts in poisha. The pilot replaces these with measured cost.',
  },

  {
    key: 'delivery.volumetricDivisorCm3PerKg',
    value: 5000,
    note: 'PROVISIONAL. Standard courier divisor. A vehicle runs out of space before payload. docs/04 §3.',
  },
  {
    key: 'delivery.handling',
    value: {
      provisional: true,
      perOrderPoisha: 800,
      perKgPoishaByClass: {
        HIGHLY_PERISHABLE: 40,
        PERISHABLE: 30,
        SEMI_DURABLE: 20,
        DURABLE: 15,
      },
    },
    note: 'PROVISIONAL. ৳8 flat + ৳0.40/kg for highly perishable — reproduces the docs/04 §7.1 worked example (৳10.00 on 5 kg of tomato). docs/P2_DELIVERED_COST §3.',
  },
  {
    key: 'delivery.internalCost',
    value: {
      provisional: true,
      roundTripFactorBps: 13000,
      vehicles: {
        HEAD_LOAD: {
          capacityKg: 40,
          baseFeePoisha: 8000,
          perKmPoisha: 1500,
          loadingFeePoisha: 0,
          stopFeePoisha: 0,
        },
        MOTORCYCLE: {
          capacityKg: 60,
          baseFeePoisha: 12000,
          perKmPoisha: 1800,
          loadingFeePoisha: 1000,
          stopFeePoisha: 1500,
        },
        VAN: {
          capacityKg: 300,
          baseFeePoisha: 25000,
          perKmPoisha: 2500,
          loadingFeePoisha: 5000,
          stopFeePoisha: 3000,
        },
        CNG: {
          capacityKg: 400,
          baseFeePoisha: 30000,
          perKmPoisha: 3000,
          loadingFeePoisha: 5000,
          stopFeePoisha: 3000,
        },
        PICKUP: {
          capacityKg: 1200,
          baseFeePoisha: 60000,
          perKmPoisha: 4500,
          loadingFeePoisha: 15000,
          stopFeePoisha: 5000,
        },
        TRUCK: {
          capacityKg: 5000,
          baseFeePoisha: 150000,
          perKmPoisha: 8000,
          loadingFeePoisha: 30000,
          stopFeePoisha: 8000,
        },
      },
    },
    note: 'PROVISIONAL — INTERNAL cost model, never shown to a buyer. Calibrate from DeliveryTrip.actualCostPoisha. docs/04 §4.',
  },
  {
    key: 'delivery.spoilage',
    value: {
      provisional: true,
      perHourBpsByClass: {
        HIGHLY_PERISHABLE: 120,
        PERISHABLE: 60,
        SEMI_DURABLE: 20,
        DURABLE: 5,
      },
      coldChainReductionBps: 7000,
      maxBps: 3000,
    },
    note: 'PROVISIONAL. Flat per-hour rate; real cold-chain modelling is deferred (docs/04 §12).',
  },
  {
    key: 'fulfilment.cost',
    value: { provisional: true, packagingPerOrderPoisha: 2000, agentTimePerOrderPoisha: 3000 },
    note: 'PROVISIONAL. ৳20 packaging + ৳30 agent time per order. docs/04 §4.',
  },
  {
    key: 'payments.cost',
    value: {
      provisional: true,
      byMethod: {
        CASH_ON_DELIVERY: { rateBps: 100, fixedPoisha: 0 },
        MFS: { rateBps: 150, fixedPoisha: 500 },
      },
    },
    note: 'PROVISIONAL. COD 1% handling; MFS 1.5% + ৳5 — MFS stays disabled until decision D4 clears. docs/04 §4.',
  },

  // --- Ranking (docs/04 §5) -----------------------------------------------
  {
    key: 'ranking.weightsBps',
    value: {
      price: 4500,
      reliability: 1800,
      freshness: 1400,
      speed: 800,
      quantityFit: 800,
      rating: 700,
    },
    note: 'APPROVED weights from docs/04 §5.2, as basis points summing to 10000. Changing these is a product decision with an audit trail.',
  },
  {
    key: 'ranking.reliabilityPrior',
    value: { smoothingK: 5, priorBps: 7000 },
    note: 'Laplace smoothing k=5, prior 0.70 — new farmers are neither privileged nor buried. docs/04 §5.4.',
  },
  {
    key: 'ranking.ratingPrior',
    value: { smoothingK: 5, priorStarsMilli: 3500, maxStars: 5 },
    note: 'PROVISIONAL. Bayesian smoothing toward 3.5 stars until a farmer has a real review history.',
  },
  {
    key: 'ranking.quantityFitBps',
    value: { full: 10000, partial: 7000 },
    note: 'APPROVED from docs/04 §5.2: 1.0 for a full cover, 0.7 for a partial fill.',
  },
  {
    key: 'ranking.marginFloorPoisha',
    value: -20000,
    note: 'PROVISIONAL. Feasibility filter only — margin is NEVER a scoring factor. ৳-200 floor during the subsidised pilot. docs/04 §5.3.',
  },
  {
    key: 'ranking.tiebreakBps',
    value: 100,
    note: 'APPROVED. Scores within 1% are a tie, broken by contribution margin. The ONLY other permitted use of margin. docs/04 §5.3.',
  },
  {
    key: 'ranking.newFarmerBoost',
    value: { boostBps: 500, decayOverOrders: 5 },
    note: 'PROVISIONAL. Deliberate, logged market-making intervention to break the no-orders/no-reputation loop. docs/04 §5.4.',
  },

  // --- Discovery ----------------------------------------------------------
  {
    key: 'discovery.radiusKm',
    value: { CONSUMER: 40, RETAILER: 100 },
    note: 'PROVISIONAL. Prevents long-haul matches we cannot yet price. docs/04 §11.',
  },

  // --- Order lifecycle ----------------------------------------------------
  {
    key: 'order.acceptanceWindowMinutes',
    value: 120,
    note: 'Quiet-hours aware: 21:00–07:00 Asia/Dhaka does not consume the window. docs/05 §4.',
  },
  {
    key: 'order.quietHours',
    value: { timezone: 'Asia/Dhaka', startHour: 21, endHour: 7 },
    note: 'A farmer must not be penalised for sleeping. docs/05 §4.',
  },
  { key: 'quote.ttlMinutes', value: 15, note: 'Server-side quote lifetime. docs/04 §8.' },

  // --- Settlement (decision D5) -------------------------------------------
  {
    key: 'settlement.rail.default',
    value: 'AGENT_CASH',
    note: 'Bootstrap only, per farmer. MFS/bank/regulated provider onboarding runs from P0. Decision D5.',
  },
  {
    key: 'settlement.holdHours',
    // null, not an object of nulls: null is the convention for an open product decision, and
    // require() then raises CONFIG_NOT_SET at the point of use. An object of nulls instead fails
    // SCHEMA validation, which takes down the whole snapshot and stops the app booting at all.
    value: null,
    note: 'UNSET — open decision Q2. Null means the settlement job refuses to release rather than guessing.',
  },

  // --- Cancellation (decision D7) -----------------------------------------
  {
    key: 'cancellation.feeDestination',
    value: 'FARMER',
    note: 'Buyer-attributable cancellation fees compensate the farmer. Decision D7.',
  },
  {
    key: 'cancellation.feeSchedule',
    value: null,
    note: 'UNSET — open decision Q3. Until set, no cancellation fee is charged.',
  },

  // --- Payments (decision D4) ---------------------------------------------
  {
    key: 'payments.prepaidEnabled',
    value: false,
    note: 'HARD GATE. Prepaid stays off until the custody/escrow review completes. Decision D4.',
  },
  {
    key: 'payments.methods.enabled',
    value: ['CASH_ON_DELIVERY'],
    note: 'COD-first launch. Decision D4.',
  },

  // --- Pilot loss budget --------------------------------------------------
  {
    key: 'pilot.lossBudget',
    value: null,
    note: 'UNSET — open decision Q1. Until set, subsidising funding models are refused at quote time.',
  },

  // --- Authentication and abuse limits ------------------------------------
  {
    key: 'auth.otp.ttlSeconds',
    value: 300,
    note: 'OTP lifetime. docs/07 §3.1.',
  },
  {
    key: 'auth.otp.maxAttempts',
    value: 5,
    note: 'Verification attempts before the challenge is burned. docs/07 §3.1.',
  },
  {
    key: 'auth.otp.rateLimits',
    value: {
      perPhone: { limit: 3, windowSeconds: 900, dailyLimit: 10 },
      perIp: { limit: 10, windowSeconds: 3600 },
      perDevice: { limit: 10, windowSeconds: 3600 },
    },
    note: 'docs/07 §3.2. An SMS gateway without limits is an open invoice to an attacker.',
  },
  {
    key: 'auth.session.idleTimeoutDays',
    value: { DEFAULT: 30, ADMIN: 0.333 },
    note: 'Admin sessions are ~8 hours. docs/07 §3.3.',
  },
] as const
