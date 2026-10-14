/**
 * What the public landing page needs from the database: real counts for the numbers strip, and
 * the crops and districts actually on sale today for the "what do you need?" form.
 *
 * Real numbers rather than marketing ones. A landing page that says "10,000 farmers" when there
 * are seven is a promise the product breaks on the next screen; this one says seven.
 *
 * Public data only: counts and names, never a person, a price history or an address.
 */

import 'server-only'
import { prisma } from '@langgol/db'

export interface LandingData {
  readonly counts: {
    readonly farmers: number
    readonly listings: number
    readonly crops: number
    readonly districts: number
    readonly delivered: number
  }
  readonly crops: { readonly slug: string; readonly nameEn: string; readonly nameBn: string }[]
  readonly districts: { readonly id: string; readonly nameEn: string; readonly nameBn: string }[]
}

export async function landingData(): Promise<LandingData> {
  const live = { status: 'PUBLISHED', deletedAt: null, availableTo: { gte: new Date() } } as const

  const [farmers, listings, delivered] = await Promise.all([
    prisma.farmerProfile.count({ where: { verificationStatus: 'VERIFIED' } }),
    prisma.listing.findMany({
      where: live,
      select: {
        product: { select: { slug: true, nameEn: true, nameBn: true } },
        area: { select: { id: true, nameEn: true, nameBn: true } },
      },
    }),
    prisma.order.count({ where: { status: { in: ['DELIVERED', 'COMPLETED'] } } }),
  ])

  const crops = new Map(listings.map((row) => [row.product.slug, row.product]))
  const districts = new Map(listings.map((row) => [row.area.id, row.area]))

  return {
    counts: {
      farmers,
      listings: listings.length,
      crops: crops.size,
      districts: districts.size,
      delivered,
    },
    crops: [...crops.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
    districts: [...districts.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
  }
}
