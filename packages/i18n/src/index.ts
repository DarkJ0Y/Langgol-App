/**
 * Localisation for Langgol.
 *
 * Bangla is the default locale. English is the toggle. Every user-facing string comes from a
 * catalogue — there is no path by which a hard-coded English string reaches a farmer's screen.
 *
 * Formatting is implemented directly rather than through `Intl` so output is byte-identical
 * across Node builds, CI images and browsers, and so Bangla month names and digit preferences
 * are exactly what we chose rather than what an ICU build happens to carry.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §1, §2, §5
 */

import { Money, Quantity, toBanglaDigits, type Poisha, type SaleUnit } from '@langgol/domain'
import { bn } from './messages/bn.js'
import { en, type Catalogue } from './messages/en.js'

export type Locale = 'bn' | 'en'
export const LOCALES: readonly Locale[] = ['bn', 'en']
export const DEFAULT_LOCALE: Locale = 'bn'

export type Messages = Catalogue
export const catalogues: Record<Locale, Messages> = { bn, en }

export function isLocale(value: string): value is Locale {
  return value === 'bn' || value === 'en'
}

/** Bangladesh Standard Time. All display is in Dhaka time; storage stays UTC. */
export const DISPLAY_TIMEZONE = 'Asia/Dhaka'
const DHAKA_OFFSET_MINUTES = 6 * 60

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** Gregorian month names as used in Bangladeshi Bangla writing. */
const MONTHS_BN = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
] as const

type PathOf<T> = T extends object
  ? { [K in keyof T & string]: T[K] extends object ? `${K}.${PathOf<T[K]>}` : K }[keyof T & string]
  : never

/** Every message key, checked at compile time. A typo is a build failure, not a blank screen. */
export type MessageKey = PathOf<Messages>

export interface Translator {
  readonly locale: Locale
  /** Look up a message and interpolate `{named}` placeholders. */
  t(key: MessageKey, values?: Readonly<Record<string, string | number>>): string
  /** Render digits per the reader's preference. */
  digits(value: string | number): string
  formatMoney(amount: Poisha, options?: { readonly withSymbol?: boolean }): string
  formatQuantity(quantity: bigint, unit: SaleUnit): string
  formatDate(value: Date): string
  formatDateTime(value: Date): string
}

function lookup(messages: Messages, key: string): string | undefined {
  let current: unknown = messages
  for (const segment of key.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' ? current : undefined
}

function interpolate(
  template: string,
  values: Readonly<Record<string, string | number>> | undefined,
  toDigits: (input: string) => string,
): string {
  if (values === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    if (value === undefined) return match
    return typeof value === 'number' ? toDigits(String(value)) : value
  })
}

/** Shift a UTC instant into Dhaka wall-clock time for display. */
function toDhaka(value: Date): Date {
  return new Date(value.getTime() + DHAKA_OFFSET_MINUTES * 60 * 1000)
}

export interface TranslatorOptions {
  /**
   * Render numbers in Bangla digits. Defaults to `true` for `bn`.
   *
   * A user preference rather than a consequence of the interface language: many Bangladeshi
   * readers are more comfortable with Western digits for prices even inside a Bangla interface.
   */
  readonly banglaNumerals?: boolean
}

export function createTranslator(locale: Locale, options: TranslatorOptions = {}): Translator {
  const messages = catalogues[locale]
  const useBanglaNumerals = options.banglaNumerals ?? locale === 'bn'
  const digits = (value: string | number): string =>
    useBanglaNumerals ? toBanglaDigits(String(value)) : String(value)

  return {
    locale,

    t(key, values) {
      const template = lookup(messages, key)
      if (template === undefined) {
        // Fall back to the key itself. A visible `auth.signInTitle` on screen is an obvious bug
        // report; a blank space is a silent one that ships.
        return key
      }
      return interpolate(template, values, digits)
    },

    digits,

    formatMoney(amount, moneyOptions) {
      return Money.format(amount, {
        locale: useBanglaNumerals ? 'bn' : 'en',
        withSymbol: moneyOptions?.withSymbol ?? true,
      })
    },

    formatQuantity(quantity, unit) {
      return Quantity.format(quantity as never, unit, {
        locale: useBanglaNumerals ? 'bn' : 'en',
      })
    },

    formatDate(value) {
      const dhaka = toDhaka(value)
      const day = dhaka.getUTCDate()
      const month = dhaka.getUTCMonth()
      const year = dhaka.getUTCFullYear()
      const monthName = (locale === 'bn' ? MONTHS_BN : MONTHS_EN)[month] ?? ''
      return `${digits(day)} ${monthName} ${digits(year)}`
    },

    formatDateTime(value) {
      const dhaka = toDhaka(value)
      const hours = dhaka.getUTCHours()
      const minutes = dhaka.getUTCMinutes()
      const clock = `${digits(String(hours).padStart(2, '0'))}:${digits(String(minutes).padStart(2, '0'))}`
      return `${this.formatDate(value)}, ${clock}`
    },
  }
}

export { bn, en }
