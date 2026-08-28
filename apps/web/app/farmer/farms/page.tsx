import { redirect } from 'next/navigation'
import { listMyFarms } from '@langgol/application'
import { formatLandAmount } from '@langgol/domain/farming'
import { createTranslator } from '@langgol/i18n'
import { Alert, Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { farmDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { holdingLabels, holdingOptions } from './labels'
import { HoldingForm } from './holding-form'
import { createFarmAction } from './actions'

/**
 * My farms.
 *
 * The list and the "add" form on one screen rather than two, because a farmer with no farms needs
 * the form and a farmer with three needs the list — putting the form behind a second navigation
 * would make the empty state a dead end.
 */
export default async function MyFarmsPage() {
  const actor = await currentActor()
  const result = await listMyFarms(actor, await farmDeps())

  if (isErr(result)) {
    redirect(result.error.code === 'UNAUTHENTICATED' ? '/auth' : '/')
  }

  const farms = result.value
  const locale = await getLocale()
  const t = createTranslator(locale)

  const area = (farm: (typeof farms)[number]) =>
    farm.areaAmountMilli === null || farm.areaUnit === null
      ? null
      : `${formatLandAmount(farm.areaAmountMilli)} ${t.t(`farmer.unit${farm.areaUnit}` as 'farmer.unitBIGHA')}`

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('farm.myFarms')}</h1>
        <p className="lg-subtitle">{t.t('farm.myFarmsSubtitle')}</p>

        {farms.length === 0 ? (
          <Alert tone="info">{t.t('farm.none')}</Alert>
        ) : (
          <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {farms.map((farm) => (
              <li key={farm.id}>
                <div className="lg-stack-tight">
                  <strong>{farm.name}</strong>
                  <span className="lg-subtitle">
                    {[area(farm), t.t('farm.plotsCount', { count: farm.plotCount })]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <LinkButton href={`/farmer/farms/${farm.id}`} variant="secondary">
                    {t.t('farm.viewFarm')}
                  </LinkButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('farm.addFarm')}</h2>
        <HoldingForm
          action={createFarmAction}
          variant="farm"
          labels={holdingLabels(t, t.t('farm.addFarm'))}
          options={holdingOptions(t)}
          // The area tree is the primary way a farm is located, exactly as for an address — many
          // rural holdings have no street address at all.
          areaPicker={{
            locale,
            labels: {
              division: t.t('address.division'),
              district: t.t('address.district'),
              upazila: t.t('address.upazila'),
              union: t.t('address.union'),
              choose: t.t('address.selectArea'),
              optional: t.t('address.optional'),
            },
          }}
        />
      </Card>
    </div>
  )
}
