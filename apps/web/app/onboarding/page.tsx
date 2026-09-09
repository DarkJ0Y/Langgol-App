import { redirect } from 'next/navigation'
import { myOnboarding } from '@langgol/application'
import { isActor } from '@langgol/domain/policy'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { onboardingDeps } from '@/lib/deps'
import { getLocale } from '@/lib/locale'
import { currentActor } from '@/lib/guard'
import { OnboardingChecklist } from './checklist'

/**
 * The setup screen.
 *
 * Somewhere to see the whole list at once, for a person who wants to work through it. The
 * dashboards show the same thing in a shorter form, built from the same component and the same
 * use case — two renderings of one calculation rather than two calculations.
 *
 * Reachable, dismissible, and mandatory to nobody. There is no redirect anywhere in the app that
 * sends an incomplete account here and refuses to let it leave, which is the difference between
 * this and the registration wall it replaces.
 */
export default async function OnboardingPage() {
  const actor = await currentActor()
  if (!isActor(actor)) redirect('/auth')

  const result = await myOnboarding(actor, await onboardingDeps())
  if (isErr(result)) redirect('/account')

  const t = createTranslator(await getLocale())

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('onboarding.title')}</h1>
        <p className="lg-subtitle">{t.t('onboarding.subtitle')}</p>

        <OnboardingChecklist view={result.value} t={t} />
      </Card>

      {/* Leaving is a first-class option. Every question here can wait. */}
      <LinkButton href="/account" variant="ghost">
        {t.t('common.back')}
      </LinkButton>
    </div>
  )
}
