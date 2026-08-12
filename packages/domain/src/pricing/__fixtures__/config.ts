/**
 * Test configuration fixture.
 *
 * Mirrors `packages/db/prisma/seed/platform-config.ts` so the domain tests exercise the same
 * numbers the pilot will actually run on — without the domain package taking a dependency on the
 * database package, which would break the "domain imports no I/O" rule.
 *
 * This file is exempt from `langgol/no-business-rate-literal` because fixtures are one of the
 * few places concrete business values are supposed to appear.
 */

import {
  createConfigSnapshot,
  type ConfigEntry,
  type ConfigSnapshot,
} from '../../config/snapshot.js'

export const FIXTURE_ENTRIES: readonly ConfigEntry[] = [
  { key: 'commission.bps', version: 1, value: 300 },
  { key: 'commission.incidence', version: 1, value: 'SELLER' },
  { key: 'platformFee.bps', version: 1, value: 0 },

  { key: 'delivery.fundingModel.default', version: 1, value: 'COST_RECOVERING' },
  {
    key: 'delivery.fundingModel.enabled',
    version: 1,
    value: [
      'COST_RECOVERING',
      'PROMOTIONAL_SUBSIDY',
      'FREE_DELIVERY',
      'RETAILER_FUNDED',
      'SELLER_FUNDED',
      'SHARED',
    ],
  },
  { key: 'delivery.circuityFactor', version: 1, value: { default: 1.3 } },
  {
    key: 'delivery.tariff',
    version: 1,
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
  },
  { key: 'delivery.volumetricDivisorCm3PerKg', version: 1, value: 5000 },
  {
    key: 'delivery.handling',
    version: 1,
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
  },
  {
    key: 'delivery.internalCost',
    version: 1,
    value: {
      provisional: true,
      roundTripFactorBps: 13000,
      vehicles: {
        VAN: {
          capacityKg: 300,
          baseFeePoisha: 25000,
          perKmPoisha: 2500,
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
      },
    },
  },
  {
    key: 'delivery.spoilage',
    version: 1,
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
  },
  {
    key: 'fulfilment.cost',
    version: 1,
    value: { provisional: true, packagingPerOrderPoisha: 2000, agentTimePerOrderPoisha: 3000 },
  },
  {
    key: 'payments.cost',
    version: 1,
    value: {
      provisional: true,
      byMethod: {
        CASH_ON_DELIVERY: { rateBps: 100, fixedPoisha: 0 },
        MFS: { rateBps: 150, fixedPoisha: 500 },
      },
    },
  },

  {
    key: 'ranking.weightsBps',
    version: 1,
    value: {
      price: 4500,
      reliability: 1800,
      freshness: 1400,
      speed: 800,
      quantityFit: 800,
      rating: 700,
    },
  },
  { key: 'ranking.reliabilityPrior', version: 1, value: { smoothingK: 5, priorBps: 7000 } },
  {
    key: 'ranking.ratingPrior',
    version: 1,
    value: { smoothingK: 5, priorStarsMilli: 3500, maxStars: 5 },
  },
  { key: 'ranking.quantityFitBps', version: 1, value: { full: 10000, partial: 7000 } },
  { key: 'ranking.marginFloorPoisha', version: 1, value: -20000 },
  { key: 'ranking.tiebreakBps', version: 1, value: 100 },
  { key: 'ranking.newFarmerBoost', version: 1, value: { boostBps: 500, decayOverOrders: 5 } },

  { key: 'discovery.radiusKm', version: 1, value: { CONSUMER: 40, RETAILER: 100 } },
  { key: 'order.acceptanceWindowMinutes', version: 1, value: 120 },
  { key: 'quote.ttlMinutes', version: 1, value: 15 },
  { key: 'payments.prepaidEnabled', version: 1, value: false },
  { key: 'payments.methods.enabled', version: 1, value: ['CASH_ON_DELIVERY'] },
]

export function fixtureConfig(overrides: readonly ConfigEntry[] = []): ConfigSnapshot {
  const merged = new Map<string, ConfigEntry>()
  for (const entry of FIXTURE_ENTRIES) merged.set(entry.key, entry)
  for (const entry of overrides) merged.set(entry.key, entry)
  return createConfigSnapshot([...merged.values()], new Date('2026-08-13T06:00:00.000Z'))
}
