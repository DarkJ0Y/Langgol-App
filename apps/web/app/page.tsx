import { createTranslator } from '@langgol/i18n'
import { Alert, Button, Card } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { signOutAction } from './actions/auth'

export default async function HomePage() {
  const locale = await getLocale()
  const t = createTranslator(locale)
  const session = await getSession()

  if (session === null) {
    return (
      <Card>
        <h1 className="lg-title">{t.t('common.appName')}</h1>
        <p className="lg-subtitle">{t.t('auth.signInSubtitle')}</p>
        <a href="/auth">
          <Button type="button">{t.t('auth.signInTitle')}</Button>
        </a>
      </Card>
    )
  }

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{session.fullName}</h1>
        <p className="lg-subtitle">
          {session.roles.length === 0
            ? t.t('auth.chooseRole')
            : session.roles.map((role) => t.t(`auth.role${titleCase(role)}` as never)).join(' · ')}
        </p>
        {session.isDevelopmentFixture ? (
          <Alert tone="warning">
            {locale === 'bn'
              ? 'এটি একটি ডেভেলপমেন্ট পরিচয়। আসল তথ্য নয়।'
              : 'This is a development fixture identity. Not real data.'}
          </Alert>
        ) : null}
      </Card>

      {/*
        P1 ends here on purpose. The farmer dashboard, listings and marketplace are P2 and are
        not built until that phase is approved.
      */}
      <Card>
        <p className="lg-hint">
          {locale === 'bn'
            ? 'বাজার ও ফসলের সুবিধা পরবর্তী ধাপে আসছে।'
            : 'Marketplace and produce features arrive in the next phase.'}
        </p>
      </Card>

      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          {t.t('auth.signOut')}
        </Button>
      </form>
    </div>
  )
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase()
}
