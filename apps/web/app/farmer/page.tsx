import { redirect } from 'next/navigation'
import { getMyFarmerProfile } from '@langgol/application'
import { formatLandAmount } from '@langgol/domain/farming'
import { createTranslator } from '@langgol/i18n'
import { Alert, Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { myOnboarding } from '@langgol/application'
import { farmerDeps, onboardingDeps } from '@/lib/deps'
import { OnboardingChecklist } from '../onboarding/checklist'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { labelFor } from './labels'

/**
 * The farmer's dashboard — where registration lands somebody who chose to sell.
 *
 * Deliberately shows what they have told us and what is still missing, rather than a wall of
 * empty widgets. A new farmer's dashboard is mostly a questionnaire prompt, and pretending
 * otherwise with placeholder charts would be worse than admitting it.
 *
 * The completion figure is a progress indicator and nothing else. Nothing in the platform gates
 * on it: a farmer with a half-filled profile can still list, sell and be paid. Making it a
 * precondition would lock out precisely the farmers the questionnaire is meant to serve.
 */
export default async function FarmerDashboardPage() {
  const actor = await currentActor()
  const result = await getMyFarmerProfile(actor, await farmerDeps())

  if (isErr(result)) {
    redirect(result.error.code === 'UNAUTHENTICATED' ? '/auth' : '/')
  }

  const { profile, completion } = result.value
  const t = createTranslator(await getLocale())

  /*
   * Best-effort. A dashboard that failed to render because a progress checklist could not be built
   * would be a worse outcome than a dashboard without one.
   */
  const onboardingResult = await myOnboarding(actor, await onboardingDeps())
  const onboarding = isErr(onboardingResult) ? null : onboardingResult.value
  const unanswered = t.t('farmer.notAnswered')

  /*
   * Shown back in the farmer's own unit, not converted. Somebody who entered "two bigha" and is
   * shown "66 decimals" will reasonably conclude the record is wrong — which is why the unit is
   * stored beside the number in the first place.
   */
  const land =
    profile.totalLandAmountMilli === null || profile.landUnit === null
      ? unanswered
      : `${formatLandAmount(profile.totalLandAmountMilli)} ${labelFor(
          t,
          'unit',
          profile.landUnit,
          unanswered,
        )}`

  const rows: readonly { label: string; value: string }[] = [
    {
      label: t.t('farmer.experienceLabel'),
      value:
        profile.farmingExperienceYears === null
          ? unanswered
          : `${profile.farmingExperienceYears} ${t.t('farmer.experienceUnit')}`,
    },
    {
      label: t.t('farmer.farmerTypeLabel'),
      value: labelFor(t, 'type', profile.farmerType, unanswered),
    },
    { label: t.t('farmer.landLabel'), value: land },
    {
      label: t.t('farmer.ownershipLabel'),
      value: labelFor(t, 'ownership', profile.ownershipType, unanswered),
    },
    {
      label: t.t('farmer.irrigationLabel'),
      value:
        profile.irrigationAvailable === null
          ? unanswered
          : profile.irrigationAvailable
            ? t.t('farmer.irrigationYes')
            : t.t('farmer.irrigationNo'),
    },
    {
      label: t.t('farmer.waterSourceLabel'),
      value: labelFor(t, 'water', profile.waterSource, unanswered),
    },
    {
      label: t.t('farmer.methodLabel'),
      value: labelFor(t, 'method', profile.farmingMethod, unanswered),
    },
  ]

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('farmer.dashboardTitle')}</h1>
        <p className="lg-subtitle">
          {t.t('farmer.dashboardWelcome', { name: profile.displayName })}
        </p>

        {/*
         * The canonical setup progress, and the contextual prompts that go with it.
         *
         * One calculation, shared with the account page, the setup screen and the agricultural
         * identity card. A farmer seeing 60% here and 75% there would have found a bug whichever
         * number was right, so there is only one.
         *
         * Progress, never a gate. Nothing on this page or anywhere else refuses an action because
         * of what this says.
         */}
        {onboarding === null ? null : (
          <OnboardingChecklist view={onboarding} t={t} showCompleted={false} />
        )}
      </Card>

      <Card>
        {/*
         * The farming questionnaire's own progress, which answers a narrower question: how many of
         * the farming questions have been answered. Kept separate from the figure above, and
         * labelled so the two cannot be read as the same claim.
         */}
        <h2 className="lg-title">{t.t('farmer.completionTitle')}</h2>
        <progress value={completion.percent} max={100} className="lg-progress" />
        <span className="lg-subtitle">
          {t.t('farmer.completionPercent', { percent: completion.percent })}
        </span>

        {completion.isComplete ? (
          <Alert tone="success">{t.t('farmer.completionDone')}</Alert>
        ) : (
          <Alert tone="info">
            {t.t('farmer.completionRemaining', { count: completion.missing.length })}
          </Alert>
        )}
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('farmer.profileCard')}</h2>
        <p className="lg-subtitle">{t.t('farmer.profileCardHint')}</p>

        <dl className="lg-stack-tight">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="lg-label">{row.label}</dt>
              <dd className="lg-subtitle">{row.value}</dd>
            </div>
          ))}
        </dl>

        <LinkButton href="/farmer/onboarding">{t.t('farmer.editProfile')}</LinkButton>
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('farm.myFarms')}</h2>
        <p className="lg-subtitle">{t.t('farm.myFarmsSubtitle')}</p>
        <LinkButton href="/farmer/farms">{t.t('farm.myFarms')}</LinkButton>
      </Card>
    </div>
  )
}
