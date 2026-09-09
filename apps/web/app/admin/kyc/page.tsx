import { listPendingReviews, verificationHistory } from '@langgol/application'
import { createTranslator, type MessageKey } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr, isOk } from '@langgol/shared'
import { kycDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { requirePermission } from '@/lib/guard'
import { documentLinkAction } from './actions'
import { ReviewForm } from './review-form'

/**
 * The KYC review queue.
 *
 * ADMIN only, enforced by `requirePermission` here and independently by every action and use case
 * this page reaches. The guard is what stops the page rendering; it is not what stops the work
 * happening, because a page guard can be bypassed and a use-case check cannot.
 *
 * ## What a reviewer is shown
 *
 * A name, a masked number, and the documents. Not the identity number: reading that is a separate
 * step with its own authorization and its own audit row, so "an operator opened this person's
 * NID" is always a recorded event rather than a side effect of loading a list.
 *
 * Refs: docs/07_SECURITY.md §4, §7, §11
 */

export default async function AdminKycPage() {
  /*
   * Redirects rather than rendering an explanation. Telling an unauthorised visitor that a KYC
   * queue exists at this path is itself a disclosure.
   *
   * Resolved ONCE and reused. This is a courtesy to the reader, not the boundary — every use case
   * below authorizes independently, which is what actually holds.
   */
  const actor = await requirePermission('kyc:review')

  const deps = await kycDeps()
  const queue = await listPendingReviews(actor, deps)
  const t = createTranslator(await getLocale())

  const labels = {
    reason: t.t('kyc.reasonLabel'),
    reasonHint: t.t('kyc.reasonHint'),
    approve: t.t('kyc.approve'),
    reject: t.t('kyc.reject'),
    loading: t.t('common.loading'),
    done: t.t('kyc.decisionSaved'),
    errorUnexpected: t.t('errors.unexpected'),
    messages: {
      'errors.kycReasonRequired': t.t('errors.kycReasonRequired'),
      'errors.kycAlreadyDecided': t.t('errors.kycAlreadyDecided'),
      'errors.notAllowed': t.t('errors.notAllowed'),
      'errors.unexpected': t.t('errors.unexpected'),
    },
  }

  if (isErr(queue)) {
    return (
      <Card>
        <h1 className="lg-title">{t.t('kyc.queueTitle')}</h1>
        <p className="lg-subtitle">{t.t('errors.unexpected')}</p>
      </Card>
    )
  }

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('kyc.queueTitle')}</h1>
        <p className="lg-subtitle">
          {queue.value.length === 0
            ? t.t('kyc.queueEmpty')
            : t.t('kyc.queueCount', { count: queue.value.length })}
        </p>
      </Card>

      {await Promise.all(
        queue.value.map(async (entry) => {
          const history = await verificationHistory(actor, entry.verification.id, deps)

          // Minted server-side. A reviewer clicks a link; they never construct one, and the token
          // names them, so it is inert in anybody else's hands.
          const front = await documentLinkAction(entry.verification.id, 'FRONT')
          const back = entry.verification.hasDocumentBack
            ? await documentLinkAction(entry.verification.id, 'BACK')
            : null

          return (
            <Card key={entry.verification.id}>
              <h2 className="lg-title">{entry.subjectName}</h2>
              <p className="lg-subtitle">
                {entry.subjectPhoneMasked}
                {' · '}
                {t.t(`kyc.document${entry.verification.identityType ?? 'NID'}` as MessageKey)}
                {' · '}
                {/* The mask. The number itself is a separate, audited step. */}
                {entry.verification.identityNumberMasked}
              </p>
              <p className="lg-hint">
                {t.t(`kyc.state${entry.verification.status}` as MessageKey)}
                {entry.verification.submittedAt === null
                  ? ''
                  : ` · ${t.formatDate(entry.verification.submittedAt)}`}
              </p>

              <div className="lg-row">
                {front === null ? null : (
                  <LinkButton href={front} variant="secondary">
                    {t.t('kyc.viewFront')}
                  </LinkButton>
                )}
                {back === null ? null : (
                  <LinkButton href={back} variant="secondary">
                    {t.t('kyc.viewBack')}
                  </LinkButton>
                )}
              </div>

              <ReviewForm verificationId={entry.verification.id} labels={labels} />

              {/*
               * The history, so a reviewer can see whether this person has been rejected before
               * and for what. A file that has come back three times with the same fault is a
               * different decision from a first submission.
               */}
              {isOk(history) && history.value.length > 0 ? (
                <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {history.value.map((line, index) => (
                    <li key={`${line.action}-${String(index)}`} className="lg-hint">
                      {t.formatDate(line.at)}
                      {' · '}
                      {line.action}
                      {' → '}
                      {line.toStatus}
                      {line.reason === null ? '' : ` · ${line.reason}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          )
        }),
      )}
    </div>
  )
}
