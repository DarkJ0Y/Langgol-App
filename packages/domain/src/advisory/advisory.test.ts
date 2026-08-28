/**
 * Advisory domain tests.
 *
 * Two things here can cost real money or real harm if they are wrong: the budget breaker, which
 * stands between a script and an OpenAI invoice, and the image gate, which decides what gets sent
 * to a third party at all. Both are cheap to test and expensive to get wrong, so they carry most
 * of the cases below.
 */

import { describe, expect, it } from 'vitest'
import { Money } from '../money/index.js'
import { EMPTY_FARMING_FIELDS, type FarmingFields } from '../farming/index.js'
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, disclaimerFor, evaluateImage } from './diagnosis.js'
import { PROMPT_VERSION, diagnosisPrompt, farmerContextLine } from './prompt.js'
import { evaluateAdvisoryBudget, type AdvisoryLimits } from './budget.js'

describe('which photographs may be sent', () => {
  it('accepts an ordinary phone photograph', () => {
    expect(evaluateImage({ contentType: 'image/jpeg', byteLength: 900_000 })).toEqual({ ok: true })
  })

  it('accepts HEIC, because iPhones default to it', () => {
    // Excluding it would reject photographs from the users most likely to have a good camera.
    expect(evaluateImage({ contentType: 'image/heic', byteLength: 1_000 }).ok).toBe(true)
  })

  it('refuses anything that is not an image', () => {
    /*
     * This endpoint forwards bytes to a third party. It must never become a way to send them
     * something else.
     */
    for (const contentType of [
      'application/pdf',
      'text/html',
      'application/zip',
      'image/svg+xml',
    ]) {
      const verdict = evaluateImage({ contentType, byteLength: 1_000 })
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.refusal).toBe('IMAGE_UNSUPPORTED_TYPE')
    }
  })

  it('refuses an oversized image before any provider is called', () => {
    // Every refusal here is free; every provider call is not.
    const verdict = evaluateImage({ contentType: 'image/jpeg', byteLength: MAX_IMAGE_BYTES + 1 })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.refusal).toBe('IMAGE_TOO_LARGE')
  })

  it('accepts an image exactly on the limit', () => {
    expect(evaluateImage({ contentType: 'image/png', byteLength: MAX_IMAGE_BYTES }).ok).toBe(true)
  })

  it('treats a missing or empty image as missing, not as invalid', () => {
    // The farmer forgot to attach one. That is a different message from "your file is wrong".
    for (const candidate of [null, { contentType: 'image/jpeg', byteLength: 0 }]) {
      const verdict = evaluateImage(candidate)
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.refusal).toBe('IMAGE_MISSING')
    }
  })

  it('keeps the accepted list to real camera formats', () => {
    expect(ACCEPTED_IMAGE_TYPES.every((t) => t.startsWith('image/'))).toBe(true)
  })
})

describe('the spend circuit breaker', () => {
  const limits: AdvisoryLimits = {
    unitCost: Money.fromPoisha(300),
    dailyBudget: Money.fromPoisha(3_000),
    perUserDailyLimit: 5,
  }

  it('allows a call well inside both limits', () => {
    expect(evaluateAdvisoryBudget({ servedToday: 2, servedTodayForUser: 1 }, limits)).toEqual({
      allowed: true,
    })
  })

  it('projects the NEXT call rather than checking spend so far', () => {
    /*
     * The difference between a ceiling that is never crossed and one that is noticed afterwards.
     * At 9 served, spend is 2700 and the tenth would reach exactly 3000 — allowed. The eleventh
     * would exceed it, and must be refused BEFORE it is made.
     */
    expect(evaluateAdvisoryBudget({ servedToday: 9, servedTodayForUser: 0 }, limits).allowed).toBe(
      true,
    )
    expect(evaluateAdvisoryBudget({ servedToday: 10, servedTodayForUser: 0 }, limits).allowed).toBe(
      false,
    )
  })

  it('stops the whole platform when the day is spent', () => {
    const verdict = evaluateAdvisoryBudget({ servedToday: 500, servedTodayForUser: 0 }, limits)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('BUDGET_EXHAUSTED')
  })

  it('stops one farmer before they spend everybody else’s allowance', () => {
    /*
     * The per-user cap is why a single compromised session cannot drain the day. Note the platform
     * budget here is nowhere near exhausted — this refusal is entirely the per-user limit.
     */
    const verdict = evaluateAdvisoryBudget({ servedToday: 0, servedTodayForUser: 5 }, limits)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('USER_LIMIT_REACHED')
  })

  it('reports the user limit ahead of the budget when both are reached', () => {
    // The farmer can act on "you have used today's five"; they cannot act on a platform budget.
    const verdict = evaluateAdvisoryBudget({ servedToday: 999, servedTodayForUser: 9 }, limits)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toBe('USER_LIMIT_REACHED')
  })

  it('refuses everything when the budget is zero', () => {
    // The safe state for an unconfigured deployment: off, not unlimited.
    const off: AdvisoryLimits = { ...limits, dailyBudget: Money.fromPoisha(0) }
    expect(evaluateAdvisoryBudget({ servedToday: 0, servedTodayForUser: 0 }, off).allowed).toBe(
      false,
    )
  })
})

describe('the prompt', () => {
  const farmer: FarmingFields = {
    ...EMPTY_FARMING_FIELDS,
    farmerType: 'VEGETABLE',
    totalLandAmountMilli: 2500,
    landUnit: 'BIGHA',
    irrigationAvailable: false,
  }

  it('carries a version, so an old answer can be explained later', () => {
    expect(diagnosisPrompt('bn', null).version).toBe(PROMPT_VERSION)
    expect(PROMPT_VERSION).toBeGreaterThan(0)
  })

  it('tells the model to refuse an unusable photograph', () => {
    // The failure that matters is a confident answer about a dark, blurred, or non-plant image.
    expect(diagnosisPrompt('bn', null).system).toContain('অস্পষ্ট')
    expect(diagnosisPrompt('en', null).system).toMatch(/blurred|not of a plant/)
  })

  it('puts organic remedies before chemical ones', () => {
    const en = diagnosisPrompt('en', null).system
    expect(en.indexOf('Organic remedy')).toBeLessThan(en.indexOf('Chemical remedy'))
  })

  it('demands a dose and precautions whenever a chemical is named', () => {
    expect(diagnosisPrompt('en', null).system).toMatch(/dose and the safety precautions/)
  })

  it('includes only the questions the farmer actually answered', () => {
    /*
     * An unanswered field is omitted rather than sent as "unknown" — a list of unknowns invites
     * the model to speculate about them.
     */
    const line = farmerContextLine(farmer, 'en')
    expect(line).toContain('VEGETABLE')
    expect(line).toContain('2.5 BIGHA')
    expect(line).toContain('rain-fed')
    expect(line).not.toMatch(/ownership|Tenure|Water source|Method/)
  })

  it('adds no context line at all for a farmer who answered nothing', () => {
    expect(farmerContextLine(EMPTY_FARMING_FIELDS, 'bn')).toBeNull()
    expect(diagnosisPrompt('bn', EMPTY_FARMING_FIELDS).system).not.toContain('প্রসঙ্গ মাত্র')
  })

  it('appends the farmer context after the rules, not inside them', () => {
    /*
     * A crafted profile value must not be able to rewrite the instructions. The worst it can do is
     * add a confusing line to a block the model is told is context.
     */
    const { system } = diagnosisPrompt('en', farmer)
    expect(system.indexOf('Answer structure')).toBeLessThan(system.indexOf('About this farmer'))
  })
})

describe('the disclaimer', () => {
  it('travels with the diagnosis rather than living on a screen', () => {
    // A disclaimer in a component can be forgotten by the next component that renders a diagnosis.
    expect(disclaimerFor('bn').length).toBeGreaterThan(20)
    expect(disclaimerFor('en').length).toBeGreaterThan(20)
  })

  it('says plainly that it can be wrong', () => {
    // Not softened. A farmer deciding whether to spend money deserves the honest sentence.
    expect(disclaimerFor('en')).toMatch(/can be wrong/)
    expect(disclaimerFor('bn')).toContain('ভুল হতে পারে')
  })

  it('points at a human', () => {
    expect(disclaimerFor('en')).toMatch(/agriculture officer/)
    expect(disclaimerFor('bn')).toContain('কৃষি কর্মকর্তার')
  })
})
