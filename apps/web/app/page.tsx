import { createTranslator } from '@langgol/i18n'
import { developmentIdentityLabel, findDevelopmentIdentityByPhone } from '@langgol/domain/identity'
import { Alert, Button, Card } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { getTheme } from '@/lib/theme'
import { landingData } from '@/lib/landing'
import { signOutAction } from './actions/auth'
import { FeatureHub } from './feature-hub'
import { HomeLanding } from './home-landing'

export default async function HomePage() {
  const locale = await getLocale()
  const t = createTranslator(locale)
  const session = await getSession()

  /*
   * A visitor who is not signed in gets the marketing page; somebody who is gets their account.
   * The landing is what answers "what is this?", and a farmer who has already answered that
   * question should not have to scroll past it to reach their own work.
   */
  if (session === null) {
    return <HomeLanding t={t} locale={locale} theme={await getTheme()} data={await landingData()} />
  }

  // A fixture shows its localised label; a real account shows the name it was registered with.
  const fixture = session.isDevelopmentFixture
    ? findDevelopmentIdentityByPhone(session.phone)
    : undefined
  const displayName =
    fixture === undefined ? session.fullName : developmentIdentityLabel(fixture, locale).name

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{displayName}</h1>
        <p className="lg-subtitle">
          {session.roles.length === 0
            ? t.t('auth.chooseRole')
            : session.roles.map((role) => t.t(`profile.role${role}`)).join(' · ')}
        </p>
        {session.isDevelopmentFixture ? (
          <Alert tone="warning">
            {locale === 'bn'
              ? 'এটি একটি ডেভেলপমেন্ট পরিচয়। আসল তথ্য নয়।'
              : 'This is a development fixture identity. Not real data.'}
          </Alert>
        ) : null}
      </Card>

      {/* Every area this person can open. With the all-features demo account, all of them. */}
      <FeatureHub roles={session.roles} locale={locale} />

      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          {t.t('auth.signOut')}
        </Button>
      </form>
    </div>
  )
}
