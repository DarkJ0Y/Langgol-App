import { notFound } from 'next/navigation'
import { createTranslator } from '@langgol/i18n'
import { Card } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { authMode } from '@/lib/deps'
import { VerifyForm } from './form'

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ to?: string }>
}) {
  if (authMode() !== 'otp') notFound()

  const { to } = await searchParams
  const t = createTranslator(await getLocale())

  return (
    <Card>
      <h1 className="lg-title">{t.t('auth.codeTitle')}</h1>
      <p className="lg-subtitle">
        {/* Only ever the MASKED number reaches the browser. */}
        {to === undefined ? t.t('auth.signInSubtitle') : t.t('auth.codeSentTo', { phone: to })}
      </p>
      <VerifyForm
        labels={{
          code: t.t('auth.codeLabel'),
          submit: t.t('auth.verify'),
          loading: t.t('common.loading'),
          resend: t.t('auth.resend'),
          invalid: t.t('errors.codeInvalid'),
          unexpected: t.t('errors.unexpected'),
        }}
      />
    </Card>
  )
}
