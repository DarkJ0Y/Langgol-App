import { redirect } from 'next/navigation'
import { myVerifications } from '@langgol/application'
import {
  ALLOWED_DOCUMENT_TYPES,
  SUBMITTABLE_IDENTITY_TYPES,
  VERIFICATION_TYPES,
  type UserFacingStatus,
  type VerificationType,
} from '@langgol/domain/kyc'
import { isActor } from '@langgol/domain/policy'
import { createTranslator, type MessageKey, type Translator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { kycDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { currentActor } from '@/lib/guard'
import { VerificationForm } from './verification-form'

/**
 * What is proven about this account, and how to prove more.
 *
 * One screen for all seven verification types rather than a page each, because "what is proven
 * about me?" is one question — and answering it in seven places is how a person ends up unsure
 * whether they are verified.
 *
 * Every status shown here is the SUBJECT's view: four words, never five. A person waiting does
 * not need to know whether a reviewer has claimed their file, and showing them would raise a
 * question they cannot act on.
 */

/** The four words a person may see, and the tone each carries. */
const STATUS_KEY: Record<UserFacingStatus, MessageKey> = {
  NOT_VERIFIED: 'kyc.statusNotVerified',
  PENDING: 'kyc.statusPending',
  VERIFIED: 'kyc.statusVerified',
  REJECTED: 'kyc.statusRejected',
}

const typeLabel = (t: Translator, type: VerificationType): string =>
  t.t(`kyc.type${type}` as MessageKey)

export default async function VerificationPage() {
  const actor = await currentActor()
  if (!isActor(actor)) redirect('/auth')

  const result = await myVerifications(actor, await kycDeps())
  if (isErr(result)) redirect('/account')

  const t = createTranslator(await getLocale())
  const byType = new Map(result.value.map((view) => [view.type, view]))
  const identity = byType.get('IDENTITY')

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('kyc.title')}</h1>
        <p className="lg-subtitle">{t.t('kyc.subtitle')}</p>

        {/*
         * Every type is listed, including the ones nobody has started. An absent row would read
         * as "this does not apply to me" rather than "this is not done yet".
         */}
        <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {VERIFICATION_TYPES.map((type) => {
            const view = byType.get(type)
            const status: UserFacingStatus = view?.status ?? 'NOT_VERIFIED'
            return (
              <li key={type}>
                <strong>{typeLabel(t, type)}</strong>
                <span className="lg-subtitle">
                  {' · '}
                  {t.t(STATUS_KEY[status])}
                </span>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('kyc.identityTitle')}</h2>

        {identity !== undefined && identity.status === 'VERIFIED' ? (
          <>
            <p className="lg-subtitle">{t.t('kyc.identityVerified')}</p>
            {/* The mask, never the number. This is the only form the page ever holds. */}
            <p className="lg-hint">{identity.identityNumberMasked}</p>
          </>
        ) : null}

        {identity !== undefined && identity.status === 'PENDING' ? (
          <p className="lg-subtitle">{t.t('kyc.identityPending')}</p>
        ) : null}

        {identity !== undefined && identity.status === 'REJECTED' ? (
          <>
            <p className="lg-subtitle">{t.t('kyc.identityRejected')}</p>
            {/*
             * The reviewer's own words. Shown because the person is about to re-submit, and
             * "rejected" with no reason means they send the same documents again.
             */}
            {identity.rejectionReason === null ? null : (
              <p className="lg-hint">{identity.rejectionReason}</p>
            )}
          </>
        ) : null}

        {identity === undefined || identity.canResubmit ? (
          <VerificationForm
            documentTypes={SUBMITTABLE_IDENTITY_TYPES.map((type) => ({
              value: type,
              label: t.t(`kyc.document${type}` as MessageKey),
            }))}
            // Built from the domain's own allowlist, so the picker and the validator can never
            // disagree about what may be sent.
            accept={ALLOWED_DOCUMENT_TYPES.join(',')}
            labels={{
              documentType: t.t('kyc.documentTypeLabel'),
              number: t.t('kyc.numberLabel'),
              numberHint: t.t('kyc.numberHint'),
              front: t.t('kyc.frontLabel'),
              back: t.t('kyc.backLabel'),
              fileHint: t.t('kyc.fileHint'),
              submit: t.t('kyc.submit'),
              loading: t.t('common.loading'),
              submitted: t.t('kyc.submitted'),
              privacyNote: t.t('kyc.privacyNote'),
              errorUnexpected: t.t('errors.unexpected'),
              messages: {
                'errors.kycNumberRequired': t.t('errors.kycNumberRequired'),
                'errors.kycNumberInvalid': t.t('errors.kycNumberInvalid'),
                'errors.kycNumberLength': t.t('errors.kycNumberLength'),
                'errors.kycTypeUnsupported': t.t('errors.kycTypeUnsupported'),
                'errors.kycDocumentUnusable': t.t('errors.kycDocumentUnusable'),
                'errors.kycFrontRequired': t.t('errors.kycFrontRequired'),
                'errors.kycBackRequired': t.t('errors.kycBackRequired'),
                'errors.kycFileTooLarge': t.t('errors.kycFileTooLarge'),
                'errors.kycFileTooSmall': t.t('errors.kycFileTooSmall'),
                'errors.kycFileType': t.t('errors.kycFileType'),
                'errors.kycFileMismatch': t.t('errors.kycFileMismatch'),
                'errors.kycAlreadyPending': t.t('errors.kycAlreadyPending'),
                'errors.kycUnavailable': t.t('errors.kycUnavailable'),
                'errors.notAllowed': t.t('errors.notAllowed'),
                'errors.unexpected': t.t('errors.unexpected'),
              },
            }}
          />
        ) : null}
      </Card>

      <LinkButton href="/account" variant="ghost">
        {t.t('common.back')}
      </LinkButton>
    </div>
  )
}
