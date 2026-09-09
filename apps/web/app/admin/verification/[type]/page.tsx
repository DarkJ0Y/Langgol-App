import { notFound } from 'next/navigation'
import { listReviewQueue, reviewActionFor } from '@langgol/application'
import { reviewPermissionFor } from '@langgol/domain/admin'
import { createTranslator, type MessageKey } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { kycDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { requirePermission } from '@/lib/guard'
import { ReviewForm } from '../../kyc/review-form'

/**
 * The business, farm and expert review queues.
 *
 * One page for three, because the P10 verification hub already models them as three types of one
 * thing: somebody submitted evidence, somebody qualified looks at it, and a decision is recorded
 * with a reason. Three near-identical pages would be three places for the reviewer's workflow to
 * drift apart.
 *
 * What differs is the permission. A reviewer holding `BUSINESS_REVIEW` gets the business queue and
 * is refused the other two — the type in the URL selects which permission is demanded, so editing
 * the path does not widen anything.
 *
 * Identity has its own screen at `/admin/kyc`, because a national identity document carries an
 * encrypted number and a document viewer that the other three do not.
 *
 * Refs: docs/07_SECURITY.md §4, §5
 */

/** The types this page serves. IDENTITY is deliberately elsewhere; PHONE and EMAIL have no queue. */
const REVIEWABLE_HERE = ['BUSINESS', 'FARM', 'EXPERT'] as const

export default async function AdminVerificationPage({
  params,
}: {
  params: Promise<{ type: string }>
}) {
  const { type } = await params

  // A path that is not one of the three is not found, rather than being refused — an unrecognised
  // route reveals nothing about which queues exist.
  if (!(REVIEWABLE_HERE as readonly string[]).includes(type)) notFound()

  const action = reviewActionFor(type)
  if (action === null || reviewPermissionFor(type) === null) notFound()

  /*
   * The permission for THIS type. Selected from the path and then demanded server-side, so a
   * reviewer who edits the URL from BUSINESS to EXPERT is refused rather than served.
   */
  const actor = await requirePermission(action)
  const t = createTranslator(await getLocale())

  const result = await listReviewQueue(actor, type, await kycDeps())
  if (isErr(result)) {
    return (
      <Card>
        <h1 className="lg-title">{t.t(`admin.${type.toLowerCase()}Title` as MessageKey)}</h1>
        <p className="lg-subtitle">{t.t('errors.notAllowed')}</p>
      </Card>
    )
  }

  const queue = result.value

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

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t(`admin.${type.toLowerCase()}Title` as MessageKey)}</h1>
        <p className="lg-subtitle">
          {queue.length === 0
            ? t.t('kyc.queueEmpty')
            : t.t('kyc.queueCount', { count: queue.length })}
        </p>
      </Card>

      {queue.map((entry) => (
        <Card key={entry.verification.id}>
          <h2 className="lg-title">{entry.subjectName}</h2>
          <p className="lg-subtitle">
            {/* Masked in the repository. A queue identifies a submitter; it does not list phones. */}
            {entry.subjectPhoneMasked}
            {' · '}
            {t.t(`kyc.state${entry.verification.status}` as MessageKey)}
          </p>
          <p className="lg-hint">
            {entry.verification.submittedAt === null
              ? ''
              : t.formatDate(entry.verification.submittedAt)}
          </p>

          {/*
           * No document links and no identity number. These three types are judged on the record
           * itself — a trade licence number, a farm's registered area, an expert's stated
           * qualification — all of which the submitter's own profile already carries. Nothing here
           * needs the KYC document viewer, so nothing here offers it.
           */}
          <ReviewForm verificationId={entry.verification.id} labels={labels} />
        </Card>
      ))}

      <LinkButton href="/admin" variant="ghost">
        {t.t('common.back')}
      </LinkButton>
    </div>
  )
}
