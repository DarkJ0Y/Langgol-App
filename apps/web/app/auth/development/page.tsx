import { notFound } from 'next/navigation'
import { DEVELOPMENT_IDENTITIES, developmentIdentityLabel } from '@langgol/domain/identity'
import { createTranslator } from '@langgol/i18n'
import { Alert, Card } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { authMode } from '@/lib/deps'
import { DevelopmentIdentityForm } from './form'

/**
 * Development sign-in.
 *
 * The selector renders ONLY the fixture keys from the domain allowlist. No user id, no phone
 * number, no database id and no role control appears anywhere on this page or in its form —
 * there is nothing here to manipulate.
 *
 * The route 404s outside development mode, so it does not even exist as a target in staging or
 * production. That is presentation; the real refusal is in the use case and the database.
 */
export default async function DevelopmentAuthPage() {
  if (authMode() !== 'development') notFound()

  const locale = await getLocale()
  const t = createTranslator(locale)

  // The key is the only internal value that crosses to the browser, and it is opaque. No id,
  // no phone number, no role control — and the label is in the reader's language.
  const identities = DEVELOPMENT_IDENTITIES.map((identity) => {
    const localised = developmentIdentityLabel(identity, locale)
    return { key: identity.key, label: localised.name, description: localised.description }
  })

  return (
    <div className="lg-stack">
      <Alert tone="warning" title={locale === 'bn' ? 'ডেভেলপমেন্ট' : 'Development'}>
        {locale === 'bn'
          ? 'এসএমএস বা ওটিপি ছাড়াই প্রবেশ। শুধু পরীক্ষার জন্য নির্ধারিত পরিচয়।'
          : 'Sign in without SMS or OTP, as one of a fixed set of test identities.'}
      </Alert>

      <Card>
        <h1 className="lg-title">
          {locale === 'bn' ? 'পরীক্ষার পরিচয় বেছে নিন' : 'Choose a test identity'}
        </h1>
        <p className="lg-subtitle">{t.t('auth.signInSubtitle')}</p>
        <DevelopmentIdentityForm
          identities={identities}
          submitLabel={t.t('common.continue')}
          loadingLabel={t.t('common.loading')}
        />
      </Card>
    </div>
  )
}
