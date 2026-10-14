/**
 * The buyer's marketplace.
 *
 * Shows what is available, and — crucially — shows nothing that implies a delivered price until
 * the server has computed one. A listing card carries the farm-gate price only, labelled as such,
 * because the whole point of Langgol is that farm-gate price is not what the buyer pays. The
 * price chart below follows the same rule: it compares FARM-GATE prices, and says so.
 *
 * Visual: each listing is a card a buyer can read without reading — the produce pictured, the
 * price large, how much is left as a meter, how fresh as a chip. A row of category pills filters
 * the grid server-side (a link per category, so it works with no JavaScript).
 *
 * Refs: docs/04_MARKETPLACE.md §6, §10
 */

import Link from 'next/link'
import { prisma } from '@langgol/db'
import * as Money from '@langgol/domain/money'
import { createTranslator } from '@langgol/i18n'
import { checkFirebase } from '@langgol/infrastructure'
import { env } from '@langgol/shared'
import { BarList, ChartCard, StatRow, StatTile } from '@langgol/ui/components'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { produceMark, produceTone } from '@/lib/produce'
import { chartTaka, count, kgCompact } from '@/lib/viz-format'

export const dynamic = 'force-dynamic'

const KG = 1000000n

const CATEGORIES = [
  { slug: 'vegetables', bn: 'সবজি', en: 'Vegetables' },
  { slug: 'fruit', bn: 'ফল', en: 'Fruit' },
  { slug: 'grain', bn: 'শস্য', en: 'Grain' },
] as const

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const locale = await getLocale()
  const t = createTranslator(locale)
  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)
  const session = await getSession()

  // Only a known category filters; anything else in the URL shows everything.
  const requested = (await searchParams).c
  const category = CATEGORIES.find((candidate) => candidate.slug === requested)

  const live = { status: 'PUBLISHED', deletedAt: null, availableTo: { gte: new Date() } } as const

  const [listings, farmerCount, allLive] = await Promise.all([
    prisma.listing.findMany({
      where: {
        ...live,
        ...(category === undefined ? {} : { product: { category: { slug: category.slug } } }),
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: 24,
      select: {
        id: true,
        grade: true,
        unitPricePoisha: true,
        quantityAvailableBase: true,
        quantityTotalBase: true,
        harvestedAt: true,
        allowsPartialFill: true,
        product: {
          select: { slug: true, nameEn: true, nameBn: true, category: { select: { slug: true } } },
        },
        farm: { select: { name: true, villageOrArea: true } },
        area: { select: { nameEn: true, nameBn: true } },
      },
    }),
    prisma.farmerProfile.count({ where: { verificationStatus: 'VERIFIED' } }),
    // Every live listing, unfiltered, for the price comparison and the headline counts.
    prisma.listing.findMany({
      where: live,
      select: {
        unitPricePoisha: true,
        adminAreaId: true,
        product: { select: { slug: true, nameEn: true, nameBn: true } },
      },
    }),
  ])

  // The lowest farm-gate price per crop today. Lowest, because that is the question a buyer
  // brings: "what is the least I could pay at the farm gate for this?"
  const lowest = new Map<
    string,
    { label: string; price: (typeof allLive)[number]['unitPricePoisha'] }
  >()
  for (const row of allLive) {
    const previous = lowest.get(row.product.slug)
    if (previous === undefined || row.unitPricePoisha < previous.price) {
      lowest.set(row.product.slug, {
        label: `${produceMark(row.product.slug)} ${locale === 'bn' ? row.product.nameBn : row.product.nameEn}`,
        price: row.unitPricePoisha,
      })
    }
  }
  const priceBars = [...lowest.values()]
    .map((entry) => ({ ...entry, amount: Money.fromPoisha(entry.price) }))
    .sort((a, b) => Money.compare(a.amount, b.amount))
    .map((entry) => ({
      label: entry.label,
      value: chartTaka(entry.amount),
      display: `${t.formatMoney(entry.amount)}/${say('কেজি', 'kg')}`,
    }))

  const districts = new Set(allLive.map((row) => row.adminAreaId)).size
  const showDiagnostics = env().APP_ENV === 'development'
  const firebase = showDiagnostics ? await checkFirebase() : null

  return (
    <div className="lg-dash">
      <section className="lg-hero">
        <p className="lg-hero__eyebrow">
          <span className="lg-hero__dot" aria-hidden="true" />
          {say('সরাসরি কৃষকের কাছ থেকে', 'Direct from the farm')}
        </p>
        <h1 className="lg-hero__title">{t.t('marketplace.title')}</h1>
        <p className="lg-hero__lede">{t.t('marketplace.subtitle')}</p>
        {/*
          A guest is browsing on purpose — they chose it on the landing page — so this says what
          they can do rather than blocking the page with a sign-in button. "Log in" is in the
          header on every screen, and a listing asks for it at the moment a quote needs it.
        */}
        {session === null ? <p className="lg-hint">{t.t('home.guestHint')}</p> : null}
      </section>

      <StatRow>
        <StatTile label={say('চালু তালিকা', 'Live listings')} value={count(allLive.length, t)} />
        <StatTile label={say('যাচাই করা কৃষক', 'Verified farmers')} value={count(farmerCount, t)} />
        <StatTile label={say('ফসলের ধরন', 'Crops on sale')} value={count(lowest.size, t)} />
        <StatTile label={say('জেলা', 'Districts')} value={count(districts, t)} />
      </StatRow>

      {/* Category filter: plain links, so it works before (and without) any JavaScript. */}
      <nav className="lg-pills" aria-label={say('ধরন অনুযায়ী দেখুন', 'Filter by kind')}>
        <Link
          href="/market"
          className="lg-pill"
          aria-current={category === undefined ? 'page' : undefined}
        >
          🧺 {say('সব', 'All')}
        </Link>
        {CATEGORIES.map((candidate) => (
          <Link
            key={candidate.slug}
            href={`/market?c=${candidate.slug}`}
            className="lg-pill"
            aria-current={category?.slug === candidate.slug ? 'page' : undefined}
          >
            {candidate.slug === 'vegetables' ? '🥬' : candidate.slug === 'fruit' ? '🥭' : '🌾'}{' '}
            {say(candidate.bn, candidate.en)}
          </Link>
        ))}
      </nav>

      <div className="lg-market">
        <div className="lg-market__grid">
          {listings.length === 0 ? (
            <p className="lg-subtitle">{t.t('empty.nothingYet')}</p>
          ) : (
            listings.map((listing) => {
              const name = locale === 'bn' ? listing.product.nameBn : listing.product.nameEn
              const availableKg = Number(listing.quantityAvailableBase / 1000n) / 1000
              const totalKg = Number(listing.quantityTotalBase / 1000n) / 1000
              const left = totalKg > 0 ? availableKg / totalKg : 0
              const harvestedToday =
                listing.harvestedAt !== null &&
                Date.now() - listing.harvestedAt.getTime() < 24 * 60 * 60 * 1000
              const district = locale === 'bn' ? listing.area.nameBn : listing.area.nameEn

              return (
                <article className="lg-produce-card" key={listing.id}>
                  <div
                    className={`lg-produce lg-produce--${produceTone(listing.product.category?.slug)}`}
                    aria-hidden="true"
                  >
                    {produceMark(listing.product.slug)}
                  </div>

                  <div className="lg-produce-card__body">
                    <div className="lg-produce-card__head">
                      <h2 className="lg-produce-card__name">{name}</h2>
                      <span className="lg-chip">
                        {say('গ্রেড', 'Grade')} {listing.grade}
                      </span>
                    </div>
                    <p className="lg-produce-card__farm">
                      {listing.farm.name} · {district}
                    </p>

                    <p className="lg-produce-card__price">
                      {t.formatMoney(Money.fromPoisha(listing.unitPricePoisha))}
                      <span>
                        {' '}
                        {t.t('marketplace.perKg')} · {say('খামারের দাম', 'farm-gate')}
                      </span>
                    </p>

                    <div
                      className="lg-produce-card__stock"
                      role="meter"
                      aria-label={say('বাকি আছে', 'Left')}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(left * 100)}
                    >
                      <span style={{ width: `${String(Math.round(left * 100))}%` }} />
                    </div>
                    <p className="lg-produce-card__left">
                      {t.t('marketplace.available', {
                        quantity: `${t.digits((listing.quantityAvailableBase / KG).toString())} ${t.t('units.kg')}`,
                      })}
                    </p>

                    <div className="lg-chip-row">
                      {harvestedToday ? (
                        <span className="lg-chip lg-chip--accent">
                          🌿 {t.t('marketplace.harvestedToday')}
                        </span>
                      ) : null}
                      {listing.allowsPartialFill ? (
                        <span className="lg-chip">{say('অংশ নেওয়া যাবে', 'Partial fill')}</span>
                      ) : null}
                    </div>

                    <Link href={`/market/${listing.id}`} className="lg-button lg-button--primary">
                      {t.t('marketplace.getPrice')}
                    </Link>
                  </div>
                </article>
              )
            })
          )}
        </div>

        <aside className="lg-market__side">
          {priceBars.length > 0 ? (
            <ChartCard
              title={say('আজকের সবচেয়ে কম দাম', 'Lowest price today')}
              subtitle={say(
                'প্রতি কেজি, খামারের দাম। পৌঁছে দেওয়ার দাম আলাদা হিসাব হয়।',
                'Per kg at the farm gate. Your delivered price is worked out for your address.',
              )}
            >
              <BarList items={priceBars} format={(value) => kgCompact(value, locale, t)} />
            </ChartCard>
          ) : null}

          {/* Service status is an engineering diagnostic, shown only in development. */}
          {showDiagnostics && firebase !== null ? (
            <div className="lg-status">
              <span className="lg-status__item">
                <span className="lg-status__led lg-status__led--on" aria-hidden="true" />
                PostgreSQL
                <span className="lg-status__value">{say('হিসাবের উৎস', 'system of record')}</span>
              </span>
              <span className="lg-status__item">
                <span
                  className={`lg-status__led ${firebase.reachable ? 'lg-status__led--on' : 'lg-status__led--off'}`}
                  aria-hidden="true"
                />
                Firebase
                <span className="lg-status__value">
                  {firebase.reachable ? (firebase.projectId ?? 'connected') : 'unavailable'}
                </span>
              </span>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  )
}
