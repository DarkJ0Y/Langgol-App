import * as Money from '@langgol/domain/money'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { FALLBACK_ORIGIN, homeOf, inBangladesh, nearestFarms, type Point } from '@/lib/nearby'
import { produceMark } from '@/lib/produce'
import { LocateButton } from './locate'
import { NearbyMap } from './map'

export const dynamic = 'force-dynamic'

/**
 * Farms near you: a map and a list, closest first.
 *
 * Where "you" are comes from, in order: a location just shared with "Use my location" (rounded to
 * about a kilometre, in the URL for this one search, never stored); otherwise the signed-in
 * person's own default address; otherwise Dhaka, and the page says so.
 *
 * Only farms are placed on the map. Buyers never are — see lib/nearby.ts.
 */
export default async function NearbyPage({
  searchParams,
}: {
  searchParams: Promise<{ lat?: string; lng?: string }>
}) {
  const locale = await getLocale()
  const t = createTranslator(locale)
  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)
  const session = await getSession()

  const params = await searchParams
  const shared: Point | null =
    params.lat !== undefined && params.lng !== undefined
      ? { lat: Number(params.lat), lng: Number(params.lng) }
      : null
  const sharedOk =
    shared !== null &&
    Number.isFinite(shared.lat) &&
    Number.isFinite(shared.lng) &&
    inBangladesh(shared)

  const home = !sharedOk && session !== null ? await homeOf(session.userId) : null
  const origin: Point = sharedOk && shared !== null ? shared : (home ?? FALLBACK_ORIGIN)
  const source: 'shared' | 'home' | 'fallback' = sharedOk
    ? 'shared'
    : home !== null
      ? 'home'
      : 'fallback'

  const farms = await nearestFarms(origin)

  const km = (value: number) =>
    value < 1
      ? say(
          `${t.digits(String(Math.round(value * 1000)))} মিটার`,
          `${String(Math.round(value * 1000))} m`,
        )
      : say(`${t.digits(value.toFixed(1))} কিমি`, `${value.toFixed(1)} km`)

  const originLabel =
    source === 'shared'
      ? say('আপনার অবস্থান', 'Your location')
      : source === 'home'
        ? say('আপনার ঠিকানা', 'Your address')
        : say('ঢাকা (অবস্থান দেওয়া হয়নি)', 'Dhaka (no location given)')

  return (
    <div className="lg-dash">
      <header className="lg-dash__head">
        <div>
          <h1 className="lg-dash__title">{say('কাছের খামার', 'Farms near you')}</h1>
          <p className="lg-dash__lede">
            {say(
              'আপনার সবচেয়ে কাছের কৃষক আর তাঁদের আজকের ফসল। কাছের খামার মানে কম পরিবহন খরচ।',
              'The farmers closest to you and what they have today. Closer farms mean lower delivery.',
            )}
          </p>
        </div>
        <LocateButton
          label={say('আমার অবস্থান ব্যবহার করুন', 'Use my location')}
          busyLabel={say('খোঁজা হচ্ছে…', 'Finding you…')}
          deniedLabel={say(
            'অবস্থান পাওয়া যায়নি। ব্রাউজারে অনুমতি দিন, অথবা ঠিকানা যোগ করুন।',
            'Could not get your location. Allow it in the browser, or add an address.',
          )}
        />
      </header>

      <p className="lg-hint">
        {say('এখান থেকে দূরত্ব:', 'Distances from:')} <strong>{originLabel}</strong>
        {source === 'fallback' && session !== null
          ? say(
              ' — ঠিকানা যোগ করলে আপনার জায়গা থেকে দেখাবে।',
              ' — add an address to measure from your place.',
            )
          : ''}
      </p>

      <div className="lg-nearby">
        <NearbyMap
          origin={origin}
          originLabel={originLabel}
          farms={farms.map((farm) => ({
            id: farm.farmId,
            name: farm.name,
            lat: farm.lat,
            lng: farm.lng,
            caption: `${km(farm.km)} · ${locale === 'bn' ? farm.districtBn : farm.districtEn}`,
            href: `/market/${farm.products[0]?.listingId ?? ''}`,
            linkLabel: say('ফসল দেখুন', 'See produce'),
          }))}
        />

        <ol className="lg-nearby__list">
          {farms.length === 0 ? (
            <li className="lg-subtitle">{t.t('empty.nothingYet')}</li>
          ) : (
            farms.map((farm, index) => (
              <li key={farm.farmId} className="lg-nearby__farm">
                <span className="lg-nearby__rank">{t.digits(String(index + 1))}</span>
                <div className="lg-nearby__body">
                  <div className="lg-nearby__head">
                    <h2 className="lg-nearby__name">{farm.name}</h2>
                    <span className="lg-nearby__km">{km(farm.km)}</span>
                  </div>
                  <p className="lg-rows__meta">
                    {locale === 'bn' ? farm.districtBn : farm.districtEn}
                  </p>
                  <div className="lg-chip-row">
                    {farm.products.slice(0, 4).map((product) => (
                      <a
                        key={product.listingId}
                        className="lg-chip"
                        href={`/market/${product.listingId}`}
                      >
                        {produceMark(product.slug)}{' '}
                        {locale === 'bn' ? product.nameBn : product.nameEn} ·{' '}
                        {t.formatMoney(Money.fromPoisha(product.pricePoisha))}
                      </a>
                    ))}
                  </div>
                </div>
              </li>
            ))
          )}
        </ol>
      </div>
    </div>
  )
}
