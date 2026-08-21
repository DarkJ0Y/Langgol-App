/**
 * Consent domain tests.
 *
 * Four requirements are the reason this module exists, and each one has an assertion here that
 * would fail if it stopped being true: nothing is silently enabled, optional consent is not
 * bundled, required consent is separate, and agreeing to an old version is not agreeing to the
 * current one.
 */

import { describe, expect, it } from 'vitest'
import {
  CONSENT_CATALOGUE,
  CONSENT_TYPES,
  OPTIONAL_CONSENTS,
  REQUIRED_CONSENTS,
  ConsentError,
  canRecordDecision,
  consentDescriptor,
  consentLabel,
  consentStatus,
  defaultConsentState,
  grantedOptional,
  hasAcceptedRequired,
  isConsentType,
  isOptionalConsent,
  isRequiredConsent,
  isValidVersionMap,
  outstandingRequiredConsents,
  partitionDecisions,
  type ConsentDecision,
  type ConsentVersions,
} from './index.js'

const VERSIONS: ConsentVersions = {
  TERMS_OF_SERVICE: 1,
  PRIVACY_POLICY: 1,
  LOCATION: 1,
  FARM_DATA: 1,
  FINANCIAL_DATA: 1,
  MARKETING: 1,
  PERSONALIZATION: 1,
  AI_DATA_PROCESSING: 1,
  TRANSACTION_DATA: 1,
}

const AT = new Date('2026-08-22T09:00:00.000Z')

const decision = (
  type: ConsentDecision['type'],
  granted: boolean,
  version = 1,
  at = AT,
): ConsentDecision => ({ type, granted, version, decidedAt: at })

/* ------------------------------------------------------------------ catalogue */

describe('the consent vocabulary', () => {
  it('covers every permission the platform asks for', () => {
    expect([...CONSENT_TYPES]).toEqual([
      'TERMS_OF_SERVICE',
      'PRIVACY_POLICY',
      'LOCATION',
      'FARM_DATA',
      'FINANCIAL_DATA',
      'MARKETING',
      'PERSONALIZATION',
      'AI_DATA_PROCESSING',
      'TRANSACTION_DATA',
    ])
    expect(new Set(CONSENT_TYPES).size).toBe(CONSENT_TYPES.length)
  })

  it('describes every type exactly once', () => {
    // A type without a descriptor renders as a blank switch; a duplicate makes the label depend
    // on array order.
    expect(CONSENT_CATALOGUE).toHaveLength(CONSENT_TYPES.length)
    expect(new Set(CONSENT_CATALOGUE.map((e) => e.type)).size).toBe(CONSENT_TYPES.length)
    for (const type of CONSENT_TYPES) expect(() => consentDescriptor(type)).not.toThrow()
  })

  it('recognises its own members and nothing else', () => {
    for (const type of CONSENT_TYPES) expect(isConsentType(type)).toBe(true)
    expect(isConsentType('COOKIES')).toBe(false)
    expect(isConsentType('marketing')).toBe(false)
    expect(() => consentDescriptor('NOPE' as never)).toThrow(ConsentError)
  })

  it('says what each permission is FOR, in both languages', () => {
    for (const type of CONSENT_TYPES) {
      const bn = consentLabel(type, 'bn')
      const en = consentLabel(type, 'en')

      expect(bn.title.length).toBeGreaterThan(0)
      expect(bn.purpose.length).toBeGreaterThan(0)
      // Bangla-first means a real translation, not the English copied across.
      expect(bn.title).not.toBe(en.title)
      expect(bn.title).toMatch(/[ঀ-৿]/)
      expect(bn.purpose).toMatch(/[ঀ-৿]/)
    }
  })

  it('writes the purpose for the person being asked, not as a description of processing', () => {
    /*
     * docs/07 §9.2 requires consent text "written for the actual user, not for lawyers". The
     * cheap tell is passive processing vocabulary: "data is processed", "we may utilise".
     */
    for (const entry of CONSENT_CATALOGUE) {
      expect(entry.purposeEn.toLowerCase()).not.toContain('we may process')
      expect(entry.purposeEn.toLowerCase()).not.toContain('is processed')
      expect(entry.purposeEn.toLowerCase()).not.toContain('utilise')
    }
  })
})

describe('required and optional are different kinds of thing', () => {
  it('treats only the terms and the privacy policy as required', () => {
    expect([...REQUIRED_CONSENTS]).toEqual(['TERMS_OF_SERVICE', 'PRIVACY_POLICY'])
  })

  it('treats everything else as genuinely optional', () => {
    // Refusing all of these must leave a working account, which is what "optional" has to mean.
    expect(OPTIONAL_CONSENTS).toHaveLength(CONSENT_TYPES.length - 2)
    for (const type of OPTIONAL_CONSENTS) {
      expect(isOptionalConsent(type)).toBe(true)
      expect(isRequiredConsent(type)).toBe(false)
    }
  })

  it('does not let a data-hungry permission smuggle itself in as required', () => {
    // The ones most tempting to mark "required" are exactly the ones that must not be.
    for (const type of ['MARKETING', 'AI_DATA_PROCESSING', 'FINANCIAL_DATA', 'LOCATION'] as const) {
      expect(isRequiredConsent(type)).toBe(false)
    }
  })

  it('partitions the two so a caller cannot treat them alike', () => {
    const { optional, required, unknown } = partitionDecisions([
      { type: 'MARKETING', granted: true },
      { type: 'TERMS_OF_SERVICE', granted: false },
      { type: 'COOKIES', granted: true },
    ])

    expect(optional).toEqual([{ type: 'MARKETING', granted: true }])
    expect(required).toEqual(['TERMS_OF_SERVICE'])
    expect(unknown).toEqual(['COOKIES'])
  })
})

/* --------------------------------------------------- never silently enabled */

describe('nothing is enabled without a decision', () => {
  it('starts every permission refused', () => {
    /*
     * The single most important assertion in this file. If a default ever flipped to granted,
     * every account on the platform would be opted in to everything without anyone deciding.
     */
    const state = defaultConsentState(VERSIONS)
    expect(state).toHaveLength(CONSENT_TYPES.length)
    for (const status of state) {
      expect(status.granted).toBe(false)
      expect(status.decidedVersion).toBeNull()
      expect(status.decidedAt).toBeNull()
    }
  })

  it('does not read absence as agreement', () => {
    const statuses = consentStatus([], VERSIONS)
    expect(statuses.every((s) => !s.granted)).toBe(true)
    expect(grantedOptional(statuses)).toEqual([])
  })

  it('grants only what a decision actually says', () => {
    const statuses = consentStatus([decision('MARKETING', true)], VERSIONS)

    expect(grantedOptional(statuses)).toEqual(['MARKETING'])
    // Everything else is untouched by one permission being granted.
    expect(statuses.filter((s) => s.granted)).toHaveLength(1)
  })

  it('keeps a recorded refusal distinct from never having been asked', () => {
    const refused = consentStatus([decision('MARKETING', false)], VERSIONS)
    const never = consentStatus([], VERSIONS)

    const asRefused = refused.find((s) => s.type === 'MARKETING')
    const asNever = never.find((s) => s.type === 'MARKETING')

    expect(asRefused?.granted).toBe(false)
    expect(asNever?.granted).toBe(false)
    // Same answer, different evidence: one of them was asked.
    expect(asRefused?.decidedAt).not.toBeNull()
    expect(asNever?.decidedAt).toBeNull()
  })

  it('uses the most recent decision when a permission was changed more than once', () => {
    const later = new Date(AT.getTime() + 60_000)
    const statuses = consentStatus(
      [decision('MARKETING', true, 1, AT), decision('MARKETING', false, 1, later)],
      VERSIONS,
    )
    expect(statuses.find((s) => s.type === 'MARKETING')?.granted).toBe(false)
  })
})

/* ------------------------------------------------------------------ versions */

describe('agreeing to an old version is not agreeing to the current one', () => {
  it('marks a grant stale when the document has moved on', () => {
    const statuses = consentStatus([decision('PRIVACY_POLICY', true, 1)], {
      ...VERSIONS,
      PRIVACY_POLICY: 2,
    })
    const privacy = statuses.find((s) => s.type === 'PRIVACY_POLICY')

    expect(privacy?.granted).toBe(true)
    expect(privacy?.stale).toBe(true)
    expect(privacy?.decidedVersion).toBe(1)
    expect(privacy?.currentVersion).toBe(2)
  })

  it('re-opens a required consent whose version was raised', () => {
    // Someone who accepted version 1 has not accepted version 2, and must be asked again.
    const statuses = consentStatus(
      [decision('TERMS_OF_SERVICE', true, 1), decision('PRIVACY_POLICY', true, 1)],
      { ...VERSIONS, TERMS_OF_SERVICE: 2 },
    )

    expect(outstandingRequiredConsents(statuses)).toEqual(['TERMS_OF_SERVICE'])
    expect(hasAcceptedRequired(statuses)).toBe(false)
  })

  it('does not call a refusal stale — there is nothing to renew', () => {
    const statuses = consentStatus([decision('MARKETING', false, 1)], {
      ...VERSIONS,
      MARKETING: 3,
    })
    expect(statuses.find((s) => s.type === 'MARKETING')?.stale).toBe(false)
  })

  it('is satisfied only when both required consents are current', () => {
    expect(hasAcceptedRequired(consentStatus([], VERSIONS))).toBe(false)
    expect(hasAcceptedRequired(consentStatus([decision('TERMS_OF_SERVICE', true)], VERSIONS))).toBe(
      false,
    )
    expect(
      hasAcceptedRequired(
        consentStatus(
          [decision('TERMS_OF_SERVICE', true), decision('PRIVACY_POLICY', true)],
          VERSIONS,
        ),
      ),
    ).toBe(true)
  })

  it('validates a configured version map', () => {
    expect(isValidVersionMap(VERSIONS)).toBe(true)
    expect(isValidVersionMap({ ...VERSIONS, MARKETING: 0 })).toBe(false)
    expect(isValidVersionMap({ ...VERSIONS, MARKETING: 1.5 })).toBe(false)
    const { MARKETING: _omitted, ...missing } = VERSIONS
    expect(isValidVersionMap(missing)).toBe(false)
  })
})

/* ------------------------------------------------------------- what may be recorded */

describe('which decisions may be recorded at all', () => {
  it('accepts an optional permission either way', () => {
    for (const granted of [true, false]) {
      expect(
        canRecordDecision({ type: 'MARKETING', granted, version: 1, versions: VERSIONS }).allowed,
      ).toBe(true)
    }
  })

  it('refuses to record a required consent as withdrawn', () => {
    /*
     * Withdrawing the terms is not a permission change, it is leaving the platform. Offering it
     * as a toggle beside "marketing messages" would misrepresent what pressing it does.
     */
    const verdict = canRecordDecision({
      type: 'TERMS_OF_SERVICE',
      granted: false,
      version: 1,
      versions: VERSIONS,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('REQUIRED_NOT_REVOCABLE')
  })

  it('refuses a version that is not the one in force', () => {
    // A client submitting a stale version is agreeing to text it was shown before it changed.
    const verdict = canRecordDecision({
      type: 'MARKETING',
      granted: true,
      version: 1,
      versions: { ...VERSIONS, MARKETING: 2 },
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('VERSION_MISMATCH')
  })

  it('refuses a permission that does not exist', () => {
    const verdict = canRecordDecision({
      type: 'SELL_MY_DATA',
      granted: true,
      version: 1,
      versions: VERSIONS,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('UNKNOWN_TYPE')
  })
})
