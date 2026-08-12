/**
 * Order confirmation.
 *
 * Shows the buyer what they committed to, from the **order** record rather than the quote — the
 * order is the thing that exists now, and its money was copied from the quote at checkout.
 *
 * Scoped to the buyer in the query: someone else's order id is not found, not forbidden.
 *
 * Refs: docs/05_ORDER_SYSTEM.md §4; docs/07_SECURITY.md §4.4
 */

import { notFound, redirect } from 'next/navigation'
import { prisma } from '@langgol/db'
import { Alert, Card, LinkButton } from '@langgol/ui/components'
import { createTranslator } from '@langgol/i18n'
import { getLocale } from '@/lib/locale'
import { getSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  const locale = await getLocale()
  const t = createTranslator(locale)
  const session = await getSession()

  if (session === null) redirect('/auth')

  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerUserId: session.userId },
    select: {
      orderNumber: true,
      status: true,
      subtotalPoisha: true,
      deliveryFeePoisha: true,
      handlingFeePoisha: true,
      platformFeePoisha: true,
      buyerTotalPoisha: true,
      acceptanceDeadline: true,
      deliveryAddressLine: true,
      deliveryRecipientName: true,
      distanceMeters: true,
      items: {
        select: {
          productNameEn: true,
          productNameBn: true,
          grade: true,
          farmName: true,
          quantityBase: true,
          unitPricePoisha: true,
        },
      },
    },
  })

  if (!order) notFound()

  const item = order.items[0]
  const productName =
    item === undefined ? '' : locale === 'bn' ? item.productNameBn : item.productNameEn
  const quantityKg = item === undefined ? 0n : item.quantityBase / 1000000n

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('marketplace.checkoutAccepted')}</h1>
        <p className="lg-subtitle">
          {t.t('marketplace.checkoutOrderNumber', { number: order.orderNumber })}
        </p>

        <Alert tone="info">
          {t.t('marketplace.checkoutAwaitingFarmer', {
            time: t.formatDateTime(order.acceptanceDeadline),
          })}
        </Alert>
      </Card>

      <Card>
        <h2 className="lg-title">
          {productName}
          {item ? ` · ${item.grade}` : ''}
        </h2>
        <p className="lg-subtitle">
          {item ? t.t('marketplace.from', { farm: item.farmName }) : ''} ·{' '}
          {t.digits(quantityKg.toString())} {t.t('units.kg')}
        </p>

        <table className="lg-breakdown">
          <tbody>
            <tr>
              <th scope="row">{t.t('marketplace.breakdownProduct')}</th>
              <td>{t.formatMoney(order.subtotalPoisha as never)}</td>
            </tr>
            <tr>
              <th scope="row">{t.t('marketplace.breakdownDelivery')}</th>
              <td>{t.formatMoney(order.deliveryFeePoisha as never)}</td>
            </tr>
            <tr>
              <th scope="row">{t.t('marketplace.breakdownHandling')}</th>
              <td>{t.formatMoney(order.handlingFeePoisha as never)}</td>
            </tr>
            <tr>
              <th scope="row">{t.t('marketplace.breakdownPlatformFee')}</th>
              <td>{t.formatMoney(order.platformFeePoisha as never)}</td>
            </tr>
            <tr className="lg-breakdown-total">
              <th scope="row">{t.t('marketplace.breakdownTotal')}</th>
              <td>
                <strong>{t.formatMoney(order.buyerTotalPoisha as never)}</strong>
              </td>
            </tr>
          </tbody>
        </table>

        {order.deliveryAddressLine ? (
          <p className="lg-subtitle">
            {t.t('marketplace.checkoutDeliverTo')}: {order.deliveryRecipientName} ·{' '}
            {order.deliveryAddressLine}
          </p>
        ) : null}
      </Card>

      <Card>
        <LinkButton href="/market">{t.t('marketplace.title')}</LinkButton>
      </Card>
    </div>
  )
}
