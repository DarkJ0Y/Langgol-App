/**
 * Diagnose a crop disease from a photograph.
 *
 * The order of the checks below is the whole design, and it is deliberate: everything that can
 * refuse for free happens before the one step that costs money. Authentication, then consent,
 * then the image, then the budget — and only then the provider.
 *
 * ## Consent is a gate, not a formality
 *
 * `AI_DATA_PROCESSING` is an OPTIONAL consent, which is a promise Langgol made in Phase 4: a
 * farmer who declines keeps a fully working marketplace. So this use case refuses cleanly and the
 * screen hides the feature — a farmer must never meet a button that returns an error, because
 * that teaches them declining broke the app.
 *
 * The photograph is sent outside Bangladesh to a third party. That is exactly what the consent
 * covers and why it is classed Sensitive, so the check is here, before the bytes leave.
 *
 * ## The image is not stored
 *
 * Nothing in this file writes the image anywhere. That is the product decision, and it is
 * enforced by the absence of a storage call rather than by a retention job that could be
 * misconfigured later.
 *
 * Refs: docs/07_SECURITY.md §7, §9.2; docs/03_ARCHITECTURE.md §4
 */

import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import {
  diagnosisPrompt,
  disclaimerFor,
  evaluateAdvisoryBudget,
  evaluateImage,
  type Diagnosis,
  type DiagnosisRefusal,
} from '@langgol/domain/advisory'
import { consentStatus } from '@langgol/domain/consent'
import type { ConsentVersions } from '@langgol/domain/consent'
import type { FarmingFields } from '@langgol/domain/farming'
import type { Poisha } from '@langgol/domain/money'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AdvisoryPort,
  AuditPort,
  Clock,
  ConsentRepository,
  DiagnosisRepository,
  FarmerProfileRepository,
} from '../../ports/index.js'

export interface DiagnoseDeps {
  readonly clock: Clock
  readonly advisory: AdvisoryPort
  readonly consents: ConsentRepository
  readonly farmers: FarmerProfileRepository
  readonly diagnoses: DiagnosisRepository
  readonly audit: AuditPort
  readonly consentVersions: ConsentVersions
  /** Platform-wide daily ceiling and the per-farmer cap. Composed from env in `advisoryDeps()`. */
  readonly limits: { readonly dailyBudget: Poisha; readonly perUserDailyLimit: number }
}

export interface DiagnoseCommand {
  readonly image: Uint8Array
  readonly contentType: string
  readonly locale: 'bn' | 'en'
  /** The farmer's own description. Trimmed and capped at QUESTION_MAX_LENGTH before it is sent. */
  readonly question?: string | undefined
}

/** Long enough for a farmer to describe a problem; short enough not to be a prompt-stuffing channel. */
export const QUESTION_MAX_LENGTH = 500

export interface DiagnosisView {
  readonly diagnosis: Diagnosis
  /** Always present. Attached by the domain so no screen can render an answer without it. */
  readonly disclaimer: string
  readonly promptVersion: number
}

/** Map a domain refusal onto the error the caller should surface. */
function refusalError(refusal: DiagnosisRefusal): AppError {
  switch (refusal) {
    case 'NO_CONSENT':
      return Errors.forbidden()
    case 'IMAGE_MISSING':
      return Errors.validation('Attach a photograph', { field: 'image', code: refusal })
    case 'IMAGE_TOO_LARGE':
      return Errors.validation('That photograph is too large', { field: 'image', code: refusal })
    case 'IMAGE_UNSUPPORTED_TYPE':
      return Errors.validation('That file is not a photograph', { field: 'image', code: refusal })
    case 'BUDGET_EXHAUSTED':
    case 'RATE_LIMITED':
      return Errors.rateLimited(0)
  }
}

export async function diagnoseCropDisease(
  actor: MaybeActor,
  command: DiagnoseCommand,
  deps: DiagnoseDeps,
): Promise<Result<DiagnosisView, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'advisory:use')) return err(Errors.forbidden())

  // --- Is the feature even wired up? ---------------------------------------
  if (!deps.advisory.isAvailable) {
    // A deployment with no provider configured. Not the farmer's fault and not an error they can
    // act on, so it is reported as unavailable rather than as a failure.
    return err(Errors.providerUnavailable('Advisory'))
  }

  const now = deps.clock.now()

  /*
   * --- Consent, before the bytes go anywhere --------------------------------
   *
   * Read from the live record rather than a cached flag: a farmer who withdrew consent this
   * morning must not have a photograph sent this afternoon.
   */
  const live = await deps.consents.listLiveForUser(actor.userId)
  const statuses = consentStatus(
    live.map((row) => ({
      type: row.consentType,
      granted: row.granted,
      version: row.version,
      decidedAt: row.grantedAt,
    })),
    deps.consentVersions,
  )
  const aiConsent = statuses.find((s) => s.type === 'AI_DATA_PROCESSING')

  if (aiConsent === undefined || !aiConsent.granted || aiConsent.stale) {
    /*
     * `stale` counts as refused. The consent text names what the data is used for, so a farmer who
     * agreed to an older wording has not agreed to this one — they are asked again rather than
     * carried over.
     */
    return err(refusalError('NO_CONSENT'))
  }

  // --- The image, which is free to reject ----------------------------------
  const verdict = evaluateImage({
    contentType: command.contentType,
    byteLength: command.image.byteLength,
  })
  if (!verdict.ok) return err(refusalError(verdict.refusal))

  // --- The budget, the last free check -------------------------------------
  const [servedToday, servedTodayForUser] = await Promise.all([
    deps.diagnoses.countSince(startOfDay(now)),
    deps.diagnoses.countForUserSince(actor.userId, startOfDay(now)),
  ])

  const budget = evaluateAdvisoryBudget(
    { servedToday, servedTodayForUser },
    {
      unitCost: deps.advisory.unitCost,
      dailyBudget: deps.limits.dailyBudget,
      perUserDailyLimit: deps.limits.perUserDailyLimit,
    },
  )

  if (!budget.allowed) {
    /*
     * Audited without a user id for the platform-wide case: knowing the budget was reached is an
     * operational fact, and attributing it to whoever happened to ask last would be misleading.
     */
    await deps.audit.record({
      actorUserId: budget.reason === 'USER_LIMIT_REACHED' ? actor.userId : null,
      action: 'ADVISORY_REFUSED',
      entityType: 'advisory',
      entityId: actor.userId,
      reason: budget.reason,
    })
    return err(
      refusalError(budget.reason === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : 'RATE_LIMITED'),
    )
  }

  // --- Ask ------------------------------------------------------------------
  const profile = await deps.farmers.findByUserId(actor.userId)
  const fields: FarmingFields | null = profile
  const { system, version } = diagnosisPrompt(command.locale, fields)

  const question = command.question?.trim().slice(0, QUESTION_MAX_LENGTH)

  const answer = await deps.advisory.diagnose({
    systemPrompt: system,
    image: command.image,
    contentType: command.contentType,
    locale: command.locale,
    question: question === undefined || question === '' ? undefined : question,
  })

  if (!answer.ok) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'ADVISORY_FAILED',
      entityType: 'advisory',
      entityId: actor.userId,
      reason: answer.reason,
    })
    return err(Errors.providerUnavailable('Advisory'))
  }

  /*
   * --- Record that it happened ---------------------------------------------
   *
   * The answer is stored so a farmer can look back at what they were told; the photograph is not.
   * The audit row carries neither — it says a diagnosis was served, which is what an
   * investigation needs, and copies nothing into a table with a different retention policy.
   */
  await deps.diagnoses.record({
    userId: actor.userId,
    answer: answer.diagnosis.answer,
    confidence: answer.diagnosis.confidence,
    unusableImage: answer.diagnosis.unusableImage,
    promptVersion: version,
    provider: deps.advisory.providerName,
    at: now,
  })

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'ADVISORY_DIAGNOSIS_SERVED',
    entityType: 'advisory',
    entityId: actor.userId,
    reason: `promptVersion=${String(version)}`,
  })

  return ok({
    diagnosis: answer.diagnosis,
    disclaimer: disclaimerFor(command.locale),
    promptVersion: version,
  })
}

/** Midnight UTC. The budget is a daily allowance and needs a consistent boundary. */
function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}
