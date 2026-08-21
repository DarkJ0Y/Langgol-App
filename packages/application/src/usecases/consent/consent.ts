/**
 * Consent: reading what a user has agreed to, and recording what they decide.
 *
 * Four properties this module is built to make hard to break, in the order they matter:
 *
 *  1. **Nothing is enabled silently.** A permission reads as granted only when a decision record
 *     says so. `defaultConsentState` starts everything refused, absence is never inferred as
 *     agreement, and the only way to write a grant is a call carrying that user's own decision.
 *  2. **Optional consent is never bundled.** `recordDecisions` takes a list of individual
 *     answers, each with its own boolean. There is no "accept all" parameter, so a caller wanting
 *     to grant nine permissions has to say so nine times — and the audit log shows nine
 *     decisions, which is what actually happened.
 *  3. **Required consent is separate.** Terms and privacy cannot be withdrawn through this
 *     surface: withdrawing them is leaving the platform, not adjusting a preference, and offering
 *     it beside "marketing messages" would misrepresent what pressing it does.
 *  4. **Nobody decides for anybody else.** No function here takes a subject id — the subject is
 *     the actor. The policy vocabulary has no `consent:decide-any`, so an administrator has no
 *     permission to grant with, and `readConsentFor` (which admins may call) can only read.
 *
 * Refs: docs/07_SECURITY.md §9.2, §9.4, §10
 */

import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import {
  canRecordDecision,
  consentLabel,
  consentStatus,
  hasAcceptedRequired,
  isConsentSource,
  isValidVersionMap,
  outstandingRequiredConsents,
  partitionDecisions,
  CONSENT_CATALOGUE,
  type ConsentSource,
  type ConsentStatus,
  type ConsentType,
  type ConsentVersions,
} from '@langgol/domain/consent'
import type { ConfigSnapshot } from '@langgol/domain/config'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { AuditPort, Clock, ConsentRepository } from '../../ports/index.js'

export interface ConsentDeps {
  readonly config: ConfigSnapshot
  readonly clock: Clock
  readonly consents: ConsentRepository
  readonly audit: AuditPort
}

/** What a consent screen needs: the question, the answer, and whether it may be changed. */
export interface ConsentView extends ConsentStatus {
  readonly title: string
  readonly purpose: string
  /** False for the terms and the privacy policy — those are not a toggle. */
  readonly revocable: boolean
}

export interface ConsentSummary {
  readonly consents: readonly ConsentView[]
  readonly outstandingRequired: readonly ConsentType[]
  readonly satisfied: boolean
}

function versionsFrom(config: ConfigSnapshot): ConsentVersions | null {
  const versions = config.require('consent.versions')
  return isValidVersionMap(versions) ? (versions as ConsentVersions) : null
}

function present(statuses: readonly ConsentStatus[], locale: 'bn' | 'en'): readonly ConsentView[] {
  const order = new Map(CONSENT_CATALOGUE.map((entry) => [entry.type, entry.sortOrder]))
  return [...statuses]
    .sort((a, b) => (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0))
    .map((status) => ({
      ...status,
      ...consentLabel(status.type, locale),
      revocable: !status.required,
    }))
}

/* -------------------------------------------------------------------- read */

/**
 * What the signed-in user has agreed to.
 *
 * No subject parameter: this is always the actor's own. The IP address and user agent stored
 * alongside each decision are deliberately not returned — they exist so an agreement can be
 * evidenced if challenged, not so a screen can display them back. docs/07 §9.2
 */
export async function getMyConsents(
  actor: MaybeActor,
  locale: 'bn' | 'en',
  deps: ConsentDeps,
): Promise<Result<ConsentSummary, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'consent:read-own', { ownerUserId: actor.userId })) {
    return err(Errors.forbidden())
  }

  const versions = versionsFrom(deps.config)
  if (versions === null) {
    return err(Errors.configNotSet('consent.versions'))
  }

  const live = await deps.consents.listLiveForUser(actor.userId)
  const statuses = consentStatus(
    live.map((row) => ({
      type: row.consentType,
      granted: row.granted,
      version: row.version,
      decidedAt: row.grantedAt,
    })),
    versions,
  )

  return ok({
    consents: present(statuses, locale),
    outstandingRequired: outstandingRequiredConsents(statuses),
    satisfied: hasAcceptedRequired(statuses),
  })
}

export interface ConsentHistoryEntry {
  readonly consentType: ConsentType
  readonly granted: boolean
  readonly version: number
  readonly decidedAt: Date
  readonly supersededAt: Date | null
  readonly source: ConsentSource
}

/**
 * Every decision this user has ever recorded, newest first.
 *
 * Their own history, for their own inspection — and the answer to a data-subject request. Still
 * without the IP address and user agent: those are evidence held about the decision, not part of
 * what the user asked to see.
 */
export async function getMyConsentHistory(
  actor: MaybeActor,
  deps: ConsentDeps,
): Promise<Result<readonly ConsentHistoryEntry[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'consent:read-own', { ownerUserId: actor.userId })) {
    return err(Errors.forbidden())
  }

  const rows = await deps.consents.listHistoryForUser(actor.userId)
  return ok(
    rows.map((row) => ({
      consentType: row.consentType,
      granted: row.granted,
      version: row.version,
      decidedAt: row.grantedAt,
      supersededAt: row.revokedAt,
      source: row.source,
    })),
  )
}

/**
 * Read another user's consent state — administrators only, and reading only.
 *
 * Exists because a data-subject request has to be answerable and a support agent has to be able
 * to see whether someone opted out of marketing before investigating why they received a message.
 * Reading is not deciding: there is no counterpart to this that writes, anywhere in the codebase.
 *
 * The access is audited, because looking at somebody's consent record is itself an event worth
 * being able to review. docs/07 §10
 */
export async function readConsentFor(
  actor: MaybeActor,
  subjectUserId: string,
  locale: 'bn' | 'en',
  deps: ConsentDeps,
): Promise<Result<ConsentSummary, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'consent:read-any')) return err(Errors.forbidden())

  const versions = versionsFrom(deps.config)
  if (versions === null) return err(Errors.configNotSet('consent.versions'))

  const live = await deps.consents.listLiveForUser(subjectUserId)

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'CONSENT_VIEWED_BY_ADMIN',
    entityType: 'user',
    entityId: subjectUserId,
  })

  const statuses = consentStatus(
    live.map((row) => ({
      type: row.consentType,
      granted: row.granted,
      version: row.version,
      decidedAt: row.grantedAt,
    })),
    versions,
  )

  return ok({
    consents: present(statuses, locale),
    outstandingRequired: outstandingRequiredConsents(statuses),
    satisfied: hasAcceptedRequired(statuses),
  })
}

/* ------------------------------------------------------------------ decide */

export interface ConsentAnswer {
  readonly type: string
  readonly granted: boolean
}

export interface RecordDecisionsCommand {
  /** One entry per permission, each with its own answer. There is no "grant everything". */
  readonly answers: readonly ConsentAnswer[]
  readonly source: string
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

/**
 * Record the user's own decisions.
 *
 * Optional consents only. A required consent arriving here is refused rather than quietly
 * ignored: a caller trying to toggle the privacy policy has misunderstood something, and silently
 * dropping it would hide that.
 *
 * Every answer is validated against the version currently in force. A stale version means the
 * client was showing text that has since changed, and recording that as current agreement is the
 * formality this whole module exists to avoid.
 */
export async function recordConsentDecisions(
  actor: MaybeActor,
  command: RecordDecisionsCommand,
  deps: ConsentDeps,
): Promise<Result<{ readonly recorded: number }, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'consent:decide-own', { ownerUserId: actor.userId })) {
    return err(Errors.forbidden())
  }

  if (!isConsentSource(command.source)) {
    return err(Errors.validation('Unknown consent source', { field: 'source' }))
  }
  // Captured after the guard: narrowing on a property does not survive into the map below.
  const source: ConsentSource = command.source

  const versions = versionsFrom(deps.config)
  if (versions === null) return err(Errors.configNotSet('consent.versions'))

  const { optional, required, unknown } = partitionDecisions(command.answers)

  if (unknown.length > 0) {
    return err(Errors.validation('That permission does not exist', { field: 'type' }))
  }

  /*
   * A required consent cannot be toggled here even to grant it — accepting the terms happens at
   * signup, through `acceptRequiredConsents`, where the user is actually shown them. Allowing it
   * on the preferences screen would put "I agree to the terms" in a list of switches.
   */
  if (required.length > 0) {
    return err(
      Errors.validation('The terms and privacy policy are not optional settings', {
        field: 'type',
      }),
    )
  }

  if (optional.length === 0) return ok({ recorded: 0 })

  const now = deps.clock.now()
  const inputs = optional.map((answer) => ({
    userId: actor.userId,
    consentType: answer.type,
    granted: answer.granted,
    version: versions[answer.type],
    at: now,
    source,
    ipAddress: command.ipAddress,
    userAgent: command.userAgent,
  }))

  await deps.consents.supersedeMany(inputs)

  /*
   * One audit entry per decision, not one for the batch. "They changed their preferences" is not
   * a fact anybody can act on later; "they withdrew MARKETING at version 1" is.
   */
  for (const input of inputs) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: input.granted ? 'CONSENT_GRANTED' : 'CONSENT_WITHDRAWN',
      entityType: 'consent',
      entityId: input.consentType,
      meta: { version: input.version, source: input.source },
    })
  }

  return ok({ recorded: inputs.length })
}

/**
 * Accept the terms and the privacy policy.
 *
 * Separate from `recordConsentDecisions` on purpose, and it takes no boolean: this call means
 * "the user accepted", and there is no shape of it that means "the user declined". Declining is
 * not a state the platform can hold — it is not creating the account.
 *
 * Each required consent is still recorded individually, at its own version, so which document
 * was accepted and when stays answerable per document.
 */
export async function acceptRequiredConsents(
  actor: MaybeActor,
  command: {
    readonly source: string
    readonly ipAddress: string | null
    readonly userAgent: string | null
  },
  deps: ConsentDeps,
): Promise<Result<{ readonly accepted: readonly ConsentType[] }, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'consent:decide-own', { ownerUserId: actor.userId })) {
    return err(Errors.forbidden())
  }

  if (!isConsentSource(command.source)) {
    return err(Errors.validation('Unknown consent source', { field: 'source' }))
  }

  const versions = versionsFrom(deps.config)
  if (versions === null) return err(Errors.configNotSet('consent.versions'))

  const live = await deps.consents.listLiveForUser(actor.userId)
  const statuses = consentStatus(
    live.map((row) => ({
      type: row.consentType,
      granted: row.granted,
      version: row.version,
      decidedAt: row.grantedAt,
    })),
    versions,
  )

  // Only what is actually outstanding: re-recording an unchanged agreement would add a row that
  // says nothing and make the history harder to read.
  const outstanding = outstandingRequiredConsents(statuses)
  if (outstanding.length === 0) return ok({ accepted: [] })

  const now = deps.clock.now()
  const inputs = outstanding.map((type) => ({
    userId: actor.userId,
    consentType: type,
    granted: true,
    version: versions[type],
    at: now,
    source: command.source as ConsentSource,
    ipAddress: command.ipAddress,
    userAgent: command.userAgent,
  }))

  // Belt and braces: the domain refuses a required consent recorded as declined, and this asserts
  // the same thing at the boundary rather than trusting the loop above stays correct.
  for (const input of inputs) {
    const verdict = canRecordDecision({
      type: input.consentType,
      granted: input.granted,
      version: input.version,
      versions,
    })
    if (!verdict.allowed) {
      return err(Errors.validation('That consent cannot be recorded', { field: 'type' }))
    }
  }

  await deps.consents.supersedeMany(inputs)

  for (const input of inputs) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'CONSENT_GRANTED',
      entityType: 'consent',
      entityId: input.consentType,
      meta: { version: input.version, source: input.source, required: true },
    })
  }

  return ok({ accepted: outstanding })
}
