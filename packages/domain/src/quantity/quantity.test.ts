import { describe, expect, it } from 'vitest'
import { Quantity, QuantityError } from './index.js'

function expectQuantityError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(QuantityError)
    expect((error as QuantityError).code).toBe(code)
    return
  }
  throw new Error(`Expected a QuantityError with code ${code}, but nothing was thrown`)
}

describe('the conversion table', () => {
  it('is exact for every supported unit — no unit rounds', () => {
    // This is the reason the mass base is the milligram. See docs/02_DATABASE.md §6.1.
    expect(Quantity.baseUnitsPer('MILLIGRAM')).toBe(1n)
    expect(Quantity.baseUnitsPer('GRAM')).toBe(1000n)
    expect(Quantity.baseUnitsPer('KG')).toBe(1000000n)
    expect(Quantity.baseUnitsPer('SEER')).toBe(933100n) // 0.93310 kg exactly
    expect(Quantity.baseUnitsPer('MON')).toBe(37324000n) // 40 seer exactly
    expect(Quantity.baseUnitsPer('TONNE')).toBe(1000000000n)
    expect(Quantity.baseUnitsPer('LITRE')).toBe(1000n)
    expect(Quantity.baseUnitsPer('PIECE')).toBe(1n)
    expect(Quantity.baseUnitsPer('HALI')).toBe(4n) // as eggs and lemons are actually sold
    expect(Quantity.baseUnitsPer('DOZEN')).toBe(12n)
  })

  it('holds the traditional identity: 1 mon = 40 seer, exactly', () => {
    expect(Quantity.baseUnitsPer('MON')).toBe(Quantity.baseUnitsPer('SEER') * 40n)
  })

  it('knows which base unit each sale unit measures', () => {
    expect(Quantity.baseUnitFor('MON')).toBe('MILLIGRAM')
    expect(Quantity.baseUnitFor('LITRE')).toBe('MILLILITRE')
    expect(Quantity.baseUnitFor('HALI')).toBe('PIECE')
  })

  it('reports compatibility between units', () => {
    expect(Quantity.areCompatible('KG', 'MON')).toBe(true)
    expect(Quantity.areCompatible('KG', 'LITRE')).toBe(false)
    expect(Quantity.areCompatible('PIECE', 'DOZEN')).toBe(true)
  })

  it('offers sensible sale units per base unit', () => {
    expect(Quantity.SALE_UNITS_BY_BASE.MILLIGRAM).toContain('MON')
    expect(Quantity.SALE_UNITS_BY_BASE.PIECE).toContain('HALI')
    expect(Quantity.unitDefinition('KG').labelBn).toBe('কেজি')
  })
})

describe('toBase', () => {
  it('converts whole amounts', () => {
    expect(Quantity.serialize(Quantity.toBase(5, 'KG'))).toBe('5000000')
    expect(Quantity.serialize(Quantity.toBase(5n, 'KG'))).toBe('5000000')
    expect(Quantity.serialize(Quantity.toBase('5', 'KG'))).toBe('5000000')
  })

  it('converts decimal amounts exactly', () => {
    expect(Quantity.serialize(Quantity.toBase('5.5', 'KG'))).toBe('5500000')
    expect(Quantity.serialize(Quantity.toBase('0.25', 'KG'))).toBe('250000')
    expect(Quantity.serialize(Quantity.toBase('1.5', 'MON'))).toBe('55986000')
  })

  it('converts local units without loss', () => {
    expect(Quantity.serialize(Quantity.toBase('1', 'SEER'))).toBe('933100')
    expect(Quantity.serialize(Quantity.toBase('1', 'MON'))).toBe('37324000')
    expect(Quantity.serialize(Quantity.toBase('3', 'HALI'))).toBe('12')
  })

  it('accepts Bangla numerals as a farmer would type them', () => {
    expect(Quantity.serialize(Quantity.toBase('৫.৫', 'KG'))).toBe('5500000')
    expect(Quantity.serialize(Quantity.toBase('২', 'MON'))).toBe('74648000')
  })

  it('handles negative amounts', () => {
    expect(Quantity.serialize(Quantity.toBase('-2', 'KG'))).toBe('-2000000')
  })

  it('refuses precision it cannot represent, rather than rounding the farmer down', () => {
    // Half a milligram of tomato is not a quantity; it is a typo.
    expectQuantityError(() => Quantity.toBase('0.0000005', 'GRAM'), 'PRECISION_LOSS')
    expectQuantityError(() => Quantity.toBase('1.0000000001', 'KG'), 'PRECISION_LOSS')
  })

  it('rejects malformed input', () => {
    expectQuantityError(() => Quantity.toBase('abc', 'KG'), 'INVALID_INPUT')
    expectQuantityError(() => Quantity.toBase('5.', 'KG'), 'INVALID_INPUT')
    expectQuantityError(() => Quantity.toBase('.5', 'KG'), 'INVALID_INPUT')
    expectQuantityError(() => Quantity.toBase(5.5, 'KG'), 'INVALID_INPUT')
  })

  it('rejects implausible magnitudes', () => {
    expectQuantityError(() => Quantity.toBase('2000000000', 'TONNE'), 'OUT_OF_RANGE')
  })
})

describe('toUnitString', () => {
  it('renders whole numbers without a decimal point', () => {
    expect(Quantity.toUnitString(Quantity.toBase('5', 'KG'), 'KG')).toBe('5')
  })

  it('trims trailing zeros', () => {
    expect(Quantity.toUnitString(Quantity.toBase('5.50', 'KG'), 'KG')).toBe('5.5')
    expect(Quantity.toUnitString(Quantity.toBase('0.250', 'KG'), 'KG')).toBe('0.25')
  })

  it('rounds half-up at the requested precision', () => {
    const oneSeer = Quantity.toBase('1', 'SEER')
    expect(Quantity.toUnitString(oneSeer, 'KG', 3)).toBe('0.933')
    expect(Quantity.toUnitString(oneSeer, 'KG', 2)).toBe('0.93')
    expect(Quantity.toUnitString(oneSeer, 'KG', 0)).toBe('1')
  })

  it('can truncate instead of rounding', () => {
    const oneSeer = Quantity.toBase('1', 'SEER')
    expect(Quantity.toUnitString(oneSeer, 'KG', 0, 'TRUNCATE')).toBe('0')
  })

  it('renders negatives, and does not render "-0"', () => {
    expect(Quantity.toUnitString(Quantity.toBase('-2.5', 'KG'), 'KG')).toBe('-2.5')
    expect(Quantity.toUnitString(Quantity.toBase('-1', 'MILLIGRAM'), 'KG', 0)).toBe('0')
  })

  it('rejects a nonsensical precision request', () => {
    const q = Quantity.toBase('1', 'KG')
    expectQuantityError(() => Quantity.toUnitString(q, 'KG', -1), 'INVALID_INPUT')
    expectQuantityError(() => Quantity.toUnitString(q, 'KG', 20), 'INVALID_INPUT')
    expectQuantityError(() => Quantity.toUnitString(q, 'KG', 1.5), 'INVALID_INPUT')
  })
})

describe('convert', () => {
  it('converts between metric and local mass units', () => {
    expect(Quantity.convert('1', 'MON', 'KG')).toBe('37.324')
    expect(Quantity.convert('1', 'SEER', 'KG')).toBe('0.933')
    expect(Quantity.convert('1', 'SEER', 'GRAM')).toBe('933.1')
    expect(Quantity.convert('40', 'SEER', 'MON')).toBe('1')
    expect(Quantity.convert('37.324', 'KG', 'MON')).toBe('1')
  })

  it('converts counts', () => {
    expect(Quantity.convert('1', 'DOZEN', 'PIECE')).toBe('12')
    expect(Quantity.convert('3', 'HALI', 'PIECE')).toBe('12')
    expect(Quantity.convert('12', 'PIECE', 'HALI')).toBe('3')
  })

  it('refuses to convert across dimensions rather than guessing', () => {
    expectQuantityError(() => Quantity.convert('1', 'KG', 'LITRE'), 'INCOMPATIBLE_UNITS')
    expectQuantityError(() => Quantity.convert('1', 'PIECE', 'KG'), 'INCOMPATIBLE_UNITS')
  })

  it('round-trips a wholesale lot without drift', () => {
    // The scenario the milligram base exists for: quote in mon, settle in kg, back to mon.
    const asKg = Quantity.convert('12', 'MON', 'KG', 6)
    expect(asKg).toBe('447.888')
    expect(Quantity.convert(asKg, 'KG', 'MON', 6)).toBe('12')
  })
})

describe('exactness', () => {
  it('reports whether a quantity is a whole number of a unit', () => {
    expect(Quantity.isExactIn(Quantity.toBase('2', 'MON'), 'MON')).toBe(true)
    expect(Quantity.isExactIn(Quantity.toBase('2.5', 'KG'), 'MON')).toBe(false)
  })
})

describe('arithmetic', () => {
  const kg = (n: string) => Quantity.toBase(n, 'KG')

  it('adds and subtracts', () => {
    expect(Quantity.toUnitString(Quantity.add(kg('2'), kg('3.5')), 'KG')).toBe('5.5')
    expect(Quantity.toUnitString(Quantity.subtract(kg('5'), kg('1.25')), 'KG')).toBe('3.75')
  })

  it('multiplies by a whole factor', () => {
    expect(Quantity.toUnitString(Quantity.multiply(kg('2.5'), 4), 'KG')).toBe('10')
    expect(Quantity.toUnitString(Quantity.multiply(kg('2.5'), 4n), 'KG')).toBe('10')
    expectQuantityError(() => Quantity.multiply(kg('1'), 1.5), 'INVALID_INPUT')
  })

  it('guards range on arithmetic', () => {
    const huge = Quantity.fromBaseUnits(Quantity.MAX_BASE_QUANTITY)
    expectQuantityError(() => Quantity.add(huge, Quantity.fromBaseUnits(1n)), 'OUT_OF_RANGE')
    expectQuantityError(() => Quantity.multiply(huge, 2), 'OUT_OF_RANGE')
    expectQuantityError(
      () => Quantity.subtract(Quantity.fromBaseUnits(-Quantity.MAX_BASE_QUANTITY), kg('1')),
      'OUT_OF_RANGE',
    )
  })

  it('compares and detects zero', () => {
    expect(Quantity.compare(kg('1'), kg('2'))).toBe(-1)
    expect(Quantity.compare(kg('2'), kg('1'))).toBe(1)
    expect(Quantity.compare(kg('2'), kg('2'))).toBe(0)
    expect(Quantity.isZero(Quantity.zero)).toBe(true)
    expect(Quantity.isZero(kg('1'))).toBe(false)
  })
})

describe('base-unit construction and serialisation', () => {
  it('accepts bigint, number and string base counts', () => {
    expect(Quantity.serialize(Quantity.fromBaseUnits(5000000n))).toBe('5000000')
    expect(Quantity.serialize(Quantity.fromBaseUnits(5000000))).toBe('5000000')
    expect(Quantity.serialize(Quantity.fromBaseUnits('5000000'))).toBe('5000000')
    expect(Quantity.serialize(Quantity.fromBaseUnits('-5000000'))).toBe('-5000000')
  })

  it('rejects nonsense', () => {
    expectQuantityError(() => Quantity.fromBaseUnits(1.5), 'INVALID_INPUT')
    expectQuantityError(() => Quantity.fromBaseUnits('1.5'), 'INVALID_INPUT')
    expectQuantityError(() => Quantity.fromBaseUnits('abc'), 'INVALID_INPUT')
    expectQuantityError(
      () => Quantity.fromBaseUnits(Quantity.MAX_BASE_QUANTITY + 1n),
      'OUT_OF_RANGE',
    )
  })

  it('round-trips through a string', () => {
    const q = Quantity.toBase('12.5', 'KG')
    expect(Quantity.compare(Quantity.deserialize(Quantity.serialize(q)), q)).toBe(0)
  })
})

describe('guards', () => {
  it('requires a positive listing quantity', () => {
    expect(Quantity.serialize(Quantity.requirePositive(Quantity.toBase('1', 'KG'), 'qty'))).toBe(
      '1000000',
    )
    expectQuantityError(
      () => Quantity.requirePositive(Quantity.zero, 'qty'),
      'NEGATIVE_NOT_ALLOWED',
    )
    expectQuantityError(
      () => Quantity.requirePositive(Quantity.toBase('-1', 'KG'), 'qty'),
      'NEGATIVE_NOT_ALLOWED',
    )
  })

  it('allows zero available stock but not negative', () => {
    expect(Quantity.isZero(Quantity.requireNonNegative(Quantity.zero, 'available'))).toBe(true)
    expectQuantityError(
      () => Quantity.requireNonNegative(Quantity.toBase('-1', 'KG'), 'available'),
      'NEGATIVE_NOT_ALLOWED',
    )
  })
})

describe('QuantityError', () => {
  it('carries a code and optional detail', () => {
    const error = new QuantityError('INVALID_INPUT', 'bad', 'detail')
    expect(error.name).toBe('QuantityError')
    expect(error.code).toBe('INVALID_INPUT')
    expect(error.detail).toBe('detail')
    expect(new QuantityError('INVALID_INPUT', 'bad').detail).toBeUndefined()
  })
})

describe('format', () => {
  it('renders English by default', () => {
    expect(Quantity.format(Quantity.toBase('5.5', 'KG'), 'KG')).toBe('5.5 kg')
    expect(Quantity.format(Quantity.toBase('1', 'MON'), 'MON')).toBe('1 mon')
  })

  it('renders Bangla numerals with Bangla unit labels', () => {
    expect(Quantity.format(Quantity.toBase('5.5', 'KG'), 'KG', { locale: 'bn' })).toBe('৫.৫ কেজি')
    expect(Quantity.format(Quantity.toBase('2', 'MON'), 'MON', { locale: 'bn' })).toBe('২ মণ')
    expect(Quantity.format(Quantity.toBase('3', 'HALI'), 'HALI', { locale: 'bn' })).toBe('৩ হালি')
  })

  it('can omit the unit and control precision', () => {
    const q = Quantity.toBase('1', 'SEER')
    expect(Quantity.format(q, 'KG', { withUnit: false })).toBe('0.933')
    expect(Quantity.format(q, 'KG', { maxDecimals: 1 })).toBe('0.9 kg')
  })
})
