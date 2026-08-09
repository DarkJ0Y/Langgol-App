import { describe, expect, it } from 'vitest'
import {
  renderTemplate,
  isSensitive,
  supportsChannel,
  segmentCount,
  TemplateError,
  SMS_SEGMENT_UNICODE,
  encodeIntent,
  decodeIntent,
  validateIntent,
  intentDefinition,
  IntentError,
  INTENTS,
  type Intent,
} from './index.js'

describe('templates', () => {
  it('renders Bangla by default and English on request', () => {
    const bn = renderTemplate('auth.otp', 'bn', { code: '123456', minutes: 5 })
    const en = renderTemplate('auth.otp', 'en', { code: '123456', minutes: 5 })
    expect(bn.body).toContain('123456')
    expect(bn.body).toContain('লাঙ্গল')
    expect(en.body).toBe('Your Langgol code is 123456. It expires in 5 minutes. Do not share it.')
  })

  it('detects Unicode, because a Bangla SMS costs more and fits less', () => {
    const bn = renderTemplate('auth.otp', 'bn', { code: '123456', minutes: 5 })
    const en = renderTemplate('auth.otp', 'en', { code: '123456', minutes: 5 })
    expect(bn.unicode).toBe(true)
    expect(en.unicode).toBe(false)
  })

  it('keeps every Bangla template inside a single SMS segment', () => {
    // A two-segment OTP costs double and is more likely to arrive out of order. This assertion
    // is the guardrail against a well-meaning copy edit doubling the SMS bill.
    for (const vars of [{ code: '123456', minutes: 5 }]) {
      const rendered = renderTemplate('auth.otp', 'bn', vars)
      expect(rendered.body.length).toBeLessThanOrEqual(SMS_SEGMENT_UNICODE)
      expect(rendered.segments).toBe(1)
    }
    expect(renderTemplate('auth.new-device', 'bn', { when: '10:30' }).segments).toBe(1)
    expect(renderTemplate('account.role-granted', 'bn', { role: 'কৃষক' }).segments).toBe(1)
  })

  it('counts segments correctly for both alphabets', () => {
    expect(segmentCount('a'.repeat(160))).toBe(1)
    expect(segmentCount('a'.repeat(161))).toBe(2)
    expect(segmentCount('আ'.repeat(70))).toBe(1)
    expect(segmentCount('আ'.repeat(71))).toBe(2)
    expect(segmentCount('')).toBe(1)
  })

  it('refuses to render with a missing variable rather than emitting a broken message', () => {
    // "Your Langgol code is ." is worse than a failed send: the user acts on it.
    expect(() => renderTemplate('auth.otp', 'en', { minutes: 5 })).toThrow(TemplateError)
    expect(() => renderTemplate('auth.otp', 'en', { code: '', minutes: 5 })).toThrow(TemplateError)
  })

  it('refuses a channel the template does not support', () => {
    expect(() => renderTemplate('auth.otp', 'en', { code: '1', minutes: 5 }, 'PUSH')).toThrow(
      TemplateError,
    )
    expect(supportsChannel('auth.otp', 'SMS')).toBe(true)
    expect(supportsChannel('auth.otp', 'IVR')).toBe(true)
    expect(supportsChannel('auth.otp', 'EMAIL')).toBe(false)
  })

  it('marks the OTP template sensitive so its body is never persisted', () => {
    expect(isSensitive('auth.otp')).toBe(true)
    expect(isSensitive('auth.new-device')).toBe(false)
  })

  it('rejects an unknown template', () => {
    // @ts-expect-error -- exercising the runtime guard behind the type
    expect(() => renderTemplate('does.not.exist', 'en', {})).toThrow(TemplateError)
  })
})

describe('intents', () => {
  const intent = (over: Partial<Intent> = {}): Intent => ({
    kind: 'AcceptOrder',
    subjectId: 'order-123',
    actorUserId: 'user-1',
    ...over,
  })

  it('round-trips through a keypad token — the proof that IVR/USSD can be added later', () => {
    const original = intent({ kind: 'RejectOrder', reasonCode: 'CROP_FAILURE' })
    const token = encodeIntent(original)
    expect(token).toBe('2*order-123*3')
    expect(decodeIntent(token, 'user-1')).toEqual(original)
  })

  it('round-trips every intent kind', () => {
    for (const kind of Object.keys(INTENTS) as (keyof typeof INTENTS)[]) {
      const source = intent({ kind })
      expect(decodeIntent(encodeIntent(source), 'user-1').kind).toBe(kind)
    }
  })

  it('gives each intent a stable keypad digit, so a farmer can learn it', () => {
    const digits = Object.values(INTENTS).map((definition) => definition.keypadDigit)
    expect(new Set(digits).size).toBe(digits.length)
    expect(intentDefinition('AcceptOrder').keypadDigit).toBe('1')
    expect(intentDefinition('RejectOrder').keypadDigit).toBe('2')
  })

  it('requires a reason where a bare refusal would be useless', () => {
    expect(() => validateIntent(intent({ kind: 'RejectOrder' }), ['FARMER'])).toThrow(IntentError)
    expect(() =>
      validateIntent(intent({ kind: 'RejectOrder', reasonCode: 'WEATHER' }), ['FARMER']),
    ).not.toThrow()
  })

  it('refuses an intent the actor\u2019s role cannot raise', () => {
    expect(() => validateIntent(intent(), ['CONSUMER'])).toThrow(IntentError)
    expect(() => validateIntent(intent(), ['FARMER'])).not.toThrow()
  })

  it('refuses a malformed subject or token', () => {
    expect(() => validateIntent(intent({ subjectId: '  ' }), ['FARMER'])).toThrow(IntentError)
    expect(() => decodeIntent('', 'user-1')).toThrow(IntentError)
    expect(() => decodeIntent('1', 'user-1')).toThrow(IntentError)
    expect(() => decodeIntent('7*order-1', 'user-1')).toThrow(IntentError)
    expect(() => decodeIntent('1*order-1*8', 'user-1')).toThrow(IntentError)
  })

  it('separates reading from mutating, so a read needs no confirmation step', () => {
    expect(intentDefinition('ViewOrder').mutating).toBe(false)
    expect(intentDefinition('AcceptOrder').mutating).toBe(true)
  })
})
