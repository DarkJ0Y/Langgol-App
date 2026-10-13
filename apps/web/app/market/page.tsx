/**
 * The buyer's marketplace.
 *
 * Shows what is available, and — crucially — shows nothing that implies a delivered price until
 * the server has computed one. A listing card carries the farm-gate price only, labelled as such,
 * because the whole point of Langgol is that farm-gate price is not what the buyer pays.
 *
 * The visual language follows the Modal.com reference: a near-black ground, one accent, tabular
 * figures, and almost no ornament. That suits these screens specifically — a produce listing is a
 * price and a provenance, and both should be legible at a glance in daylight.
 *
 * Refs: docs/04_MARKETPLACE.md §6, §10
 */

import Link from 'next/link'
import { prisma } from '@langgol/db'
import { createTranslator } from '@langgol/i18n'
import { checkFirebase } from '@langgol/infrastructure'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

const KG = 1000000n

export default async function MarketPage() {
  const locale = await getLocale()
  const t = createTranslator(locale)
  const session = await getSession()

  const [listings, farmerCount, firebase] = await Promise.all([
    prisma.listing.findMany({
      where: { status: 'PUBLISHED', deletedAt: null, availableTo: { gte: new Date() } },
      orderBy: [{ publishedAt: 'desc' }],
      take: 24,
      select: {
        id: true,
        grade: true,
        unitPricePoisha: true,
        quantityAvailableBase: true,
        harvestedAt: true,
        allowsPartialFill: true,
        product: { select: { nameEn: true, nameBn: true } },
        farm: { select: { name: true, villageOrArea: true } },
      },
    }),
    prisma.farmerProfile.count({ where: { verificationStatus: 'VERIFIED' } }),
    // Reported, not assumed: the check makes a real network call. A dashboard that says
    // "connected" because a config parsed is worse than no dashboard.
    checkFirebase(),
  ])

  return (
    <div className="lg-stack">
      <section className="lg-hero">
        <p className="lg-hero__eyebrow">
          <span className="lg-hero__dot" aria-hidden="true" />
          {locale === 'bn' ? 'সরাসরি কৃষকের কাছ থেকে' : 'Direct from the farm'}
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

      {/* Live service status. Honest about what is connected and what is not. */}
      <div className="lg-status">
        <span className="lg-status__item">
          <span className="lg-status__led lg-status__led--on" aria-hidden="true" />
          PostgreSQL
          <span className="lg-status__value">
            {locale === 'bn' ? 'হিসাবের উৎস' : 'system of record'}
          </span>
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
        <span className="lg-status__item">
          {locale === 'bn' ? 'যাচাই করা কৃষক' : 'verified farmers'}
          <span className="lg-status__value">{t.digits(farmerCount)}</span>
        </span>
        <span className="lg-status__item">
          {locale === 'bn' ? 'তালিকা' : 'listings'}
          <span className="lg-status__value">{t.digits(listings.length)}</span>
        </span>
      </div>

      {listings.length === 0 ? (
        <p className="lg-subtitle">{t.t('empty.nothingYet')}</p>
      ) : (
        <div className="lg-grid lg-grid--2 lg-grid--3">
          {listings.map((listing) => {
            const name = locale === 'bn' ? listing.product.nameBn : listing.product.nameEn
            const availableKg = listing.quantityAvailableBase / KG
            const harvestedToday =
              listing.harvestedAt !== null &&
              Date.now() - listing.harvestedAt.getTime() < 24 * 60 * 60 * 1000

            return (
              <article className="lg-listing" key={listing.id}>
                <div className="lg-listing__head">
                  <h2 className="lg-listing__name">{name}</h2>
                  <span className="lg-chip">{listing.grade}</span>
                </div>

                <p className="lg-listing__farm">
                  {t.t('marketplace.from', { farm: listing.farm.name })}
                  {listing.farm.villageOrArea ? ` · ${listing.farm.villageOrArea}` : ''}
                </p>

                <p className="lg-listing__price">
                  {t.formatMoney(listing.unitPricePoisha as never)}{' '}
                  <span className="lg-listing__unit">{t.t('marketplace.perKg')}</span>
                </p>

                <div className="lg-chip-row">
                  {harvestedToday ? (
                    <span className="lg-chip lg-chip--accent">
                      {t.t('marketplace.harvestedToday')}
                    </span>
                  ) : null}
                  <span className="lg-chip">
                    {t.t('marketplace.available', {
                      quantity: `${t.digits(availableKg.toString())} ${t.t('units.kg')}`,
                    })}
                  </span>
                  {listing.allowsPartialFill ? (
                    <span className="lg-chip">
                      {locale === 'bn' ? 'অংশ নেওয়া যাবে' : 'partial fill'}
                    </span>
                  ) : null}
                </div>

                <Link href={`/market/${listing.id}`} className="lg-button lg-button--primary">
                  {t.t('marketplace.getPrice')}
                </Link>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
