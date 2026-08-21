/**
 * Consent decisions — pure rules about what a user has agreed to, and what is still outstanding.
 *
 * The property this module exists to make structurally true is **"never silently enabled"**.
 * There is exactly one way for a permission to read as granted: a decision record saying so, at a
 * known version, made by the user. `defaultConsentState` returns everything refused, nothing
 * infers a grant from absence, and no function here takes an actor other than the subject — an
 * administrator has nowhere to express an opinion, because there is no parameter for one.
 *
 * The second property is that raising a policy version **withdraws** the old agreement rather than
 * carrying it forward. Someone who agreed to version 2 of a privacy policy has not agreed to
 * version 3, and treating stale agreement as current is how consent becomes a formality.
 *
 * Refs: docs/07_SECURITY.md §9.2, §9.4
 */

import {
  CONSENT_TYPES,
  OPTIONAL_CONSENTS,
  REQUIRED_CONSENTS,
  isRequiredConsent,
  type ConsentType,
} from './catalogue.js'

/** One decision as stored. `granted: false` is a recorded refusal, not an absence. */
export interface ConsentDecision {
  readonly type: ConsentType
  readonly granted: boolean
  readonly version: number
  readonly decidedAt: Date
}

/** The versions currently in force, from versioned platform configuration. */
export type ConsentVersions = Readonly<Record<ConsentType, number>>

export interface ConsentStatus {
  readonly type: ConsentType
  readonly granted: boolean
  /** The version the user actually agreed to, or null when they never decided. */
  readonly decidedVersion: number | null
  readonly currentVersion: number
  readonly decidedAt: Date | null
  /** True when they agreed to an older version and the document has since changed. */
  readonly stale: boolean
  readonly required: boolean
}

/**
 * Everything refused, nothing decided.
 *
 * The starting point for any account, and the reason a missing record can never read as consent.
 * A default of "granted" would make silent enablement a one-line mistake; here it would take a
 * deliberate rewrite of this function, which has a test.
 */
export function defaultConsentState(versions: ConsentVersions): readonly ConsentStatus[] {
  return CONSENT_TYPES.map((type) => ({
    type,
    granted: false,
    decidedVersion: null,
    currentVersion: versions[type],
    decidedAt: null,
    stale: false,
    required: isRequiredConsent(type),
  }))
}

/**
 * Fold the live decisions over the default state.
 *
 * Anything without a decision stays refused. A decision at an older version than the one in force
 * is reported `stale` and, for a required consent, does NOT satisfy the requirement — the user is
 * asked again rather than being treated as having agreed to text they never saw.
 */
export function consentStatus(
  decisions: readonly ConsentDecision[],
  versions: ConsentVersions,
): readonly ConsentStatus[] {
  const latest = new Map<ConsentType, ConsentDecision>()
  for (const decision of decisions) {
    const held = latest.get(decision.type)
    if (held === undefined || decision.decidedAt.getTime() > held.decidedAt.getTime()) {
      latest.set(decision.type, decision)
    }
  }

  return defaultConsentState(versions).map((base) => {
    const decision = latest.get(base.type)
    if (decision === undefined) return base

    return {
      ...base,
      granted: decision.granted,
      decidedVersion: decision.version,
      decidedAt: decision.decidedAt,
      stale: decision.granted && decision.version < base.currentVersion,
    }
  })
}

/**
 * Required consents the user has not given at the version currently in force.
 *
 * Drives the signup gate. Deliberately returns the outstanding list rather than a boolean, so the
 * caller can name what is missing instead of showing an undifferentiated wall.
 */
export function outstandingRequiredConsents(
  statuses: readonly ConsentStatus[],
): readonly ConsentType[] {
  return statuses
    .filter((status) => status.required && (!status.granted || status.stale))
    .map((status) => status.type)
}

export function hasAcceptedRequired(statuses: readonly ConsentStatus[]): boolean {
  return outstandingRequiredConsents(statuses).length === 0
}

/** The optional permissions a user currently allows. Nothing else may be assumed. */
export function grantedOptional(statuses: readonly ConsentStatus[]): readonly ConsentType[] {
  return statuses
    .filter((status) => !status.required && status.granted)
    .map((status) => status.type)
}

export type DecisionRefusal = 'REQUIRED_NOT_REVOCABLE' | 'UNKNOWN_TYPE' | 'VERSION_MISMATCH'

export interface DecisionVerdict {
  readonly allowed: boolean
  readonly reason: DecisionRefusal | null
}

const ALLOWED: DecisionVerdict = { allowed: true, reason: null }

function refuse(reason: DecisionRefusal): DecisionVerdict {
  return { allowed: false, reason }
}

/**
 * May this decision be recorded?
 *
 * Two refusals, for different reasons:
 *
 *  - **Withdrawing a required consent** is not a permission change, it is leaving the platform.
 *    Offering it as a toggle beside "marketing messages" would misrepresent what pressing it
 *    does, so it is refused here and the account-closure route is the honest one. This is the
 *    single place that distinction is enforced.
 *  - **A version that is not the one in force.** A client submitting a stale version number is
 *    agreeing to text it was shown before the document changed. Recording that as current
 *    agreement is exactly the formality this module exists to prevent.
 */
export function canRecordDecision(input: {
  readonly type: string
  readonly granted: boolean
  readonly version: number
  readonly versions: ConsentVersions
}): DecisionVerdict {
  if (!(CONSENT_TYPES as readonly string[]).includes(input.type)) return refuse('UNKNOWN_TYPE')

  const type = input.type as ConsentType

  if (isRequiredConsent(type) && !input.granted) return refuse('REQUIRED_NOT_REVOCABLE')
  if (input.version !== input.versions[type]) return refuse('VERSION_MISMATCH')

  return ALLOWED
}

/**
 * Which consents a bulk submission is permitted to touch.
 *
 * Optional ones only, and each carries its own answer. A screen that posts one "I agree" and
 * grants nine permissions has bundled them, which is the thing the requirement forbids — so the
 * shape here is a list of individual answers, and a caller that wants to grant everything must
 * say so nine times.
 */
export function partitionDecisions(
  answers: readonly { readonly type: string; readonly granted: boolean }[],
): {
  readonly optional: readonly { type: ConsentType; granted: boolean }[]
  readonly required: readonly ConsentType[]
  readonly unknown: readonly string[]
} {
  const optional: { type: ConsentType; granted: boolean }[] = []
  const required: ConsentType[] = []
  const unknown: string[] = []

  for (const answer of answers) {
    if (!(CONSENT_TYPES as readonly string[]).includes(answer.type)) {
      unknown.push(answer.type)
      continue
    }
    const type = answer.type as ConsentType
    if (REQUIRED_CONSENTS.includes(type)) required.push(type)
    else optional.push({ type, granted: answer.granted })
  }

  return { optional, required, unknown }
}

/** Sanity check on a configured version map: every type present, every value a positive integer. */
export function isValidVersionMap(candidate: Readonly<Record<string, unknown>>): boolean {
  return CONSENT_TYPES.every((type) => {
    const value = candidate[type]
    return typeof value === 'number' && Number.isInteger(value) && value > 0
  })
}

export { OPTIONAL_CONSENTS, REQUIRED_CONSENTS }
