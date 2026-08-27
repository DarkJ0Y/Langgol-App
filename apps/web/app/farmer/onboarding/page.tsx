import { redirect } from 'next/navigation'
import { getMyFarmerProfile } from '@langgol/application'
import { formatLandAmount } from '@langgol/domain/farming'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { farmerDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import {
  farmerTypeOptions,
  farmingMethodOptions,
  irrigationMethodOptions,
  landUnitOptions,
  ownershipOptions,
  waterSourceOptions,
} from '../labels'
import { OnboardingForm } from './onboarding-form'

/**
 * The farmer questionnaire.
 *
 * Reachable straight after registration and from the dashboard, and it is the same screen both
 * times — a separate "edit" variant would be two forms to keep in step, and the second one is
 * always the one that misses a field.
 *
 * A non-farmer reaching this URL is redirected rather than shown an error. `getMyFarmerProfile`
 * returns FORBIDDEN for them, which is the real gate; this is just a kinder landing.
 */
export default async function FarmerOnboardingPage() {
  const actor = await currentActor()
  const result = await getMyFarmerProfile(actor, await farmerDeps())

  if (isErr(result)) {
    // UNAUTHENTICATED means sign in; FORBIDDEN means they are signed in but do not sell.
    redirect(result.error.code === 'UNAUTHENTICATED' ? '/auth' : '/')
  }

  const { profile } = result.value
  const t = createTranslator(await getLocale())

  return (
    <Card>
      <h1 className="lg-title">{t.t('farmer.onboardingTitle')}</h1>
      <p className="lg-subtitle">{t.t('farmer.onboardingSubtitle')}</p>

      <OnboardingForm
        options={{
          farmerTypes: farmerTypeOptions(t),
          landUnits: landUnitOptions(t),
          ownershipTypes: ownershipOptions(t),
          irrigationMethods: irrigationMethodOptions(t),
          waterSources: waterSourceOptions(t),
          farmingMethods: farmingMethodOptions(t),
        }}
        initial={{
          // Everything renders as a string, because that is what a form field holds. `null`
          // becomes `''`, which is what "not answered" posts back.
          farmingExperienceYears:
            profile.farmingExperienceYears === null ? '' : String(profile.farmingExperienceYears),
          farmerType: profile.farmerType ?? '',
          totalLandAmount:
            profile.totalLandAmountMilli === null
              ? ''
              : formatLandAmount(profile.totalLandAmountMilli),
          landUnit: profile.landUnit ?? '',
          ownershipType: profile.ownershipType ?? '',
          irrigationAvailable:
            profile.irrigationAvailable === null ? '' : profile.irrigationAvailable ? 'YES' : 'NO',
          irrigationMethod: profile.irrigationMethod ?? '',
          waterSource: profile.waterSource ?? '',
          farmingMethod: profile.farmingMethod ?? '',
        }}
        labels={{
          optionalNote: t.t('farmer.optionalNote'),
          experience: t.t('farmer.experienceLabel'),
          experienceHint: t.t('farmer.experienceHint'),
          experienceUnit: t.t('farmer.experienceUnit'),
          farmerType: t.t('farmer.farmerTypeLabel'),
          land: t.t('farmer.landLabel'),
          landHint: t.t('farmer.landHint'),
          landUnit: t.t('farmer.landUnitLabel'),
          ownership: t.t('farmer.ownershipLabel'),
          irrigation: t.t('farmer.irrigationLabel'),
          irrigationYes: t.t('farmer.irrigationYes'),
          irrigationNo: t.t('farmer.irrigationNo'),
          irrigationMethod: t.t('farmer.irrigationMethodLabel'),
          waterSource: t.t('farmer.waterSourceLabel'),
          method: t.t('farmer.methodLabel'),
          methodNote: t.t('farmer.methodNote'),
          notAnswered: t.t('farmer.notAnswered'),
          save: t.t('farmer.save'),
          loading: t.t('common.loading'),
          saved: t.t('farmer.saved'),
          errorExperience: t.t('errors.experienceInvalid'),
          errorLand: t.t('errors.landInvalid'),
          errorIrrigation: t.t('errors.irrigationInconsistent'),
          errorNotAllowed: t.t('errors.notAllowed'),
          errorUnexpected: t.t('errors.unexpected'),
        }}
      />

      {/* Leaving is a first-class option, not a dead end. Every question here can wait. */}
      <LinkButton href="/farmer" variant="ghost">
        {t.t('farmer.skip')}
      </LinkButton>
    </Card>
  )
}
