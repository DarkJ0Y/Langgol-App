import { describe, expect, it } from 'vitest'
import { Money, Quantity } from '@langgol/domain'
import { DEVELOPMENT_IDENTITIES, developmentIdentityLabel } from '@langgol/domain/identity'
import { bn, en, createTranslator, isLocale, LOCALES, DEFAULT_LOCALE } from './index.js'

describe('catalogues', () => {
  it('defaults to Bangla', () => {
    expect(DEFAULT_LOCALE).toBe('bn')
    expect(LOCALES).toEqual(['bn', 'en'])
    expect(isLocale('bn')).toBe(true)
    expect(isLocale('hi')).toBe(false)
  })

  it('has identical key structure in both languages — no key can go missing', () => {
    const keys = (value: unknown, prefix = ''): string[] => {
      if (typeof value !== 'object' || value === null) return [prefix]
      return Object.entries(value).flatMap(([key, child]) =>
        keys(child, prefix === '' ? key : `${prefix}.${key}`),
      )
    }
    expect(keys(en).sort()).toEqual(keys(bn).sort())
  })

  it('has no empty strings', () => {
    const values = (value: unknown): string[] =>
      typeof value === 'string' ? [value] : Object.values(value as object).flatMap(values)
    for (const catalogue of [bn, en]) {
      for (const message of values(catalogue)) expect(message.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('Bangla text characteristics', () => {
  const t = createTranslator('bn')

  it('renders Bangla, not transliterated English', () => {
    expect(t.t('auth.signInTitle')).toBe('লাঙ্গলে প্রবেশ করুন')
    expect(t.t('common.appName')).toBe('লাঙ্গল')
  })

  it('keeps button labels short enough for a narrow phone', () => {
    // Bangla glyphs are taller and words run 20-40% longer than English. A button label that
    // wraps to two lines on a 320px screen is a layout bug waiting for a real device.
    for (const key of [
      'common.continue',
      'common.back',
      'common.cancel',
      'auth.sendCode',
    ] as const) {
      expect(t.t(key).length).toBeLessThanOrEqual(16)
    }
  })

  it('writes errors that say what to do next, not just what failed', () => {
    // "Invalid input" helps nobody, least of all someone reading slowly.
    expect(t.t('errors.phoneInvalid')).toContain('০১')
    expect(t.t('errors.codeExpired')).toContain('নতুন কোড')
    expect(createTranslator('en').t('errors.phoneInvalid')).toContain('11 digits')
  })
})

describe('interpolation', () => {
  it('fills named placeholders', () => {
    expect(createTranslator('en').t('auth.codeSentTo', { phone: '+880171****5678' })).toBe(
      'We sent a code to +880171****5678',
    )
  })

  it('converts interpolated numbers to Bangla digits', () => {
    expect(createTranslator('bn').t('errors.rateLimited', { seconds: 30 })).toBe(
      '৩০ সেকেন্ড পর আবার চেষ্টা করুন',
    )
    expect(createTranslator('en').t('errors.rateLimited', { seconds: 30 })).toBe(
      'Try again in 30 seconds',
    )
  })

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    expect(createTranslator('en').t('auth.codeSentTo', {})).toContain('{phone}')
  })

  it('falls back to the key, so a missing message is an obvious bug report', () => {
    // @ts-expect-error -- exercising the runtime fallback behind the compile-time key check
    expect(createTranslator('bn').t('does.not.exist')).toBe('does.not.exist')
  })
})

describe('numerals', () => {
  it('uses Bangla digits for bn and Western for en', () => {
    expect(createTranslator('bn').digits(1234)).toBe('১২৩৪')
    expect(createTranslator('en').digits(1234)).toBe('1234')
  })

  it('honours a reader who prefers Western digits inside a Bangla interface', () => {
    const t = createTranslator('bn', { banglaNumerals: false })
    expect(t.digits(1234)).toBe('1234')
    expect(t.t('auth.signInTitle')).toBe('লাঙ্গলে প্রবেশ করুন')
  })
})

describe('currency', () => {
  it('formats taka with South Asian grouping', () => {
    const amount = Money.fromTaka('123456.50')
    expect(createTranslator('en').formatMoney(amount)).toBe('৳1,23,456.50')
    expect(createTranslator('bn').formatMoney(amount)).toBe('৳১,২৩,৪৫৬.৫০')
    expect(createTranslator('bn').formatMoney(amount, { withSymbol: false })).toBe('১,২৩,৪৫৬.৫০')
  })
})

describe('units', () => {
  it('formats quantities with localised unit labels', () => {
    const fiveKg = Quantity.toBase('5.5', 'KG')
    expect(createTranslator('en').formatQuantity(fiveKg, 'KG')).toBe('5.5 kg')
    expect(createTranslator('bn').formatQuantity(fiveKg, 'KG')).toBe('৫.৫ কেজি')
    expect(createTranslator('bn').formatQuantity(Quantity.toBase('2', 'MON'), 'MON')).toBe('২ মণ')
  })

  it('carries local unit names in both catalogues', () => {
    expect(bn.units.mon).toBe('মণ')
    expect(bn.units.hali).toBe('হালি')
    expect(en.units.mon).toBe('mon')
  })
})

describe('dates', () => {
  // 2026-08-10T20:30:00Z is 2026-08-11 02:30 in Dhaka — the day differs, which is exactly the
  // kind of off-by-one that produces "my order says it arrives yesterday".
  const lateEvening = new Date('2026-08-10T20:30:00Z')
  const midday = new Date('2026-08-10T06:00:00Z')

  it('renders in Dhaka time, not UTC', () => {
    expect(createTranslator('en').formatDate(lateEvening)).toBe('11 August 2026')
    expect(createTranslator('en').formatDate(midday)).toBe('10 August 2026')
  })

  it('uses Bangla month names and digits', () => {
    expect(createTranslator('bn').formatDate(midday)).toBe('১০ আগস্ট ২০২৬')
  })

  it('renders date and time together', () => {
    expect(createTranslator('en').formatDateTime(midday)).toBe('10 August 2026, 12:00')
    expect(createTranslator('bn').formatDateTime(midday)).toBe('১০ আগস্ট ২০২৬, ১২:০০')
  })
})

describe('brandmark', () => {
  // Langgol is লাঙ্গল — the plough. The brand is named after the implement, so the Bangla
  // wordmark is the actual word, not a phonetic respelling of the English.
  const BANGLA_BRAND = 'লাঙ্গল'

  it('uses the agricultural Bangla wordmark, and the English brand unchanged', () => {
    expect(bn.common.appName).toBe(BANGLA_BRAND)
    expect(en.common.appName).toBe('Langgol')
  })

  it('cannot diverge between locales — every Bangla string using the brand uses this spelling', () => {
    // Catches a copy edit that reintroduces a phonetic variant in one string but not another.
    const strings = (value: unknown): string[] =>
      typeof value === 'string' ? [value] : Object.values(value as object).flatMap(strings)

    for (const message of strings(bn)) {
      // Any Bangla message mentioning the brand must spell it the approved way. Detect a
      // near-miss by looking for the phonetic variant explicitly.
      expect(message).not.toContain('লংগল')
    }
    expect(strings(bn).some((message) => message.includes(BANGLA_BRAND))).toBe(true)
  })
})

describe('development fixture labels', () => {
  it('are localised in both languages, with no key, id or phone number', () => {
    for (const identity of DEVELOPMENT_IDENTITIES) {
      const banglaLabel = developmentIdentityLabel(identity, 'bn')
      const englishLabel = developmentIdentityLabel(identity, 'en')

      expect(banglaLabel.name).toMatch(/[ঀ-৿]/) // contains Bangla
      expect(englishLabel.name).toBe(identity.fullName)

      for (const label of [banglaLabel, englishLabel]) {
        expect(label.name).not.toContain(identity.phone)
        expect(label.name).not.toContain(identity.key)
        expect(label.description.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the internal keys unchanged', () => {
    /*
     * This list is pinned on purpose: the identities are a closed allowlist, and an accidental
     * addition is a new way to sign in. Changing it should require editing this assertion, which
     * is exactly what happened when the marketplace needed more than one farmer and more than
     * one buyer to test with, and again when P9's four controlled roles needed an account each.
     *
     * The reserved phone block caps this at nineteen.
     */
    expect(DEVELOPMENT_IDENTITIES.map((identity) => identity.key)).toEqual([
      'farmer',
      'consumer',
      'retailer',
      'ops',
      'admin',
      'farmer-consumer',
      'farmer-distant',
      'consumer-second',
      'ops-second',
      'wholesaler',
      'supplier',
      'expert',
      'logistics',
      'demo',
    ])
  })
})
