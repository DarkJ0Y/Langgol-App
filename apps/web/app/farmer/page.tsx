import { redirect } from 'next/navigation'
import { getMyFarmerProfile } from '@langgol/application'
import { formatLandAmount } from '@langgol/domain/farming'
import * as Money from '@langgol/domain/money'
import { createTranslator } from '@langgol/i18n'
import {
  Alert,
  Card,
  ChartCard,
  ColumnChart,
  DataTable,
  LinkButton,
  Meter,
  SplitBar,
  StatRow,
  StatTile,
  type VizSlot,
} from '@langgol/ui/components'
import { isErr } from '@langgol/shared'
import { myOnboarding } from '@langgol/application'
import { farmerDeps, onboardingDeps } from '@/lib/deps'
import { OnboardingChecklist } from '../onboarding/checklist'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { farmerInsights } from '@/lib/insights'
import {
  count,
  kgCompact,
  monthLabel,
  chartTaka,
  percentChange,
  percentChangeMoney,
  seasonLabel,
  takaCompact,
  takaFull,
  takaTick,
} from '@/lib/viz-format'
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
  const locale = await getLocale()
  const t = createTranslator(locale)
  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)

  // Scoped to the profile the use case above just authorized as the actor's own.
  const insights = await farmerInsights(profile.id)
  const hasHistory = insights.seasons.length > 0
  const hasSales = insights.salesByMonth.some((month) => month.orders > 0)
  const totals = insights.totals
  const year = new Date().getUTCFullYear()

  // Eight categorical slots at most; a ninth crop and beyond fold into "Other", never a new hue.
  const crops = insights.cropMix.slice(0, 7)
  const otherKg = insights.cropMix.slice(7).reduce((sum, crop) => sum + crop.kg, 0)
  const cropSegments = [
    ...crops.map((crop, index) => ({
      label: locale === 'bn' ? crop.nameBn : crop.nameEn,
      value: crop.kg,
      slot: (index + 1) as VizSlot,
    })),
    ...(otherKg > 0
      ? [{ label: say('অন্যান্য', 'Other'), value: otherKg, slot: 8 as VizSlot }]
      : []),
  ]
  const profit = Money.subtract(totals.revenueThisYearPoisha, totals.costThisYearPoisha)
  const incomeChange = percentChangeMoney(
    totals.revenueThisYearPoisha,
    totals.revenueLastYearPoisha,
    t,
  )

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
    <div className="lg-dash">
      <header className="lg-dash__head">
        <div>
          <h1 className="lg-dash__title">{t.t('farmer.dashboardTitle')}</h1>
          <p className="lg-dash__lede">
            {t.t('farmer.dashboardWelcome', { name: profile.displayName })}
          </p>
        </div>
        <div className="lg-dash__actions">
          <LinkButton href="/farmer/farms" variant="secondary">
            {t.t('farm.myFarms')}
          </LinkButton>
          <LinkButton href="/market">{say('বাজার দেখুন', 'Open the market')}</LinkButton>
        </div>
      </header>

      {/*
        The numbers first, as tiles: what a farmer asks before anything else is "how am I doing
        this year?". Each change is against last year, named, and says whether it is good news.
      */}
      <StatRow>
        <StatTile
          label={say(`${t.digits(year)} সালের আয়`, `Income in ${String(year)}`)}
          value={takaCompact(totals.revenueThisYearPoisha, locale, t)}
          delta={
            incomeChange === undefined
              ? undefined
              : say(
                  `গত বছরের একই সময়ের তুলনায় ${incomeChange}`,
                  `${incomeChange} vs this time last year`,
                )
          }
          deltaTone={
            Money.compare(totals.revenueThisYearPoisha, totals.revenueLastYearPoisha) >= 0
              ? 'good'
              : 'bad'
          }
        />
        <StatTile
          label={say('এ বছরের লাভ', 'Profit this year')}
          value={takaCompact(profit, locale, t)}
          hint={say(
            `খরচ ${takaCompact(totals.costThisYearPoisha, locale, t)}`,
            `after ${takaCompact(totals.costThisYearPoisha, locale, t)} costs`,
          )}
        />
        <StatTile
          label={say('এ বছরের ফসল', 'Harvest this year')}
          value={kgCompact(totals.harvestKgThisYear, locale, t)}
          delta={
            percentChange(totals.harvestKgThisYear, totals.harvestKgLastYear, t) === undefined
              ? undefined
              : say(
                  `গত বছরের একই সময়ের তুলনায় ${percentChange(totals.harvestKgThisYear, totals.harvestKgLastYear, t) ?? ''}`,
                  `${percentChange(totals.harvestKgThisYear, totals.harvestKgLastYear, t) ?? ''} vs this time last year`,
                )
          }
          deltaTone={totals.harvestKgThisYear >= totals.harvestKgLastYear ? 'good' : 'bad'}
        />
        <StatTile
          label={say('গত ৩০ দিনের অর্ডার', 'Orders, last 30 days')}
          value={count(totals.ordersLast30, t)}
          hint={
            totals.rating === null
              ? undefined
              : say(
                  `রেটিং ★ ${t.digits(totals.rating.toFixed(1))}`,
                  `rated ★ ${totals.rating.toFixed(1)}`,
                )
          }
        />
        <StatTile
          label={say('জমি ও প্লট', 'Farms and plots')}
          value={`${count(totals.farms, t)} · ${count(totals.plots, t)}`}
          hint={say('জমি · প্লট', 'farms · plots')}
        />
      </StatRow>

      {hasHistory || hasSales ? (
        <div className="lg-dash__grid">
          {hasHistory ? (
            <div className="lg-dash__wide">
              <ChartCard
                title={say('মৌসুম অনুযায়ী আয় ও খরচ', 'Income and cost by season')}
                subtitle={say(
                  'প্রতিটি মৌসুমে ফসল বিক্রির আয়, চাষের খরচের পাশে।',
                  'What each season’s harvest earned, beside what it cost to grow.',
                )}
                tableLabel={say('টেবিল হিসেবে দেখুন', 'Show as table')}
                table={
                  <DataTable
                    columns={[
                      say('মৌসুম', 'Season'),
                      say('আয়', 'Income'),
                      say('খরচ', 'Cost'),
                      say('ফসল', 'Harvest'),
                    ]}
                    rows={insights.seasons.map((point) => [
                      seasonLabel(point.season, point.year, locale, t),
                      takaFull(point.revenuePoisha, t),
                      takaFull(point.costPoisha, t),
                      kgCompact(point.producedKg, locale, t),
                    ])}
                  />
                }
              >
                <ColumnChart
                  series={[
                    { label: say('আয়', 'Income'), slot: 'a' },
                    { label: say('খরচ', 'Cost'), slot: 'b' },
                  ]}
                  data={insights.seasons.map((point) => ({
                    label: seasonLabel(point.season, point.year, locale, t),
                    values: [chartTaka(point.revenuePoisha), chartTaka(point.costPoisha)],
                    display: [takaFull(point.revenuePoisha, t), takaFull(point.costPoisha, t)],
                  }))}
                  format={(value) => takaTick(value, locale, t)}
                  formatTick={(value) => takaTick(value, locale, t)}
                />
              </ChartCard>
            </div>
          ) : null}

          {hasSales ? (
            <ChartCard
              title={say('লাঙ্গলে বিক্রি', 'Sales on Langgol')}
              subtitle={say(
                'গত ছয় মাসে কমিশনের পরে আপনার হাতে আসা টাকা।',
                'What reached you after commission, last six months.',
              )}
              tableLabel={say('টেবিল হিসেবে দেখুন', 'Show as table')}
              table={
                <DataTable
                  columns={[say('মাস', 'Month'), say('অর্ডার', 'Orders'), say('আয়', 'Received')]}
                  rows={insights.salesByMonth.map((month) => [
                    monthLabel(month.key, locale),
                    count(month.orders, t),
                    takaFull(month.netPoisha, t),
                  ])}
                />
              }
            >
              <ColumnChart
                series={[{ label: say('আয়', 'Received'), slot: 'brand' }]}
                data={insights.salesByMonth.map((month) => ({
                  label: monthLabel(month.key, locale),
                  values: [chartTaka(month.netPoisha)],
                  display: [takaFull(month.netPoisha, t)],
                }))}
                format={(value) => takaTick(value, locale, t)}
                formatTick={(value) => takaTick(value, locale, t)}
              />
            </ChartCard>
          ) : null}

          {cropSegments.length > 0 ? (
            <ChartCard
              title={say('আপনি কী ফলান', 'What you grow')}
              subtitle={say(
                'সব মৌসুমের মোট ফসল, ওজন অনুযায়ী।',
                'All recorded harvests, by weight.',
              )}
            >
              <SplitBar
                segments={cropSegments}
                format={(value, share) =>
                  `${kgCompact(value, locale, t)} · ${t.digits(String(Math.round(share * 100)))}%`
                }
              />
            </ChartCard>
          ) : null}

          {insights.listings.length > 0 ? (
            <ChartCard
              title={say('বিক্রির জন্য মজুত', 'Stock on sale')}
              subtitle={say(
                'প্রতিটি তালিকায় এখনও কতটা বাকি।',
                'How much of each listing is left.',
              )}
            >
              <div className="lg-stack">
                {insights.listings.map((listing) => (
                  <Meter
                    key={listing.nameEn}
                    label={`${locale === 'bn' ? listing.nameBn : listing.nameEn} · ${takaCompact(
                      listing.pricePoisha,
                      locale,
                      t,
                    )}/${say('কেজি', 'kg')}`}
                    value={listing.availableKg}
                    max={listing.totalKg}
                    caption={`${kgCompact(listing.availableKg, locale, t)} / ${kgCompact(
                      listing.totalKg,
                      locale,
                      t,
                    )}`}
                  />
                ))}
              </div>
            </ChartCard>
          ) : null}
        </div>
      ) : (
        <Card>
          <h2 className="lg-title">
            {say('এখনও কোনো ফসলের হিসাব নেই', 'No harvests recorded yet')}
          </h2>
          <p className="lg-subtitle">
            {say(
              'জমি যোগ করে মৌসুমের ফসল লিখে রাখুন। তখন এখানে আপনার আয়, খরচ আর ফসলের ছবি দেখা যাবে।',
              'Add a farm and record a season’s harvest. Your income, costs and crops will be drawn here.',
            )}
          </p>
          <LinkButton href="/farmer/farms">{t.t('farm.myFarms')}</LinkButton>
        </Card>
      )}

      <Card>
        <h2 className="lg-title">{say('আপনার সেটআপ', 'Your setup')}</h2>

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
    </div>
  )
}
