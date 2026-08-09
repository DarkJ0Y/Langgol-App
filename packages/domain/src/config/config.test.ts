import { describe, expect, it } from 'vitest'
import {
  createConfigSnapshot,
  emptyConfigSnapshot,
  ConfigError,
  CONFIG_KEYS,
  isConfigKey,
} from './index.js'

const AT = new Date('2026-08-10T00:00:00Z')

describe('config snapshot', () => {
  it('resolves and validates a known key', () => {
    const snapshot = createConfigSnapshot([{ key: 'commission.bps', version: 1, value: 300 }], AT)
    expect(snapshot.require('commission.bps')).toBe(300)
    expect(snapshot.get('commission.bps')).toBe(300)
    expect(snapshot.has('commission.bps')).toBe(true)
  })

  it('stamps the version so a historical price stays reproducible', () => {
    const snapshot = createConfigSnapshot(
      [
        { key: 'commission.bps', version: 4, value: 250 },
        { key: 'quote.ttlMinutes', version: 2, value: 15 },
      ],
      AT,
    )
    expect(snapshot.versions).toEqual({ 'commission.bps': 4, 'quote.ttlMinutes': 2 })
  })

  it('refuses to invent a value for an open product decision', () => {
    const snapshot = createConfigSnapshot(
      [{ key: 'pilot.lossBudget', version: 1, value: null }],
      AT,
    )
    expect(snapshot.unsetKeys).toContain('pilot.lossBudget')
    expect(snapshot.has('pilot.lossBudget')).toBe(false)
    expect(snapshot.get('pilot.lossBudget')).toBeUndefined()

    try {
      snapshot.require('pilot.lossBudget')
      throw new Error('require() should have thrown for an unset key')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).code).toBe('NOT_SET')
      expect((error as ConfigError).key).toBe('pilot.lossBudget')
    }
  })

  it('reports keys the code knows about but the database has never been given', () => {
    const snapshot = createConfigSnapshot([{ key: 'commission.bps', version: 1, value: 300 }], AT)
    expect(snapshot.missingKeys).toContain('settlement.rail.default')
    expect(snapshot.missingKeys).not.toContain('commission.bps')
  })

  it('rejects a malformed known value rather than shrugging', () => {
    expect(() =>
      createConfigSnapshot([{ key: 'commission.bps', version: 1, value: 20000 }], AT),
    ).toThrow(ConfigError)
    expect(() =>
      createConfigSnapshot([{ key: 'commission.bps', version: 1, value: 'three percent' }], AT),
    ).toThrow(ConfigError)
  })

  it('ignores unknown keys so a newer deployment does not break an older one', () => {
    const snapshot = createConfigSnapshot(
      [
        { key: 'commission.bps', version: 1, value: 300 },
        { key: 'some.future.key', version: 1, value: { anything: true } },
      ],
      AT,
    )
    expect(snapshot.require('commission.bps')).toBe(300)
    expect(snapshot.versions['some.future.key']).toBeUndefined()
  })

  it('validates the full approved v1 shape', () => {
    const snapshot = createConfigSnapshot(
      [
        { key: 'commission.bps', version: 1, value: 300 },
        { key: 'commission.incidence', version: 1, value: 'SELLER' },
        { key: 'platformFee.bps', version: 1, value: 0 },
        { key: 'delivery.fundingModel.default', version: 1, value: 'COST_RECOVERING' },
        {
          key: 'delivery.tariff',
          version: 1,
          value: {
            currency: 'BDT',
            provisional: true,
            bands: [{ maxChargeableKg: 5, baseFeePoisha: 4000, includedKm: 5, perKmPoisha: 800 }],
            aboveTopBand: 'OPS_QUOTE_ONLY',
          },
        },
        { key: 'payments.prepaidEnabled', version: 1, value: false },
      ],
      AT,
    )
    expect(snapshot.require('commission.incidence')).toBe('SELLER')
    expect(snapshot.require('platformFee.bps')).toBe(0)
    expect(snapshot.require('payments.prepaidEnabled')).toBe(false)
    expect(snapshot.require('delivery.tariff').bands[0]?.baseFeePoisha).toBe(4000)
  })

  it('is immutable', () => {
    const snapshot = createConfigSnapshot([{ key: 'commission.bps', version: 1, value: 300 }], AT)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.versions)).toBe(true)
  })

  it('offers an empty snapshot whose every require() throws', () => {
    const snapshot = emptyConfigSnapshot(AT)
    expect(snapshot.missingKeys.length).toBe(CONFIG_KEYS.length)
    expect(() => snapshot.require('commission.bps')).toThrow(ConfigError)
  })

  it('recognises its own keys', () => {
    expect(isConfigKey('commission.bps')).toBe(true)
    expect(isConfigKey('not.a.key')).toBe(false)
    expect(CONFIG_KEYS.length).toBeGreaterThan(15)
  })
})
