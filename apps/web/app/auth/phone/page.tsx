import { notFound } from 'next/navigation'
import { createTranslator } from '@langgol/i18n'
import { Card } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { authMode } from '@/lib/deps'
import { PhoneForm } from './form'

export default async function PhonePage() {
  if (authMode() !== 'otp') notFound()

  const t = createTranslator(await getLocale())

  return (
    <Card>
      <h1 className="lg-title">{t.t('auth.signInTitle')}</h1>
      <p className="lg-subtitle">{t.t('auth.signInSubtitle')}</p>
      <PhoneForm
        labels={{
          phone: t.t('auth.phoneLabel'),
          hint: t.t('auth.phoneHelp'),
          placeholder: t.t('auth.phonePlaceholder'),
          submit: t.t('auth.sendCode'),
          loading: t.t('common.loading'),
          invalid: t.t('errors.phoneInvalid'),
          empty: t.t('errors.phoneEmpty'),
          unexpected: t.t('errors.unexpected'),
        }}
      />
    </Card>
  )
}
