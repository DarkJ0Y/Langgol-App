import { notFound, redirect } from 'next/navigation'
import { getMyFarm, listPlots } from '@langgol/application'
import { formatLandAmount } from '@langgol/domain/farming'
import { createTranslator } from '@langgol/i18n'
import { Alert, Button, Card, LinkButton } from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import type { MessageKey } from '@langgol/i18n'
import { farmDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { holdingLabels, holdingOptions } from '../labels'
import { HoldingForm } from '../holding-form'
import {
  createPlotAction,
  deleteFarmAction,
  deletePlotAction,
  updateFarmAction,
  updatePlotAction,
} from '../actions'

/**
 * One farm: its details, its plots, and the forms to change both.
 *
 * A farm belonging to somebody else reaches `notFound()` — the use case already refuses with
 * NOT_FOUND rather than FORBIDDEN, so the screen cannot accidentally confirm that an id exists.
 */
export default async function FarmDetailPage({ params }: { params: Promise<{ farmId: string }> }) {
  const { farmId } = await params
  const actor = await currentActor()
  const deps = await farmDeps()

  const farmResult = await getMyFarm(actor, farmId, deps)
  if (isErr(farmResult)) {
    if (farmResult.error.code === 'UNAUTHENTICATED') redirect('/auth')
    // Not theirs and not there are the same answer, deliberately.
    notFound()
  }

  const farm = farmResult.value
  const plotsResult = await listPlots(actor, farmId, deps)
  const plots = isErr(plotsResult) ? [] : plotsResult.value

  const t = createTranslator(await getLocale())
  const unanswered = t.t('farm.notAnswered')

  const label = (prefix: string, value: string | null, section = 'farmer') =>
    value === null ? unanswered : t.t(`${section}.${prefix}${value}` as MessageKey)

  const areaOf = (amount: number | null, unit: string | null) =>
    amount === null || unit === null
      ? unanswered
      : `${formatLandAmount(amount)} ${t.t(`farmer.unit${unit}` as 'farmer.unitBIGHA')}`

  const rows: readonly { label: string; value: string }[] = [
    { label: t.t('farm.area'), value: areaOf(farm.areaAmountMilli, farm.areaUnit) },
    { label: t.t('farm.soil'), value: label('soil', farm.soilType, 'farm') },
    { label: t.t('farm.ownership'), value: label('ownership', farm.ownershipType) },
    {
      label: t.t('farm.irrigation'),
      value:
        farm.irrigationAvailable === null
          ? unanswered
          : farm.irrigationAvailable
            ? t.t('farm.irrigationYes')
            : t.t('farm.irrigationNo'),
    },
    { label: t.t('farm.waterSource'), value: label('water', farm.waterSource) },
    { label: t.t('farm.method'), value: label('method', farm.farmingMethod) },
  ]

  return (
    <div className="lg-stack">
      <Card>
        <LinkButton href="/farmer/farms" variant="ghost">
          ← {t.t('farm.backToFarms')}
        </LinkButton>
        <h1 className="lg-title">{farm.name}</h1>

        <dl className="lg-stack-tight">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="lg-label">{row.label}</dt>
              <dd className="lg-subtitle">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ------------------------------------------------------------ plots */}
      <Card>
        <h2 className="lg-title">{t.t('farm.plots')}</h2>

        {plots.length === 0 ? (
          <Alert tone="info">{t.t('farm.noPlots')}</Alert>
        ) : (
          <ul className="lg-stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {plots.map((plot) => (
              <li key={plot.id} className="lg-stack-tight">
                <strong>{plot.name}</strong>
                <span className="lg-subtitle">
                  {[
                    areaOf(plot.areaAmountMilli, plot.areaUnit),
                    label('soil', plot.soilType, 'farm'),
                  ].join(' · ')}
                  {plot.inherited.length > 0 ? ` · ${t.t('farm.inheritedFromFarm')}` : ''}
                </span>

                <details>
                  <summary className="lg-subtitle">{t.t('farm.editPlot')}</summary>
                  <HoldingForm
                    action={updatePlotAction}
                    variant="plot"
                    hidden={{ plotId: plot.id, farmId }}
                    labels={{
                      ...holdingLabels(t, t.t('common.save')),
                      name: t.t('farm.plotName'),
                      nameHint: t.t('farm.plotNameHint'),
                    }}
                    options={holdingOptions(t)}
                    initial={{
                      name: plot.name,
                      areaAmount:
                        plot.areaAmountMilli === null ? '' : formatLandAmount(plot.areaAmountMilli),
                      areaUnit: plot.areaUnit ?? '',
                      soilType: plot.soilType ?? '',
                      ownershipType: '',
                      irrigationAvailable: '',
                      irrigationMethod: plot.irrigationMethod ?? '',
                      waterSource: '',
                      farmingMethod: '',
                    }}
                  />
                  <form action={deletePlotAction}>
                    <input type="hidden" name="plotId" value={plot.id} />
                    <input type="hidden" name="farmId" value={farmId} />
                    <Button type="submit" variant="ghost">
                      {t.t('farm.removePlot')}
                    </Button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}

        <details>
          <summary className="lg-label">{t.t('farm.addPlot')}</summary>
          <HoldingForm
            action={createPlotAction}
            variant="plot"
            hidden={{ farmId }}
            labels={{
              ...holdingLabels(t, t.t('farm.addPlot')),
              name: t.t('farm.plotName'),
              nameHint: t.t('farm.plotNameHint'),
            }}
            options={holdingOptions(t)}
          />
        </details>
      </Card>

      {/* ------------------------------------------------------- edit farm */}
      <Card>
        <h2 className="lg-title">{t.t('farm.editFarm')}</h2>
        <HoldingForm
          action={updateFarmAction}
          variant="farm"
          hidden={{ farmId }}
          labels={holdingLabels(t, t.t('common.save'))}
          options={holdingOptions(t)}
          initial={{
            name: farm.name,
            areaAmount: farm.areaAmountMilli === null ? '' : formatLandAmount(farm.areaAmountMilli),
            areaUnit: farm.areaUnit ?? '',
            soilType: farm.soilType ?? '',
            ownershipType: farm.ownershipType ?? '',
            irrigationAvailable:
              farm.irrigationAvailable === null ? '' : farm.irrigationAvailable ? 'YES' : 'NO',
            irrigationMethod: farm.irrigationMethod ?? '',
            waterSource: farm.waterSource ?? '',
            farmingMethod: farm.farmingMethod ?? '',
          }}
        />

        <form action={deleteFarmAction}>
          <input type="hidden" name="farmId" value={farmId} />
          <Button type="submit" variant="ghost">
            {t.t('farm.removeFarm')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
