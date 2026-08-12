/**
 * Marketplace server actions.
 *
 * The form posts a listing id, a quantity and a fulfilment mode. It does **not** post a price,
 * and there is no code path here that would read one. Every amount the buyer sees comes back from
 * the server-computed quote.
 *
 * Refs: docs/04_MARKETPLACE.md §8; docs/07_SECURITY.md §5
 */

'use server'

import { redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { checkout, createQuote } from '@langgol/application'
import { marketplaceDeps } from '@/lib/deps'
import { getSession } from '@/lib/session'

export interface QuoteFormState {
  readonly status: 'idle' | 'quoted' | 'error'
  readonly quoteId?: string
  readonly message?: string
  /** Serialised buyer-facing breakdown. Never carries platform or farmer economics. */
  readonly breakdown?: unknown
  readonly expiresAt?: string
}

/**
 * Quantity is entered in kilograms and converted to base units (milligrams) here.
 *
 * Parsed from a string, never from a float: `parseFloat('0.1') * 1e6` is not 100000.
 */
function kilogramsToBase(input: string): bigint | null {
  const cleaned = input.trim()
  if (!/^\d+(\.\d{1,3})?$/.test(cleaned)) return null

  const [whole, fraction = ''] = cleaned.split('.')
  const milli = (fraction + '000').slice(0, 3)
  const grams = BigInt(whole ?? '0') * 1000n + BigInt(milli)
  return grams * 1000n
}

export async function requestQuoteAction(
  _previous: QuoteFormState,
  formData: FormData,
): Promise<QuoteFormState> {
  const session = await getSession()
  if (session === null) redirect('/auth')

  const listingId = String(formData.get('listingId') ?? '')
  const quantityKg = String(formData.get('quantityKg') ?? '')
  const fulfilmentMode = String(formData.get('fulfilmentMode') ?? 'LANGGOL_DELIVERY')

  const quantityBase = kilogramsToBase(quantityKg)
  if (quantityBase === null || quantityBase <= 0n) {
    return { status: 'error', message: 'quantity' }
  }

  const deps = await marketplaceDeps()
  const addressId = await defaultAddressId(session.userId)

  const result = await createQuote(
    {
      buyerUserId: session.userId,
      listingId,
      quantityBase,
      fulfilmentMode: fulfilmentMode === 'BUYER_PICKUP' ? 'BUYER_PICKUP' : 'LANGGOL_DELIVERY',
      deliveryAddressId: addressId,
      paymentMethod: 'CASH_ON_DELIVERY',
    },
    deps,
  )

  if (!result.ok) {
    return {
      status: 'error',
      message: result.error.userFacing ? result.error.message : 'unexpected',
    }
  }

  return {
    status: 'quoted',
    quoteId: result.value.quoteId,
    breakdown: result.value.breakdown,
    expiresAt: result.value.expiresAt.toISOString(),
  }
}

export interface CheckoutFormState {
  readonly status: 'idle' | 'error'
  /** A typed reason code the UI renders from the catalogue, never a raw server string. */
  readonly reason?: string
  readonly replacementQuoteId?: string
}

export async function placeOrderAction(
  _previous: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const session = await getSession()
  if (session === null) redirect('/auth')

  const quoteId = String(formData.get('quoteId') ?? '')
  // Generated server-side per submission. A client-supplied key would let a caller collide with
  // someone else's request. docs/06 §7
  const idempotencyKey = randomUUID()

  const deps = await marketplaceDeps()
  const result = await checkout(
    {
      buyerUserId: session.userId,
      buyerSegment: session.roles.includes('RETAILER') ? 'RETAILER' : 'CONSUMER',
      quoteId,
      idempotencyKey,
      paymentMethod: 'CASH_ON_DELIVERY',
    },
    deps,
  )

  if (!result.ok) {
    const error = result.error
    if ('reason' in error) {
      return {
        status: 'error',
        reason: error.reason,
        ...(error.replacementQuote ? { replacementQuoteId: error.replacementQuote.quoteId } : {}),
      }
    }
    return { status: 'error', reason: 'unexpected' }
  }

  redirect(`/orders/${result.value.order.id}`)
}

/** The buyer's default delivery address, resolved server-side. */
async function defaultAddressId(userId: string): Promise<string | null> {
  const { prisma } = await import('@langgol/db')
  const address = await prisma.address.findFirst({
    where: { userId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  return address?.id ?? null
}
