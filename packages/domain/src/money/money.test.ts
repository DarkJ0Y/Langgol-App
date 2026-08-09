import { describe, expect, it } from 'vitest'
import { Money, MoneyError } from './index.js'
import type { Poisha } from './types.js'

/** Convenience: a Poisha from a plain poisha count, for terse test setup. */
const p = (value: bigint | number | string): Poisha => Money.fromPoisha(value)

/** Assert a MoneyError with a specific code, rather than just "it threw something". */
function expectMoneyError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(MoneyError)
    expect((error as MoneyError).code).toBe(code)
    return
  }
  throw new Error(`Expected a MoneyError with code ${code}, but nothing was thrown`)
}

describe('construction', () => {
  it('creates zero', () => {
    expect(Money.isZero(Money.zero)).toBe(true)
    expect(Money.toTakaString(Money.zero)).toBe('0.00')
  })

  it('accepts a bigint poisha count', () => {
    expect(Money.toTakaString(Money.fromPoisha(10050n))).toBe('100.50')
  })

  it('accepts a safe-integer number', () => {
    expect(Money.toTakaString(Money.fromPoisha(10050))).toBe('100.50')
  })

  it('rejects a non-integer number', () => {
    expectMoneyError(() => Money.fromPoisha(100.5), 'INVALID_INPUT')
  })

  it('rejects an unsafe-integer number', () => {
    expectMoneyError(() => Money.fromPoisha(Number.MAX_SAFE_INTEGER + 2), 'INVALID_INPUT')
  })

  it('accepts a digit string, signed or unsigned', () => {
    expect(Money.toTakaString(Money.fromPoisha('10050'))).toBe('100.50')
    expect(Money.toTakaString(Money.fromPoisha('-10050'))).toBe('-100.50')
    expect(Money.toTakaString(Money.fromPoisha('  10050  '))).toBe('100.50')
  })

  it('rejects a non-numeric string', () => {
    expectMoneyError(() => Money.fromPoisha('12.5'), 'INVALID_INPUT')
    expectMoneyError(() => Money.fromPoisha('abc'), 'INVALID_INPUT')
    expectMoneyError(() => Money.fromPoisha(''), 'INVALID_INPUT')
  })
})

describe('fromTaka', () => {
  it('parses whole taka', () => {
    expect(Money.serialize(Money.fromTaka('150'))).toBe('15000')
  })

  it('parses one and two decimal places', () => {
    expect(Money.serialize(Money.fromTaka('100.5'))).toBe('10050')
    expect(Money.serialize(Money.fromTaka('100.50'))).toBe('10050')
    expect(Money.serialize(Money.fromTaka('0.07'))).toBe('7')
  })

  it('parses negative amounts, which a ledger legitimately needs', () => {
    expect(Money.serialize(Money.fromTaka('-100.50'))).toBe('-10050')
  })

  it('tolerates surrounding whitespace', () => {
    expect(Money.serialize(Money.fromTaka('  12.34 '))).toBe('1234')
  })

  it('refuses sub-poisha precision rather than truncating it silently', () => {
    expectMoneyError(() => Money.fromTaka('100.505'), 'PRECISION_LOSS')
    expectMoneyError(() => Money.fromTaka('0.0001'), 'PRECISION_LOSS')
  })

  it('rejects malformed input', () => {
    expectMoneyError(() => Money.fromTaka('12.'), 'INVALID_INPUT')
    expectMoneyError(() => Money.fromTaka('.5'), 'INVALID_INPUT')
    expectMoneyError(() => Money.fromTaka('12abc'), 'INVALID_INPUT')
    expectMoneyError(() => Money.fromTaka('1,234.00'), 'INVALID_INPUT')
    expectMoneyError(() => Money.fromTaka(''), 'INVALID_INPUT')
  })

  it('never uses floating point: 0.1 + 0.2 is exact', () => {
    const a = Money.fromTaka('0.1')
    const b = Money.fromTaka('0.2')
    expect(Money.serialize(Money.add(a, b))).toBe('30')
    expect(Money.toTakaString(Money.add(a, b))).toBe('0.30')
  })
})

describe('human input parsing', () => {
  it('converts Bangla digits', () => {
    expect(Money.normalizeDigits('১২৩৪.৫৬')).toBe('1234.56')
    expect(Money.normalizeDigits('abc')).toBe('abc')
  })

  it('accepts symbols, grouping and whitespace as a farmer would type them', () => {
    expect(Money.serialize(Money.parseTakaInput('৳1,234.50'))).toBe('123450')
    expect(Money.serialize(Money.parseTakaInput('৳ ১,২৩৪.৫০'))).toBe('123450')
    expect(Money.serialize(Money.parseTakaInput(' 1 234 . 50 '))).toBe('123450')
  })

  it('is lenient about presentation but never about precision', () => {
    expectMoneyError(() => Money.parseTakaInput('৳1,234.567'), 'PRECISION_LOSS')
  })
})

describe('serialisation', () => {
  it('round-trips through a string, because bigint is not JSON-representable', () => {
    const amount = Money.fromTaka('98765.43')
    expect(Money.serialize(amount)).toBe('9876543')
    expect(Money.equals(Money.deserialize(Money.serialize(amount)), amount)).toBe(true)
  })
})

describe('range guarding', () => {
  it('accepts the boundary values', () => {
    expect(Money.serialize(Money.fromPoisha(Money.MAX_POISHA))).toBe(Money.MAX_POISHA.toString())
    expect(Money.serialize(Money.fromPoisha(Money.MIN_POISHA))).toBe(Money.MIN_POISHA.toString())
  })

  it('rejects values beyond the representable range', () => {
    expectMoneyError(() => Money.fromPoisha(Money.MAX_POISHA + 1n), 'OUT_OF_RANGE')
    expectMoneyError(() => Money.fromPoisha(Money.MIN_POISHA - 1n), 'OUT_OF_RANGE')
  })

  it('rejects an overflow produced by arithmetic, not just by construction', () => {
    const big = Money.fromPoisha(Money.MAX_POISHA)
    expectMoneyError(() => Money.add(big, p(1)), 'OUT_OF_RANGE')
    expectMoneyError(() => Money.subtract(Money.negate(big), p(1)), 'OUT_OF_RANGE')
    expectMoneyError(() => Money.multiply(big, 2), 'OUT_OF_RANGE')
    expectMoneyError(() => Money.sum([big, big]), 'OUT_OF_RANGE')
    expectMoneyError(() => Money.multiplyByRatio(big, 3, 1), 'OUT_OF_RANGE')
  })
})

describe('addition and subtraction', () => {
  it('adds', () => {
    expect(Money.serialize(Money.add(p(15000), p(9600)))).toBe('24600')
  })

  it('subtracts, including into negative territory', () => {
    expect(Money.serialize(Money.subtract(p(15000), p(450)))).toBe('14550')
    expect(Money.serialize(Money.subtract(p(100), p(300)))).toBe('-200')
  })

  it('sums a list, and an empty list is zero', () => {
    expect(Money.serialize(Money.sum([p(15000), p(9600), p(1000)]))).toBe('25600')
    expect(Money.serialize(Money.sum([]))).toBe('0')
  })
})

describe('multiplication', () => {
  it('multiplies by a whole number of units', () => {
    expect(Money.serialize(Money.multiply(p(3000), 5))).toBe('15000')
    expect(Money.serialize(Money.multiply(p(3000), 5n))).toBe('15000')
    expect(Money.serialize(Money.multiply(p(3000), 0))).toBe('0')
    expect(Money.serialize(Money.multiply(p(3000), -2))).toBe('-6000')
  })

  it('refuses a fractional factor — that is a rate, and rates use basis points', () => {
    expectMoneyError(() => Money.multiply(p(3000), 1.5), 'INVALID_INPUT')
  })
})

describe('division and half-up rounding', () => {
  it('divides exactly when there is no remainder', () => {
    expect(Money.serialize(Money.divide(p(15000), 5))).toBe('3000')
  })

  it('rounds a tie away from zero', () => {
    expect(Money.serialize(Money.divide(p(5), 2))).toBe('3') // 2.5 → 3
    expect(Money.serialize(Money.divide(p(-5), 2))).toBe('-3') // −2.5 → −3
    expect(Money.serialize(Money.divide(p(3), 2))).toBe('2') // 1.5 → 2
  })

  it('rounds below the tie toward zero', () => {
    expect(Money.serialize(Money.divide(p(1), 3))).toBe('0')
    expect(Money.serialize(Money.divide(p(-1), 3))).toBe('0')
    expect(Money.serialize(Money.divide(p(7), 4))).toBe('2') // 1.75 → 2
  })

  it('truncates toward zero when asked', () => {
    expect(Money.serialize(Money.divide(p(5), 2, 'TRUNCATE'))).toBe('2')
    expect(Money.serialize(Money.divide(p(-5), 2, 'TRUNCATE'))).toBe('-2')
  })

  it('handles a negative divisor by moving the sign to the numerator', () => {
    expect(Money.serialize(Money.divide(p(15000), -5))).toBe('-3000')
    expect(Money.serialize(Money.divide(p(5), -2))).toBe('-3')
  })

  it('rejects division by zero', () => {
    expectMoneyError(() => Money.divide(p(100), 0), 'DIVISION_BY_ZERO')
  })
})

describe('ratios and basis points', () => {
  it('scales by an exact rational', () => {
    // A 5 kg line at ৳30.00/kg: unitPrice × quantityBase / saleUnitInBaseUnits
    expect(Money.serialize(Money.multiplyByRatio(p(3000), 5000, 1000))).toBe('15000')
  })

  it('applies the approved 3% commission exactly', () => {
    // docs/06 §5: ৳150.00 produce at 300 bps → ৳4.50 commission, ৳145.50 to the farmer.
    const sellerGross = Money.fromTaka('150.00')
    const commissionBps = 300
    const commission = Money.percentBps(sellerGross, commissionBps)
    expect(Money.toTakaString(commission)).toBe('4.50')
    expect(Money.toTakaString(Money.subtract(sellerGross, commission))).toBe('145.50')
  })

  it('rounds commission half-up at the poisha', () => {
    // ৳0.15 at 300 bps = 0.45 poisha → 0 poisha (below the tie)
    expect(Money.serialize(Money.percentBps(p(15), 300))).toBe('0')
    // ৳1.50 at 300 bps = 4.5 poisha → 5 poisha (tie, away from zero)
    expect(Money.serialize(Money.percentBps(p(150), 300))).toBe('5')
  })

  it('supports truncation for conservative rate application', () => {
    expect(Money.serialize(Money.percentBps(p(150), 300, 'TRUNCATE'))).toBe('4')
  })

  it('accepts bigint rates', () => {
    expect(Money.serialize(Money.percentBps(p(10000), 300n))).toBe('300')
  })

  it('rejects a non-integer rate', () => {
    expectMoneyError(() => Money.multiplyByRatio(p(100), 1.5, 2), 'INVALID_INPUT')
    expectMoneyError(() => Money.multiplyByRatio(p(100), 1, 2.5), 'INVALID_INPUT')
  })
})

describe('allocation', () => {
  it('splits exactly, with no poisha created or destroyed', () => {
    const shares = Money.allocate(p(10000), [1n, 1n, 1n], 0)
    expect(shares.map(Money.serialize)).toEqual(['3334', '3333', '3333'])
    expect(Money.serialize(Money.sum(shares))).toBe('10000')
  })

  it('gives the remainder to the nominated index, not silently to the first', () => {
    const toLast = Money.allocate(p(10000), [1n, 1n, 1n], 2)
    expect(toLast.map(Money.serialize)).toEqual(['3333', '3333', '3334'])
    expect(Money.serialize(Money.sum(toLast))).toBe('10000')
  })

  it('splits proportionally by weight', () => {
    const shares = Money.allocate(p(10000), [3n, 1n], 0)
    expect(shares.map(Money.serialize)).toEqual(['7500', '2500'])
  })

  it('tolerates zero weights among non-zero ones', () => {
    const shares = Money.allocate(p(100), [0n, 1n], 1)
    expect(shares.map(Money.serialize)).toEqual(['0', '100'])
  })

  it('handles a zero total', () => {
    const shares = Money.allocate(Money.zero, [1n, 2n], 0)
    expect(shares.map(Money.serialize)).toEqual(['0', '0'])
  })

  it('rejects a negative total', () => {
    expectMoneyError(() => Money.allocate(p(-100), [1n], 0), 'NEGATIVE_NOT_ALLOWED')
  })

  it('rejects an empty, negative or zero-sum weight set', () => {
    expectMoneyError(() => Money.allocate(p(100), [], 0), 'INVALID_ALLOCATION')
    expectMoneyError(() => Money.allocate(p(100), [1n, -1n], 0), 'INVALID_ALLOCATION')
    expectMoneyError(() => Money.allocate(p(100), [0n, 0n], 0), 'INVALID_ALLOCATION')
  })

  it('rejects an out-of-bounds or non-integer remainder index', () => {
    expectMoneyError(() => Money.allocate(p(100), [1n, 1n], -1), 'INVALID_ALLOCATION')
    expectMoneyError(() => Money.allocate(p(100), [1n, 1n], 2), 'INVALID_ALLOCATION')
    expectMoneyError(() => Money.allocate(p(100), [1n, 1n], 0.5), 'INVALID_ALLOCATION')
  })
})

describe('comparison and sign', () => {
  it('compares', () => {
    expect(Money.compare(p(1), p(2))).toBe(-1)
    expect(Money.compare(p(2), p(1))).toBe(1)
    expect(Money.compare(p(2), p(2))).toBe(0)
  })

  it('reports equality and sign', () => {
    expect(Money.equals(p(5), p(5))).toBe(true)
    expect(Money.equals(p(5), p(6))).toBe(false)
    expect(Money.isZero(p(0))).toBe(true)
    expect(Money.isZero(p(1))).toBe(false)
    expect(Money.isPositive(p(1))).toBe(true)
    expect(Money.isPositive(p(0))).toBe(false)
    expect(Money.isNegative(p(-1))).toBe(true)
    expect(Money.isNegative(p(0))).toBe(false)
  })

  it('negates and takes absolute value', () => {
    expect(Money.serialize(Money.negate(p(500)))).toBe('-500')
    expect(Money.serialize(Money.negate(p(-500)))).toBe('500')
    expect(Money.serialize(Money.abs(p(-500)))).toBe('500')
    expect(Money.serialize(Money.abs(p(500)))).toBe('500')
  })

  it('takes min and max', () => {
    expect(Money.serialize(Money.min(p(1), p(2)))).toBe('1')
    expect(Money.serialize(Money.min(p(2), p(1)))).toBe('1')
    expect(Money.serialize(Money.max(p(1), p(2)))).toBe('2')
    expect(Money.serialize(Money.max(p(2), p(1)))).toBe('2')
  })
})

describe('requireNonNegative', () => {
  it('passes a non-negative amount through', () => {
    expect(Money.serialize(Money.requireNonNegative(p(0), 'unitPrice'))).toBe('0')
    expect(Money.serialize(Money.requireNonNegative(p(100), 'unitPrice'))).toBe('100')
  })

  it('rejects a negative amount where the domain forbids one', () => {
    expectMoneyError(() => Money.requireNonNegative(p(-1), 'unitPrice'), 'NEGATIVE_NOT_ALLOWED')
  })
})

describe('MoneyError', () => {
  it('carries a code, a message and optional detail', () => {
    const withDetail = new MoneyError('INVALID_INPUT', 'bad', 'detail')
    expect(withDetail.name).toBe('MoneyError')
    expect(withDetail.code).toBe('INVALID_INPUT')
    expect(withDetail.message).toBe('bad')
    expect(withDetail.detail).toBe('detail')
    expect(new MoneyError('INVALID_INPUT', 'bad').detail).toBeUndefined()
  })
})

describe('worked order from docs/06 §5.1', () => {
  it('reproduces the ৳256.00 cash-on-delivery order exactly', () => {
    const unitPrice = Money.fromTaka('30.00') // per kg
    const quantityGrams = 5000n
    const gramsPerKg = 1000n

    const lineTotal = Money.multiplyByRatio(unitPrice, quantityGrams, gramsPerKg)
    const delivery = Money.fromTaka('96.00')
    const handling = Money.fromTaka('10.00')

    const buyerTotal = Money.sum([lineTotal, delivery, handling])
    const commissionBps = 300
    const commission = Money.percentBps(lineTotal, commissionBps)
    const farmerNet = Money.subtract(lineTotal, commission)

    expect(Money.toTakaString(lineTotal)).toBe('150.00')
    expect(Money.toTakaString(buyerTotal)).toBe('256.00')
    expect(Money.toTakaString(commission)).toBe('4.50')
    expect(Money.toTakaString(farmerNet)).toBe('145.50')

    // The ledger must balance: what the buyer paid equals what everyone received.
    const credits = Money.sum([farmerNet, commission, delivery, handling])
    expect(Money.equals(credits, buyerTotal)).toBe(true)
  })
})
