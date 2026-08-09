/**
 * Money formatting for Bangladesh.
 *
 * Grouping follows the South Asian convention (last three digits, then groups of two), because
 * that is how amounts are read and written in Bangladesh: ৳১,২৩,৪৫৬.৭৮ is one lakh twenty-three
 * thousand, not one hundred twenty-three thousand.
 *
 * Formatting is implemented directly rather than through `Intl` so output is byte-identical
 * across Node builds, CI images and browsers. A money figure that renders differently in two
 * places is a support ticket.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §1, §5
 */

import { POISHA_PER_TAKA } from './money.js'
import type { FormatOptions, MoneyLocale, Poisha } from './types.js'

const TAKA_SYMBOL = '৳'
const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const

function toBanglaDigits(input: string): string {
  let out = ''
  for (const character of input) {
    const digit = BANGLA_DIGITS[character.charCodeAt(0) - 48]
    out += digit === undefined ? character : digit
  }
  return out
}

/** `123456` → `1,23,456`. */
function groupSouthAsian(digits: string): string {
  if (digits.length <= 3) return digits

  const lastThree = digits.slice(-3)
  let rest = digits.slice(0, -3)
  const groups: string[] = []
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2))
    rest = rest.slice(0, -2)
  }
  groups.unshift(rest)
  groups.push(lastThree)
  return groups.join(',')
}

function localize(text: string, locale: MoneyLocale): string {
  return locale === 'bn' ? toBanglaDigits(text) : text
}

/**
 * Format money for display: `৳1,234.50` (en) or `৳১,২৩৪.৫০` (bn).
 *
 * The sign leads the symbol (`-৳50.00`) because a minus tucked between the symbol and the
 * digits is easy to miss, and a farmer misreading a deduction as a credit is a trust failure.
 */
export function format(value: Poisha, options: FormatOptions = {}): string {
  const locale = options.locale ?? 'en'
  const withSymbol = options.withSymbol ?? true

  const negative = value < 0n
  const magnitude = negative ? -value : value
  const whole = (magnitude / POISHA_PER_TAKA).toString()
  const fraction = (magnitude % POISHA_PER_TAKA).toString().padStart(2, '0')

  const body = `${groupSouthAsian(whole)}.${fraction}`
  const symbol = withSymbol ? TAKA_SYMBOL : ''
  return `${negative ? '-' : ''}${symbol}${localize(body, locale)}`
}
