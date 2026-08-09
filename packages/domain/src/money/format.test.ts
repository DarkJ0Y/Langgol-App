import { describe, expect, it } from 'vitest'
import { Money } from './index.js'

describe('format', () => {
  it('formats with the taka symbol and two decimals by default', () => {
    expect(Money.format(Money.fromTaka('1234.50'))).toBe('৳1,234.50')
    expect(Money.format(Money.fromTaka('0'))).toBe('৳0.00')
    expect(Money.format(Money.fromTaka('0.07'))).toBe('৳0.07')
  })

  it('formats in Bangla digits', () => {
    expect(Money.format(Money.fromTaka('1234.50'), { locale: 'bn' })).toBe('৳১,২৩৪.৫০')
    expect(Money.format(Money.fromTaka('0.09'), { locale: 'bn' })).toBe('৳০.০৯')
  })

  it('can omit the symbol', () => {
    expect(Money.format(Money.fromTaka('1234.50'), { withSymbol: false })).toBe('1,234.50')
    expect(Money.format(Money.fromTaka('1234.50'), { locale: 'bn', withSymbol: false })).toBe(
      '১,২৩৪.৫০',
    )
  })

  it('puts the sign before the symbol so a deduction cannot be misread', () => {
    expect(Money.format(Money.fromTaka('-50.00'))).toBe('-৳50.00')
    expect(Money.format(Money.fromTaka('-50.00'), { locale: 'bn' })).toBe('-৳৫০.০০')
  })

  it('groups in the South Asian convention, not the Western one', () => {
    expect(Money.format(Money.fromTaka('100'), { withSymbol: false })).toBe('100.00')
    expect(Money.format(Money.fromTaka('1000'), { withSymbol: false })).toBe('1,000.00')
    // One lakh twenty-three thousand — not "one hundred twenty-three thousand".
    expect(Money.format(Money.fromTaka('123456'), { withSymbol: false })).toBe('1,23,456.00')
    // One crore.
    expect(Money.format(Money.fromTaka('12345678'), { withSymbol: false })).toBe('1,23,45,678.00')
  })

  it('is stable for the amounts a farmer actually sees', () => {
    expect(Money.format(Money.fromTaka('145.50'), { locale: 'bn' })).toBe('৳১৪৫.৫০')
    expect(Money.format(Money.fromTaka('20000'), { locale: 'bn' })).toBe('৳২০,০০০.০০')
  })
})
