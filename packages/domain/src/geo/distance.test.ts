/**
 * Distance tests.
 *
 * The circuity factor is a **hypothesis to be calibrated**, so the tests pin the mechanism (that
 * the factor is applied, recorded and configurable per district) rather than blessing 1.30 as a
 * fact. docs/P2_DELIVERED_COST.md §6.
 */

import { describe, expect, it } from 'vitest'
import {
  estimateRoadDistance,
  haversineMeters,
  isValidPoint,
  kmFromMeters,
  resolveCircuityFactor,
} from './distance.js'

/** Bogura town and Shibganj — the corridor in the docs/04 §7 worked example. */
const BOGURA = { latitude: 24.8465, longitude: 89.3776 }
const SHIBGANJ = { latitude: 24.9505, longitude: 89.3016 }

describe('haversineMeters', () => {
  it('is zero for a point against itself', () => {
    expect(haversineMeters(BOGURA, BOGURA)).toBe(0)
  })

  it('is symmetric', () => {
    expect(haversineMeters(BOGURA, SHIBGANJ)).toBe(haversineMeters(SHIBGANJ, BOGURA))
  })

  it('returns an integer metre count, never a float', () => {
    const meters = haversineMeters(BOGURA, SHIBGANJ)
    expect(Number.isInteger(meters)).toBe(true)
  })

  it('computes a known short distance to within a metre', () => {
    // One degree of latitude is ~111.19 km on a sphere of the IUGG mean radius.
    const north = { latitude: 25.8465, longitude: 89.3776 }
    expect(haversineMeters(BOGURA, north)).toBeGreaterThan(111000)
    expect(haversineMeters(BOGURA, north)).toBeLessThan(111400)
  })
})

describe('estimateRoadDistance', () => {
  it('applies the circuity factor and records what it used', () => {
    const estimate = estimateRoadDistance(BOGURA, SHIBGANJ, 1.3)
    expect(estimate.roadMeters).toBe(Math.round(estimate.straightLineMeters * 1.3))
    expect(estimate.source).toBe('HAVERSINE_CIRCUITY')
    expect(estimate.circuityFactor).toBe(1.3)
  })

  it('produces an integer metre count that money arithmetic can consume', () => {
    expect(Number.isInteger(estimateRoadDistance(BOGURA, SHIBGANJ, 1.37).roadMeters)).toBe(true)
  })

  it('refuses a factor below 1 — a road cannot be shorter than the great-circle path', () => {
    expect(() => estimateRoadDistance(BOGURA, SHIBGANJ, 0.9)).toThrow(RangeError)
  })
})

describe('resolveCircuityFactor', () => {
  const configured = { default: 1.3, 'district-rajshahi': 1.45 }

  it('prefers a measured district factor over the default', () => {
    expect(resolveCircuityFactor(configured, 'district-rajshahi')).toBe(1.45)
  })

  it('falls back to the default for an uncalibrated corridor', () => {
    expect(resolveCircuityFactor(configured, 'district-bogura')).toBe(1.3)
    expect(resolveCircuityFactor(configured, null)).toBe(1.3)
  })
})

describe('isValidPoint', () => {
  it('rejects the absent coordinates most rural addresses have', () => {
    expect(isValidPoint(null)).toBe(false)
    expect(isValidPoint(undefined)).toBe(false)
  })

  it('rejects out-of-range and non-finite coordinates', () => {
    expect(isValidPoint({ latitude: 91, longitude: 0 })).toBe(false)
    expect(isValidPoint({ latitude: 0, longitude: 181 })).toBe(false)
    expect(isValidPoint({ latitude: Number.NaN, longitude: 0 })).toBe(false)
  })

  it('accepts a Bangladeshi coordinate', () => {
    expect(isValidPoint(BOGURA)).toBe(true)
  })
})

describe('kmFromMeters', () => {
  it('rounds to one decimal for display only', () => {
    expect(kmFromMeters(12000)).toBe(12)
    expect(kmFromMeters(12450)).toBe(12.5)
  })
})
