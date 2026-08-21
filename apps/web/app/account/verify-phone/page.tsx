import { redirect } from 'next/navigation'
import { getCurrentUser } from '@langgol/application'
import { maskPhone } from '@langgol/domain/identity'
import { createTranslator } from '@langgol/i18n'
import { Alert, Card, LinkButton } from '@langgol/ui/components'
import { accountDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { VerifyPhoneForm } from './form'

/**
 * Confirm the number already on the account.
 *
 * The number is read server-side and shown MASKED. It is never accepted from the caller — this
 * page verifies who you are signed in as, not whatever number a form field happened to carry,
 * which is what stops it becoming a way to send SMS anywhere at Langgol's expense.
 */
export default async function VerifyPhonePage() {
  const actor = await currentActor()
  const deps = await accountDeps()

  const result = await getCurrentUser(actor, deps)
  if (!result.ok) redirect('/auth')
  const profile = result.value

  const t = createTranslator(await getLocale())
  const masked = maskPhone(profile.phone)

  return (
    <Card>
      <h1 className="lg-title">{t.t('verify.phoneTitle')}</h1>

      {profile.phoneVerifiedAt === null ? (
        <>
          <p className="lg-subtitle">{t.t('verify.phoneSubtitle', { phone: masked })}</p>
          <VerifyPhoneForm
            labels={{
              send: t.t('verify.sendCode'),
              code: t.t('verify.codeLabel'),
              confirm: t.t('verify.confirm'),
              resend: t.t('verify.resend'),
              loading: t.t('common.loading'),
              codeSent: t.t('verify.codeSent', { phone: masked }),
              verified: t.t('verify.phoneVerified'),
              rateLimited: t.t('errors.rateLimited', { seconds: '{seconds}' }),
              invalid: t.t('errors.codeInvalid'),
              smsUnavailable: t.t('errors.smsUnavailable'),
              notAllowed: t.t('errors.notAllowed'),
              unexpected: t.t('errors.unexpected'),
            }}
          />
        </>
      ) : (
        <Alert tone="success">{t.t('verify.phoneVerified')}</Alert>
      )}

      <LinkButton href="/account" variant="ghost">
        {t.t('verify.backToAccount')}
      </LinkButton>
    </Card>
  )
}
