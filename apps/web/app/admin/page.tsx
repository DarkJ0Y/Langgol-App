import { createTranslator, type MessageKey } from '@langgol/i18n'
import { ADMIN_PERMISSIONS } from '@langgol/domain/admin'
import {
  BarList,
  Card,
  ChartCard,
  ColumnChart,
  DataTable,
  StatRow,
  StatTile,
} from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { requirePermission } from '@/lib/guard'
import { platformInsights } from '@/lib/insights'
import {
  chartTaka,
  count,
  monthLabel,
  rolePlural,
  takaCompact,
  takaFull,
  takaTick,
  verificationLabel,
} from '@/lib/viz-format'

/**
 * The back office.
 *
 * ## Why this page renders for an administrator holding nothing
 *
 * `admin:access` is a plain role check, so somebody with the role and an empty permission set gets
 * in and is shown a list of what they cannot do. That is deliberate. The alternative — redirecting
 * them away — produces an operator who has been told they are an administrator, cannot open the
 * admin area, and has no way to find out why.
 *
 * ## The links are a courtesy, not a control
 *
 * A section is hidden when its permission is absent, and every page and every action behind it
 * checks the same permission again server-side. A hidden link is a tidy screen; it is not
 * security, and nothing here is treated as though it were.
 *
 * Refs: docs/07_SECURITY.md §4, §5
 */

interface Section {
  readonly permission: (typeof ADMIN_PERMISSIONS)[number]
  readonly href: string
  readonly titleKey: MessageKey
}

const SECTIONS: readonly Section[] = [
  { permission: 'USER_VIEW', href: '/admin/users', titleKey: 'admin.usersTitle' },
  { permission: 'KYC_VIEW', href: '/admin/kyc', titleKey: 'admin.kycTitle' },
  {
    permission: 'BUSINESS_REVIEW',
    href: '/admin/verification/BUSINESS',
    titleKey: 'admin.businessTitle',
  },
  { permission: 'FARM_REVIEW', href: '/admin/verification/FARM', titleKey: 'admin.farmTitle' },
  {
    permission: 'EXPERT_REVIEW',
    href: '/admin/verification/EXPERT',
    titleKey: 'admin.expertTitle',
  },
  { permission: 'AUDIT_VIEW', href: '/admin/audit', titleKey: 'admin.auditTitle' },
]

export default async function AdminHomePage() {
  // The door. Every section below re-checks its own permission, and so does every page behind it.
  const actor = await requirePermission('admin:access')
  const locale = await getLocale()
  const t = createTranslator(locale)
  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)

  // Platform-wide counts; reachable only past the `admin:access` check above. Development
  // fixtures are left out of the user counts, so the figures describe the people, not the tests.
  const platform = await platformInsights()

  const held = actor.permissions ?? []
  const available = SECTIONS.filter((section) => held.includes(section.permission))

  return (
    <div className="lg-dash">
      <header className="lg-dash__head">
        <div>
          <h1 className="lg-dash__title">{t.t('admin.title')}</h1>
          <p className="lg-dash__lede">{t.t('admin.subtitle')}</p>
        </div>
      </header>

      <StatRow>
        <StatTile label={say('ব্যবহারকারী', 'People')} value={count(platform.totals.users, t)} />
        <StatTile
          label={say('জমি · চালু তালিকা', 'Farms · live listings')}
          value={`${count(platform.totals.farms, t)} · ${count(platform.totals.liveListings, t)}`}
        />
        <StatTile
          label={say('অর্ডার', 'Orders')}
          value={count(platform.totals.orders, t)}
          hint={say(
            `${count(platform.totals.cancelled, t)}টি বাতিল`,
            `${String(platform.totals.cancelled)} cancelled`,
          )}
        />
        <StatTile
          label={say('মোট বিক্রি (GMV)', 'Sales value (GMV)')}
          value={takaCompact(platform.totals.gmvPoisha, locale, t)}
        />
        <StatTile
          label={say('লাঙ্গলের কমিশন', 'Langgol commission')}
          value={takaCompact(platform.totals.commissionPoisha, locale, t)}
        />
      </StatRow>

      <div className="lg-dash__grid">
        <div className="lg-dash__wide">
          <ChartCard
            title={say('মাস অনুযায়ী বিক্রি', 'Sales by month')}
            subtitle={say(
              'গত ছয় মাসে ক্রেতারা মোট যা দিয়েছেন। বাতিল অর্ডার বাদ।',
              'What buyers paid in total, last six months. Cancelled orders left out.',
            )}
            tableLabel={say('টেবিল হিসেবে দেখুন', 'Show as table')}
            table={
              <DataTable
                columns={[say('মাস', 'Month'), say('অর্ডার', 'Orders'), say('বিক্রি', 'Sales')]}
                rows={platform.ordersByMonth.map((month) => [
                  monthLabel(month.key, locale),
                  count(month.orders, t),
                  takaFull(month.gmvPoisha, t),
                ])}
              />
            }
          >
            <ColumnChart
              series={[{ label: say('বিক্রি', 'Sales'), slot: 'brand' }]}
              data={platform.ordersByMonth.map((month) => ({
                label: monthLabel(month.key, locale),
                values: [chartTaka(month.gmvPoisha)],
                display: [takaFull(month.gmvPoisha, t)],
              }))}
              format={(value) => takaTick(value, locale, t)}
              formatTick={(value) => takaTick(value, locale, t)}
            />
          </ChartCard>
        </div>

        <ChartCard
          title={say('ভূমিকা অনুযায়ী মানুষ', 'People by role')}
          subtitle={say('একজনের একাধিক ভূমিকা থাকতে পারে।', 'One person can hold several roles.')}
        >
          <BarList
            items={platform.usersByRole.map((row) => ({
              label: rolePlural(row.role, locale),
              value: row.count,
            }))}
            format={(value) => count(value, t)}
          />
        </ChartCard>

        {platform.verification.length > 0 ? (
          <ChartCard
            title={say('যাচাইয়ের অপেক্ষায়', 'Waiting for verification')}
            subtitle={say('ধরন অনুযায়ী অপেক্ষমাণ আবেদন।', 'Pending submissions, by type.')}
            tableLabel={say('টেবিল হিসেবে দেখুন', 'Show as table')}
            table={
              <DataTable
                columns={[
                  say('ধরন', 'Type'),
                  say('অপেক্ষায়', 'Pending'),
                  say('যাচাই হয়েছে', 'Verified'),
                ]}
                rows={platform.verification.map((row) => [
                  verificationLabel(row.type, locale),
                  count(row.pending, t),
                  count(row.verified, t),
                ])}
              />
            }
          >
            <BarList
              items={platform.verification.map((row) => ({
                label: verificationLabel(row.type, locale),
                value: row.pending,
              }))}
              format={(value) => count(value, t)}
            />
          </ChartCard>
        ) : null}
      </div>

      {available.length === 0 ? (
        <Card>
          {/*
           * Said plainly rather than shown as an empty page. An operator who has been told they
           * are an administrator and finds nothing here deserves to know that the account is
           * working and the permissions have not been granted yet.
           */}
          <h2 className="lg-title">{t.t('admin.noPermissionsTitle')}</h2>
          <p className="lg-subtitle">{t.t('admin.noPermissionsBody')}</p>
        </Card>
      ) : (
        <section className="lg-hub" aria-label={say('কাজের জায়গা', 'Work areas')}>
          <h2 className="lg-hub__title">{say('কাজের জায়গা', 'Work areas')}</h2>
          <div className="lg-hub__grid">
            {available.map((section) => (
              <a key={section.href} className="lg-hub__link" href={section.href}>
                <span className="lg-hub__link-title">{t.t(section.titleKey)}</span>
                <span className="lg-hub__link-body">{t.t('admin.open')}</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <Card>
        <h2 className="lg-title">{t.t('admin.yourPermissionsTitle')}</h2>
        <p className="lg-subtitle">{t.t('admin.yourPermissionsBody')}</p>
        <ul className="lg-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ADMIN_PERMISSIONS.map((permission) => (
            <li key={permission} className={held.includes(permission) ? '' : 'lg-hint'}>
              {t.t(`admin.permission${permission}` as MessageKey)}
              {' · '}
              {held.includes(permission) ? t.t('admin.granted') : t.t('admin.notGranted')}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
