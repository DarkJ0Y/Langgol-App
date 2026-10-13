/**
 * One listing: ask for a delivered price, see the full breakdown, order it.
 *
 * The breakdown shown here is the one the server computed and stored on the quote. The page does
 * not add, subtract or re-derive a single figure — if it did, the number on screen could differ
 * from the number in the order, which is exactly the class of bug the quote exists to prevent.
 *
 * Refs: docs/04_MARKETPLACE.md §6, §8; docs/P2_DELIVERED_COST.md §2
 */

import { notFound } from 'next/navigation'
import { prisma } from '@langgol/db'
import { Card, LinkButton } from '@langgol/ui/components'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { QuoteForm } from './form'

export const dynamic = 'force-dynamic'

export default async function ListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params
  const locale = await getLocale()
  const t = createTranslator(locale)
  const session = await getSession()

  const listing = await prisma.listing.findFirst({
    where: { id: listingId, status: 'PUBLISHED', deletedAt: null },
    select: {
      id: true,
      title: true,
      grade: true,
      unitPricePoisha: true,
      quantityAvailableBase: true,
      minOrderBase: true,
      offersPickup: true,
      harvestedAt: true,
      product: { select: { nameEn: true, nameBn: true } },
      farm: { select: { name: true, villageOrArea: true } },
    },
  })

  if (!listing) notFound()

  const name = locale === 'bn' ? listing.product.nameBn : listing.product.nameEn
  const availableKg = listing.quantityAvailableBase / 1000000n

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">
          {name} · {listing.grade}
        </h1>
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
        </p>
      </Card>

      {session === null ? (
        <Card>
          {/* Why, not how: the how depends on AUTH_MODE, and /auth knows which one is active. */}
          <p className="lg-subtitle">{t.t('marketplace.guestQuote')}</p>
          <LinkButton href="/auth">{t.t('auth.signInTitle')}</LinkButton>
        </Card>
      ) : (
        <QuoteForm
          listingId={listing.id}
          offersPickup={listing.offersPickup}
          locale={locale}
          labels={{
            quantityLabel: t.t('marketplace.quantityLabel'),
            getPrice: t.t('marketplace.getPrice'),
            delivery: t.t('marketplace.delivery'),
            pickup: t.t('marketplace.pickup'),
            kg: t.t('units.kg'),
            breakdownTitle: t.t('marketplace.breakdownTitle'),
            product: t.t('marketplace.breakdownProduct'),
            deliveryLine: t.t('marketplace.breakdownDelivery'),
            handling: t.t('marketplace.breakdownHandling'),
            platformFee: t.t('marketplace.breakdownPlatformFee'),
            total: t.t('marketplace.breakdownTotal'),
            perKgDelivered: t.t('marketplace.breakdownPerKgDelivered'),
            whyThisPrice: t.t('marketplace.breakdownWhyThisPrice'),
            noHiddenCharges: t.t('marketplace.breakdownNoHiddenCharges'),
            placeOrder: t.t('marketplace.checkoutPlaceOrder'),
            placing: t.t('marketplace.checkoutPlacing'),
            payWith: t.t('marketplace.checkoutPayWith'),
            cashOnDelivery: t.t('marketplace.checkoutCashOnDelivery'),
            unexpected: t.t('errors.unexpected'),
            errors: {
              QUOTE_EXPIRED: t.t('marketplace.errorQuoteExpired'),
              QUOTE_ALREADY_USED: t.t('marketplace.errorQuoteAlreadyUsed'),
              QUOTE_NOT_FOUND: t.t('marketplace.errorQuoteNotFound'),
              LISTING_CHANGED: t.t('marketplace.errorListingChanged'),
              LISTING_UNAVAILABLE: t.t('marketplace.errorListingUnavailable'),
              INSUFFICIENT_INVENTORY: t.t('marketplace.errorInsufficientInventory'),
              quantity: t.t('marketplace.errorQuantity'),
            },
          }}
        />
      )}
    </div>
  )
}
