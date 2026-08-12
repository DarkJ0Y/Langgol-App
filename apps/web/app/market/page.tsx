/**
 * The buyer's marketplace.
 *
 * Shows what is available, and — crucially — shows nothing that implies a delivered price until
 * the server has computed one. A listing card carries the farm-gate price only, labelled as such,
 * because the whole point of Langgol is that farm-gate price is not what the buyer pays.
 *
 * Refs: docs/04_MARKETPLACE.md §6, §10
 */

import Link from 'next/link'
import { prisma } from '@langgol/db'
import { Card, LinkButton } from '@langgol/ui/components'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function MarketPage() {
  const locale = await getLocale()
  const t = createTranslator(locale)
  const session = await getSession()

  const listings = await prisma.listing.findMany({
    where: { status: 'PUBLISHED', deletedAt: null, availableTo: { gte: new Date() } },
    orderBy: [{ publishedAt: 'desc' }],
    take: 24,
    select: {
      id: true,
      title: true,
      grade: true,
      unitPricePoisha: true,
      quantityAvailableBase: true,
      saleUnit: true,
      harvestedAt: true,
      product: { select: { nameEn: true, nameBn: true } },
      farm: { select: { name: true, villageOrArea: true } },
    },
  })

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('marketplace.title')}</h1>
        <p className="lg-subtitle">{t.t('marketplace.subtitle')}</p>
        {session === null ? <LinkButton href="/auth">{t.t('auth.signInTitle')}</LinkButton> : null}
      </Card>

      {listings.length === 0 ? (
        <Card>
          <p className="lg-subtitle">{t.t('empty.nothingYet')}</p>
        </Card>
      ) : null}

      {listings.map((listing) => {
        const name = locale === 'bn' ? listing.product.nameBn : listing.product.nameEn
        const availableKg = listing.quantityAvailableBase / 1000000n
        const harvestedToday =
          listing.harvestedAt !== null &&
          Date.now() - listing.harvestedAt.getTime() < 24 * 60 * 60 * 1000

        return (
          <Card key={listing.id}>
            <h2 className="lg-title">
              {name} · {listing.grade}
            </h2>
            <p className="lg-subtitle">
              {t.t('marketplace.from', { farm: listing.farm.name })}
              {listing.farm.villageOrArea ? ` · ${listing.farm.villageOrArea}` : ''}
            </p>

            <p>
              <strong>{t.formatMoney(listing.unitPricePoisha as never)}</strong>{' '}
              <span className="lg-subtitle">{t.t('marketplace.perKg')}</span>
            </p>

            <p className="lg-subtitle">
              {t.t('marketplace.available', {
                quantity: `${t.digits(availableKg.toString())} ${t.t('units.kg')}`,
              })}
              {harvestedToday ? ` · ${t.t('marketplace.harvestedToday')}` : ''}
            </p>

            <Link href={`/market/${listing.id}`} className="lg-button">
              {t.t('marketplace.getPrice')}
            </Link>
          </Card>
        )
      })}
    </div>
  )
}
