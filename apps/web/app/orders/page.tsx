import { redirect } from 'next/navigation'
import { createTranslator } from '@langgol/i18n'
import {
  BarList,
  Card,
  ChartCard,
  ColumnChart,
  DataTable,
  LinkButton,
  StatRow,
  StatTile,
} from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { buyerInsights } from '@/lib/insights'
import {
  chartTaka,
  count,
  kgCompact,
  monthLabel,
  orderStatus,
  takaCompact,
  takaFull,
  takaTick,
} from '@/lib/viz-format'

/**
 * My orders: what I have bought, what is on its way, and what it has cost me.
 *
 * There was no list before this — a buyer could open an order only from the link checkout gave
 * them. Every figure is the signed-in person's own: `buyerInsights` is scoped by their user id,
 * which comes from the session and from nowhere the request controls.
 */
export default async function MyOrdersPage() {
  const session = await getSession()
  if (session === null) redirect('/auth')

  const locale = await getLocale()
  const t = createTranslator(locale)
  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)

  const insights = await buyerInsights(session.userId)
  const { totals } = insights
  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
      day: 'numeric',
      month: 'short',
    }).format(date)

  return (
    <div className="lg-dash">
      <header className="lg-dash__head">
        <div>
          <h1 className="lg-dash__title">{say('আমার অর্ডার', 'My orders')}</h1>
          <p className="lg-dash__lede">
            {say(
              'যা কিনেছেন, যা পথে আছে, আর কত খরচ হলো।',
              'What you bought, what is on its way, and what it cost.',
            )}
          </p>
        </div>
        <div className="lg-dash__actions">
          <LinkButton href="/market">{say('আরও কিনুন', 'Shop the market')}</LinkButton>
        </div>
      </header>

      {insights.recent.length === 0 ? (
        <Card>
          <h2 className="lg-title">{say('এখনও কোনো অর্ডার নেই', 'No orders yet')}</h2>
          <p className="lg-subtitle">
            {say(
              'বাজার থেকে কৃষকের তাজা ফসল কিনুন। আপনার অর্ডার আর খরচ এখানে ছবিতে দেখা যাবে।',
              'Buy fresh produce straight from farmers. Your orders and spending will be drawn here.',
            )}
          </p>
          <LinkButton href="/market">{say('বাজার দেখুন', 'Open the market')}</LinkButton>
        </Card>
      ) : (
        <>
          <StatRow>
            <StatTile
              label={say('মোট খরচ', 'Total spent')}
              value={takaCompact(totals.spentPoisha, locale, t)}
              hint={say(
                `${count(totals.orders, t)}টি অর্ডারে`,
                `across ${String(totals.orders)} orders`,
              )}
            />
            <StatTile
              label={say('চলমান অর্ডার', 'On their way')}
              value={count(totals.active, t)}
              hint={say('অপেক্ষায়, নিশ্চিত বা পথে', 'waiting, confirmed or in transit')}
            />
            <StatTile
              label={say('মোট কেনা', 'Produce bought')}
              value={kgCompact(totals.kg, locale, t)}
            />
            <StatTile
              label={say('ডেলিভারি খরচ', 'Paid for delivery')}
              value={takaCompact(totals.deliveryPoisha, locale, t)}
              hint={say('মোট খরচের অংশ', 'included in the total')}
            />
          </StatRow>

          <div className="lg-dash__grid">
            <div className="lg-dash__wide">
              <ChartCard
                title={say('মাস অনুযায়ী খরচ', 'Spending by month')}
                subtitle={say(
                  'গত ছয় মাস, ডেলিভারি সহ। বাতিল অর্ডার বাদ।',
                  'Last six months, delivery included. Cancelled orders left out.',
                )}
                tableLabel={say('টেবিল হিসেবে দেখুন', 'Show as table')}
                table={
                  <DataTable
                    columns={[say('মাস', 'Month'), say('অর্ডার', 'Orders'), say('খরচ', 'Spent')]}
                    rows={insights.spendByMonth.map((month) => [
                      monthLabel(month.key, locale),
                      count(month.orders, t),
                      takaFull(month.totalPoisha, t),
                    ])}
                  />
                }
              >
                <ColumnChart
                  series={[{ label: say('খরচ', 'Spent'), slot: 'brand' }]}
                  data={insights.spendByMonth.map((month) => ({
                    label: monthLabel(month.key, locale),
                    values: [chartTaka(month.totalPoisha)],
                    display: [takaFull(month.totalPoisha, t)],
                  }))}
                  format={(value) => takaTick(value, locale, t)}
                  formatTick={(value) => takaTick(value, locale, t)}
                />
              </ChartCard>
            </div>

            <ChartCard
              title={say('সবচেয়ে বেশি কেনা', 'What you buy most')}
              subtitle={say('ওজন অনুযায়ী।', 'By weight.')}
            >
              <BarList
                items={insights.topProducts.map((product) => ({
                  label: locale === 'bn' ? product.nameBn : product.nameEn,
                  value: product.kg,
                }))}
                format={(value) => kgCompact(value, locale, t)}
              />
            </ChartCard>

            <ChartCard
              title={say('অর্ডারের অবস্থা', 'Where your orders are')}
              subtitle={say('সব অর্ডার, অবস্থা অনুযায়ী।', 'Every order, by status.')}
            >
              <BarList
                items={insights.byStatus.map((row) => ({
                  label: orderStatus(row.status, locale).label,
                  value: row.count,
                }))}
                format={(value) => count(value, t)}
              />
            </ChartCard>

            <div className="lg-dash__wide">
              <ChartCard title={say('সাম্প্রতিক অর্ডার', 'Recent orders')}>
                <ul className="lg-rows">
                  {insights.recent.map((order) => {
                    const status = orderStatus(order.status, locale)
                    return (
                      <li key={order.id}>
                        <div className="lg-rows__main">
                          <a className="lg-rows__title" href={`/orders/${order.id}`}>
                            {locale === 'bn' ? order.itemsBn : order.items}
                          </a>
                          <span className="lg-rows__meta">
                            {order.orderNumber} · {order.farm} · {formatDate(order.placedAt)}
                          </span>
                        </div>
                        <span className={`lg-status-chip lg-status-chip--${status.tone}`}>
                          {status.label}
                        </span>
                        <span className="lg-rows__amount">{takaFull(order.totalPoisha, t)}</span>
                      </li>
                    )
                  })}
                </ul>
              </ChartCard>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
