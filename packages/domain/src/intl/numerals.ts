/**
 * Bangla ⇄ ASCII digit transliteration.
 *
 * Shared by money and quantity formatting. Many Bangladeshi users read prices comfortably in
 * Western digits even inside a Bangla interface, so digit rendering is a display preference
 * rather than a consequence of the interface language.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §1
 */

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const
const ASCII_ZERO = 48

/** `1234` → `১২৩৪`. Non-digit characters pass through untouched. */
export function toBanglaDigits(input: string): string {
  let out = ''
  for (const character of input) {
    const digit = BANGLA_DIGITS[character.charCodeAt(0) - ASCII_ZERO]
    out += digit === undefined ? character : digit
  }
  return out
}

/** `১২৩৪` → `1234`. Non-digit characters pass through untouched. */
export function toAsciiDigits(input: string): string {
  let out = ''
  for (const character of input) {
    const index = BANGLA_DIGITS.indexOf(character as (typeof BANGLA_DIGITS)[number])
    out += index === -1 ? character : String(index)
  }
  return out
}
