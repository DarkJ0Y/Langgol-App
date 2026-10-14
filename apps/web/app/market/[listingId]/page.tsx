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
import * as Money from '@langgol/domain/money'
import { BarList, Card, ChartCard, LinkButton, Meter } from '@langgol/ui/components'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'
import { produceMark, produceTone } from '@/lib/produce'
import { chartTaka, kgCompact } from '@/lib/viz-format'
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
      quantityTotalBase: true,
      minOrderBase: true,
      offersPickup: true,
      harvestedAt: true,
      productId: true,
      product: {
        select: { slug: true, nameEn: true, nameBn: true, category: { select: { slug: true } } },
      },
      farm: { select: { name: true, villageOrArea: true } },
      area: { select: { nameEn: true, nameBn: true } },
    },
  })

  if (!listing) notFound()

  const say = (bn: string, en: string) => (locale === 'bn' ? bn : en)
  const name = locale === 'bn' ? listing.product.nameBn : listing.product.nameEn
  const availableKg = listing.quantityAvailableBase / 1000000n
  const kgOf = (base: bigint) => Number(base / 1000n) / 1000

  // Everyone else selling the same crop right now, at the farm gate. This farmer's bar keeps the
  // colour and the rest go grey: the question is "is THIS a good price?", not "who sells what".
  const others = await prisma.listing.findMany({
    where: {
      productId: listing.productId,
      status: 'PUBLISHED',
      deletedAt: null,
      availableTo: { gte: new Date() },
    },
    select: { id: true, unitPricePoisha: true, farm: { select: { name: true } } },
    orderBy: { unitPricePoisha: 'asc' },
    take: 8,
  })

  return (
    <div className="lg-stack">
      <section className="lg-listing-hero">
        <div
          className={`lg-produce lg-produce--hero lg-produce--${produceTone(listing.product.category?.slug)}`}
          aria-hidden="true"
        >
          {produceMark(listing.product.slug)}
        </div>
        <div className="lg-listing-hero__facts">
          <h1 className="lg-dash__title">
            {name}{' '}
            <span className="lg-chip">
              {say('গ্রেড', 'Grade')} {listing.grade}
            </span>
          </h1>
          <p className="lg-subtitle">
            {t.t('marketplace.from', { farm: listing.farm.name })}
            {listing.farm.villageOrArea ? ` · ${listing.farm.villageOrArea}` : ''} ·{' '}
            {locale === 'bn' ? listing.area.nameBn : listing.area.nameEn}
          </p>
          <p className="lg-produce-card__price">
            {t.formatMoney(Money.fromPoisha(listing.unitPricePoisha))}
            <span>
              {' '}
              {t.t('marketplace.perKg')} · {say('খামারের দাম', 'farm-gate')}
            </span>
          </p>
          <Meter
            label={say('বিক্রির জন্য বাকি', 'Left to sell')}
            value={kgOf(listing.quantityAvailableBase)}
            max={kgOf(listing.quantityTotalBase)}
            caption={`${kgCompact(kgOf(listing.quantityAvailableBase), locale, t)} / ${kgCompact(
              kgOf(listing.quantityTotalBase),
              locale,
              t,
            )}`}
          />
          {listing.harvestedAt === null ? null : (
            <p className="lg-hint">
              🌿 {say('তোলা হয়েছে', 'Harvested')} {t.formatDate(listing.harvestedAt)}
            </p>
          )}
          <p className="lg-hint">
            {t.t('marketplace.available', {
              quantity: `${t.digits(availableKg.toString())} ${t.t('units.kg')}`,
            })}
          </p>
        </div>
      </section>

      {others.length > 1 ? (
        <ChartCard
          title={say(`অন্য কৃষকের ${name}র দাম`, `${name} from other farmers`)}
          subtitle={say(
            'প্রতি কেজি, খামারের দাম। এই তালিকাটি রঙে, বাকিগুলো ধূসরে।',
            'Per kg at the farm gate. This listing in colour, the rest in grey.',
          )}
        >
          <BarList
            items={others.map((other) => {
              const amount = Money.fromPoisha(other.unitPricePoisha)
              return {
                label: other.farm.name,
                value: chartTaka(amount),
                display: t.formatMoney(amount),
                highlight: other.id === listing.id,
              }
            })}
            format={(value) => String(value)}
          />
        </ChartCard>
      ) : null}

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
