/**
 * Number and label formatting for the dashboards, in the reader's language.
 *
 * Money is compacted the way Bangladesh counts it: thousand (হাজার), then lakh (লাখ) and crore
 * (কোটি), never "M" and "B". Digits follow the translator, so a Bangla reader sees Bangla digits.
 *
 * Money arrives as exact `Poisha` and is formatted with integer arithmetic only: it crosses into
 * this module as its serialised string (the boundary docs/06 §2 prescribes) and is divided as a
 * bigint. The one exception is `chartTaka`, which exists to give a bar its HEIGHT and nothing
 * else — its result is never displayed, summed or stored.
 */

import * as Money from '@langgol/domain/money'
import type { Poisha } from '@langgol/domain/money'
import type { Translator } from '@langgol/i18n'

type Locale = 'bn' | 'en'

/** One decimal at most, and none when it would be ".0". For quantities and chart scales. */
function trim(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** Poisha as a plain bigint, via its string form. */
const units = (amount: Poisha): bigint => BigInt(Money.serialize(amount))

const SCALES = [
  { per: 1_000_000_000n, bn: ' কোটি', en: 'Cr' },
  { per: 10_000_000n, bn: ' লাখ', en: 'L' },
  { per: 100_000n, bn: ' হাজার', en: 'K' },
] as const

/** ৳ compact from an exact amount: ৳850 · ৳12.5K / ৳১২.৫ হাজার · ৳3.2L / ৳৩.২ লাখ. */
export function takaCompact(amount: Poisha, locale: Locale, t: Translator): string {
  const raw = units(amount)
  const negative = raw < 0n
  const magnitude = negative ? -raw : raw
  const sign = negative ? '−' : ''
  const scale = SCALES.find((candidate) => magnitude >= candidate.per)
  if (scale === undefined) return `${sign}৳${t.digits((magnitude / 100n).toString())}`
  const tenths = (magnitude * 10n) / scale.per
  const whole = (tenths / 10n).toString()
  const fraction = tenths % 10n
  const body = fraction === 0n ? whole : `${whole}.${fraction.toString()}`
  return `${sign}৳${t.digits(body)}${locale === 'bn' ? scale.bn : scale.en}`
}

/** ৳ exact, South Asian grouping, in the reader's digits: ৳1,23,456.50. */
export function takaFull(amount: Poisha, t: Translator): string {
  return t.formatMoney(amount)
}

/** An axis tick: a position on the chart's scale, in whole taka. Not an amount anyone owes. */
export function takaTick(taka: number, locale: Locale, t: Translator): string {
  const abs = Math.abs(taka)
  if (abs >= 1e7) return `৳${t.digits(trim(taka / 1e7))}${locale === 'bn' ? ' কোটি' : 'Cr'}`
  if (abs >= 1e5) return `৳${t.digits(trim(taka / 1e5))}${locale === 'bn' ? ' লাখ' : 'L'}`
  if (abs >= 1e3) return `৳${t.digits(trim(taka / 1e3))}${locale === 'bn' ? ' হাজার' : 'K'}`
  return `৳${t.digits(String(Math.round(taka)))}`
}

/**
 * Whole taka as a number, for a bar's height and nothing else.
 *
 * Exact for any amount below ৳90 trillion, and only ever used as a proportion of the tallest bar.
 * Labels, tooltips and tables use `takaFull` / `takaCompact` on the exact value instead.
 */
export function chartTaka(amount: Poisha): number {
  return Number(units(amount) / 100n)
}

/** Signed whole-percent change between two exact amounts, or undefined with no baseline. */
export function percentChangeMoney(now: Poisha, before: Poisha, t: Translator): string | undefined {
  const base = units(before)
  if (base <= 0n) return undefined
  const change = ((units(now) - base) * 100n) / base
  const sign = change > 0n ? '+' : change < 0n ? '−' : ''
  return `${sign}${t.digits((change < 0n ? -change : change).toString())}%`
}

/** Kilograms, compacted past a tonne. */
export function kgCompact(kg: number, locale: Locale, t: Translator): string {
  if (Math.abs(kg) >= 1000) {
    return `${t.digits(trim(kg / 1000))} ${locale === 'bn' ? 'টন' : 't'}`
  }
  return `${t.digits(String(Math.round(kg)))} ${locale === 'bn' ? 'কেজি' : 'kg'}`
}

export function count(value: number, t: Translator): string {
  return t.digits(Math.round(value).toLocaleString('en-IN'))
}

/** Signed percentage change, or undefined when there is nothing to compare against. */
export function percentChange(now: number, before: number, t: Translator): string | undefined {
  if (before <= 0) return undefined
  const change = ((now - before) / before) * 100
  const sign = change > 0 ? '+' : change < 0 ? '−' : ''
  return `${sign}${t.digits(String(Math.abs(Math.round(change))))}%`
}

/** "Oct" / "অক্টো" for a 'YYYY-MM' key. */
export function monthLabel(key: string, locale: Locale): string {
  const [year, month] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, 1))
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    month: 'short',
    timeZone: 'UTC',
  }).format(date)
}

const SEASONS: Record<string, { bn: string; en: string }> = {
  BORO: { bn: 'বোরো', en: 'Boro' },
  AUS: { bn: 'আউশ', en: 'Aus' },
  AMAN: { bn: 'আমন', en: 'Aman' },
  RABI: { bn: 'রবি', en: 'Rabi' },
  KHARIF: { bn: 'খরিফ', en: 'Kharif' },
  YEAR_ROUND: { bn: 'সারা বছর', en: 'Year-round' },
}

/** "Boro ’25" / "বোরো ’২৫". */
export function seasonLabel(season: string, year: number, locale: Locale, t: Translator): string {
  const name = SEASONS[season]?.[locale] ?? season
  return `${name} ’${t.digits(String(year % 100).padStart(2, '0'))}`
}

const STATUS: Record<
  string,
  { bn: string; en: string; tone: 'done' | 'moving' | 'waiting' | 'stopped' }
> = {
  PENDING: { bn: 'অপেক্ষায়', en: 'Waiting', tone: 'waiting' },
  CONFIRMED: { bn: 'নিশ্চিত', en: 'Confirmed', tone: 'moving' },
  PREPARING: { bn: 'প্রস্তুত হচ্ছে', en: 'Preparing', tone: 'moving' },
  READY_FOR_PICKUP: { bn: 'নেওয়ার জন্য প্রস্তুত', en: 'Ready', tone: 'moving' },
  IN_TRANSIT: { bn: 'পথে', en: 'On the way', tone: 'moving' },
  DELIVERED: { bn: 'পৌঁছেছে', en: 'Delivered', tone: 'done' },
  COMPLETED: { bn: 'সম্পন্ন', en: 'Completed', tone: 'done' },
  CANCELLED: { bn: 'বাতিল', en: 'Cancelled', tone: 'stopped' },
  FAILED: { bn: 'ব্যর্থ', en: 'Failed', tone: 'stopped' },
  REFUNDED: { bn: 'টাকা ফেরত', en: 'Refunded', tone: 'stopped' },
  DISPUTED: { bn: 'আপত্তি', en: 'Disputed', tone: 'waiting' },
}

export function orderStatus(status: string, locale: Locale) {
  const entry = STATUS[status]
  return { label: entry?.[locale] ?? status, tone: entry?.tone ?? 'waiting' }
}

const ROLES: Record<string, { bn: string; en: string }> = {
  FARMER: { bn: 'কৃষক', en: 'Farmers' },
  CONSUMER: { bn: 'ক্রেতা', en: 'Consumers' },
  RETAILER: { bn: 'দোকানি', en: 'Retailers' },
  WHOLESALER: { bn: 'পাইকার', en: 'Wholesalers' },
  SUPPLIER: { bn: 'সরবরাহকারী', en: 'Suppliers' },
  AGRICULTURAL_EXPERT: { bn: 'কৃষি বিশেষজ্ঞ', en: 'Experts' },
  LOGISTICS_PROVIDER: { bn: 'পরিবহন', en: 'Logistics' },
  OPS_AGENT: { bn: 'মাঠকর্মী', en: 'Field agents' },
  ADMIN: { bn: 'প্রশাসক', en: 'Admins' },
}

export function rolePlural(role: string, locale: Locale): string {
  return ROLES[role]?.[locale] ?? role
}

const VERIFICATION: Record<string, { bn: string; en: string }> = {
  PHONE: { bn: 'ফোন', en: 'Phone' },
  EMAIL: { bn: 'ইমেইল', en: 'Email' },
  IDENTITY: { bn: 'জাতীয় পরিচয়', en: 'National ID' },
  FARM: { bn: 'জমি', en: 'Farm' },
  BUSINESS: { bn: 'ব্যবসা', en: 'Business' },
  EXPERT: { bn: 'বিশেষজ্ঞ', en: 'Expert' },
  PAYMENT: { bn: 'পেমেন্ট', en: 'Payment' },
}

export function verificationLabel(type: string, locale: Locale): string {
  return VERIFICATION[type]?.[locale] ?? type
}
