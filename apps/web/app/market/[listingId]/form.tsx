/**
 * Quote and checkout form.
 *
 * Two steps in one component: ask for a delivered price, then confirm it. The second step submits
 * a **quote id** and nothing else — no price, no total, no seller. The amounts rendered here come
 * straight from the server's breakdown, formatted but never recomputed.
 *
 * Money arrives as decimal strings because `bigint` has no JSON representation and `Number()`
 * loses precision above 2^53. It is formatted for display and never parsed into arithmetic.
 *
 * Refs: docs/04_MARKETPLACE.md §6, §8; docs/06_FINANCIAL_ARCHITECTURE.md §2
 */

'use client'

import { useActionState } from 'react'
import { Alert, Button, Card, FormField, Input } from '@langgol/ui/components'
import { toBanglaDigits } from '@langgol/domain'
import {
  placeOrderAction,
  requestQuoteAction,
  type CheckoutFormState,
  type QuoteFormState,
} from '../actions'

interface Labels {
  readonly quantityLabel: string
  readonly getPrice: string
  readonly delivery: string
  readonly pickup: string
  readonly kg: string
  readonly breakdownTitle: string
  readonly product: string
  readonly deliveryLine: string
  readonly handling: string
  readonly platformFee: string
  readonly total: string
  readonly perKgDelivered: string
  readonly whyThisPrice: string
  readonly noHiddenCharges: string
  readonly placeOrder: string
  readonly placing: string
  readonly payWith: string
  readonly cashOnDelivery: string
  readonly unexpected: string
  readonly errors: Readonly<Record<string, string>>
}

interface BuyerBreakdown {
  readonly buyer: {
    readonly subtotalPoisha: string
    readonly deliveryFeePoisha: string
    readonly handlingFeePoisha: string
    readonly platformFeePoisha: string
    readonly buyerTotalPoisha: string
    readonly deliveredPricePerKgPoisha: string | null
  }
  readonly distanceMeters: number
  readonly fulfilmentMode: string
}

/** Format a poisha string for display. String arithmetic only — no float ever touches money. */
function formatPoisha(poisha: string, locale: string): string {
  const negative = poisha.startsWith('-')
  const digits = negative ? poisha.slice(1) : poisha
  const padded = digits.padStart(3, '0')
  const whole = padded.slice(0, -2)
  const fraction = padded.slice(-2)

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const rendered = `৳${negative ? '-' : ''}${grouped}.${fraction}`
  return locale === 'bn' ? toBanglaDigits(rendered) : rendered
}

const QUOTE_INITIAL: QuoteFormState = { status: 'idle' }
const CHECKOUT_INITIAL: CheckoutFormState = { status: 'idle' }

export function QuoteForm({
  listingId,
  offersPickup,
  locale,
  labels,
}: {
  readonly listingId: string
  readonly offersPickup: boolean
  readonly locale: string
  readonly labels: Labels
}) {
  const [quoteState, requestQuote, quotePending] = useActionState(requestQuoteAction, QUOTE_INITIAL)
  const [checkoutState, placeOrder, orderPending] = useActionState(
    placeOrderAction,
    CHECKOUT_INITIAL,
  )

  const breakdown = quoteState.breakdown as BuyerBreakdown | undefined

  return (
    <>
      <Card>
        <form action={requestQuote} className="lg-stack">
          <input type="hidden" name="listingId" value={listingId} />

          <FormField id="quantityKg" label={labels.quantityLabel} hint={labels.kg}>
            {({ describedBy, invalid }) => (
              <Input
                id="quantityKg"
                name="quantityKg"
                inputMode="decimal"
                defaultValue="5"
                required
                describedBy={describedBy}
                invalid={invalid}
              />
            )}
          </FormField>

          <FormField id="fulfilmentMode" label={labels.delivery}>
            {({ describedBy }) => (
              <select
                id="fulfilmentMode"
                name="fulfilmentMode"
                className="lg-input"
                aria-describedby={describedBy}
              >
                <option value="LANGGOL_DELIVERY">{labels.delivery}</option>
                {offersPickup ? <option value="BUYER_PICKUP">{labels.pickup}</option> : null}
              </select>
            )}
          </FormField>

          <Button type="submit" disabled={quotePending}>
            {labels.getPrice}
          </Button>
        </form>

        {quoteState.status === 'error' ? (
          <Alert tone="warning">{quoteState.message ?? labels.unexpected}</Alert>
        ) : null}
      </Card>

      {breakdown ? (
        <Card>
          <h2 className="lg-title">{labels.breakdownTitle}</h2>

          <table className="lg-breakdown">
            <tbody>
              <tr>
                <th scope="row">{labels.product}</th>
                <td>{formatPoisha(breakdown.buyer.subtotalPoisha, locale)}</td>
              </tr>
              <tr>
                <th scope="row">
                  {labels.deliveryLine}
                  {breakdown.distanceMeters > 0 ? (
                    <span className="lg-subtitle">
                      {' · '}
                      {locale === 'bn'
                        ? toBanglaDigits(String(Math.round(breakdown.distanceMeters / 100) / 10))
                        : String(Math.round(breakdown.distanceMeters / 100) / 10)}{' '}
                      km
                    </span>
                  ) : null}
                </th>
                <td>{formatPoisha(breakdown.buyer.deliveryFeePoisha, locale)}</td>
              </tr>
              <tr>
                <th scope="row">{labels.handling}</th>
                <td>{formatPoisha(breakdown.buyer.handlingFeePoisha, locale)}</td>
              </tr>
              <tr>
                <th scope="row">{labels.platformFee}</th>
                <td>{formatPoisha(breakdown.buyer.platformFeePoisha, locale)}</td>
              </tr>
              <tr className="lg-breakdown-total">
                <th scope="row">{labels.total}</th>
                <td>
                  <strong>{formatPoisha(breakdown.buyer.buyerTotalPoisha, locale)}</strong>
                </td>
              </tr>
              {breakdown.buyer.deliveredPricePerKgPoisha !== null ? (
                <tr>
                  <th scope="row">{labels.perKgDelivered}</th>
                  <td>{formatPoisha(breakdown.buyer.deliveredPricePerKgPoisha, locale)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>

          <p className="lg-subtitle">{labels.noHiddenCharges}</p>

          <form action={placeOrder}>
            <input type="hidden" name="quoteId" value={quoteState.quoteId ?? ''} />
            <p className="lg-subtitle">
              {labels.payWith}: {labels.cashOnDelivery}
            </p>
            <Button type="submit" disabled={orderPending}>
              {orderPending ? labels.placing : labels.placeOrder}
            </Button>
          </form>

          {checkoutState.status === 'error' ? (
            <Alert tone="warning">
              {labels.errors[checkoutState.reason ?? ''] ?? labels.unexpected}
            </Alert>
          ) : null}
        </Card>
      ) : null}
    </>
  )
}
