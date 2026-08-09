/**
 * The unit conversion table — the single, explicit, testable source of truth for how
 * agricultural quantities convert in Bangladesh.
 *
 * Two rules govern everything here:
 *
 *  1. **Metric is authoritative.** Every quantity is stored as an integer count of base units
 *     (milligram, millilitre, piece). Local units are a presentation and input layer over that
 *     integer, never a storage format.
 *  2. **Every conversion is exact.** No supported unit rounds. Milligrams are the mass base
 *     precisely so `seer` and `mon` land on integers — see docs/02_DATABASE.md §6.1.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §5, docs/02_DATABASE.md §6, §6.1
 */

import type { BaseUnit, SaleUnit, UnitDefinition } from './types.js'

/**
 * Exact conversions.
 *
 * `seer` is 80 tola = 0.93310 kg exactly, and `mon` (maund) is 40 seer = 37.3240 kg. These are
 * the traditional definitions still used in wholesale produce trade. They are recorded here to
 * five decimal places of a kilogram because that is what they actually are, not what is
 * convenient.
 */
export const UNITS: Readonly<Record<SaleUnit, UnitDefinition>> = {
  MILLIGRAM: { base: 'MILLIGRAM', baseUnitsPer: 1n, labelEn: 'mg', labelBn: 'মিগ্রা' },
  GRAM: { base: 'MILLIGRAM', baseUnitsPer: 1000n, labelEn: 'g', labelBn: 'গ্রাম' },
  KG: { base: 'MILLIGRAM', baseUnitsPer: 1000000n, labelEn: 'kg', labelBn: 'কেজি' },
  SEER: { base: 'MILLIGRAM', baseUnitsPer: 933100n, labelEn: 'seer', labelBn: 'সের' },
  MON: { base: 'MILLIGRAM', baseUnitsPer: 37324000n, labelEn: 'mon', labelBn: 'মণ' },
  TONNE: { base: 'MILLIGRAM', baseUnitsPer: 1000000000n, labelEn: 't', labelBn: 'টন' },

  MILLILITRE: { base: 'MILLILITRE', baseUnitsPer: 1n, labelEn: 'ml', labelBn: 'মিলি' },
  LITRE: { base: 'MILLILITRE', baseUnitsPer: 1000n, labelEn: 'L', labelBn: 'লিটার' },

  PIECE: { base: 'PIECE', baseUnitsPer: 1n, labelEn: 'pc', labelBn: 'টি' },
  HALI: { base: 'PIECE', baseUnitsPer: 4n, labelEn: 'hali', labelBn: 'হালি' },
  DOZEN: { base: 'PIECE', baseUnitsPer: 12n, labelEn: 'dozen', labelBn: 'ডজন' },
} as const

/** Units a seller may reasonably price in, grouped by what they measure. */
export const SALE_UNITS_BY_BASE: Readonly<Record<BaseUnit, readonly SaleUnit[]>> = {
  MILLIGRAM: ['KG', 'GRAM', 'SEER', 'MON', 'TONNE', 'MILLIGRAM'],
  MILLILITRE: ['LITRE', 'MILLILITRE'],
  PIECE: ['PIECE', 'HALI', 'DOZEN'],
} as const

export function unitDefinition(unit: SaleUnit): UnitDefinition {
  return UNITS[unit]
}

/** How many base units one of this sale unit is worth. Exact, always. */
export function baseUnitsPer(unit: SaleUnit): bigint {
  return UNITS[unit].baseUnitsPer
}

/** Which base unit this sale unit measures in. */
export function baseUnitFor(unit: SaleUnit): BaseUnit {
  return UNITS[unit].base
}

/** Two units are compatible when they measure the same physical dimension. */
export function areCompatible(a: SaleUnit, b: SaleUnit): boolean {
  return UNITS[a].base === UNITS[b].base
}
