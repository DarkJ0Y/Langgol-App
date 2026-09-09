/**
 * Prisma-backed agricultural identity.
 *
 * ## Every query names its columns
 *
 * There is not one `select: undefined` in this file. The tables read here hold a phone number, an
 * address, farm coordinates, an encrypted identity number and every revenue figure a farmer has
 * recorded, and the default selection is all of them. Naming columns is what makes the disclosure
 * rule structural rather than a promise: the application layer is handed counts, bands and
 * district names because there was never anything else in the result.
 *
 * ## The aggregates are computed in SQL where it matters
 *
 * Production is grouped in the database rather than fetched and reduced here. Not for speed — for
 * containment. Pulling every production row to count seasons would mean holding every price and
 * every quantity in memory in the module whose job is to disclose nothing.
 *
 * Refs: docs/07_SECURITY.md §7
 */

import { prisma } from '@langgol/db'
import { landBandFor, type AgriFarmSummary } from '@langgol/domain/agri-identity'
import { userFacingStatus, type VerificationStatus } from '@langgol/domain/kyc'
import { isLandUnit, toDecimals } from '@langgol/domain/farming'
import type { AgriIdentityRepository, AgriProfileSourceData } from '@langgol/application'

/**
 * Land in decimals, whatever unit the farmer entered it in.
 *
 * The stored pair is an amount in thousandths plus a unit, never normalised away — a farmer who
 * said "two bighas" should still see two bighas. The band needs one scale, so the domain's own
 * conversion is reused here and the result is immediately coarsened into a band, which is the
 * only form that ever leaves this module.
 */
function landDecimals(amountMilli: number | null, unit: string | null): number | null {
  if (amountMilli === null || unit === null || !isLandUnit(unit)) return null
  return toDecimals(amountMilli, unit)
}

export const agriIdentityRepository: AgriIdentityRepository = {
  async findAgriId(userId) {
    const row = await prisma.agriIdentity.findUnique({
      where: { userId },
      select: { agriId: true },
    })
    return row?.agriId ?? null
  },

  /**
   * Claim a candidate, or report that it is taken.
   *
   * The `create` is attempted directly rather than preceded by a lookup: the UNIQUE constraint is
   * the only participant that can arbitrate a race, and a check-then-insert would hand out the
   * same identifier to two people submitting at the same moment.
   *
   * A user who already holds one gets theirs back. Issuing a second would orphan every document
   * carrying the first, which is the kind of damage that cannot be undone once a certificate has
   * been printed.
   */
  async issueAgriId(userId, candidate, now) {
    const existing = await prisma.agriIdentity.findUnique({
      where: { userId },
      select: { agriId: true },
    })
    if (existing !== null) return existing.agriId

    try {
      const created = await prisma.agriIdentity.create({
        data: { userId, agriId: candidate, updatedAt: now, issuedAt: now },
        select: { agriId: true },
      })
      return created.agriId
    } catch {
      /*
       * A unique violation on either column. Null tells the caller to retry with fresh randomness;
       * distinguishing "this code is taken" from "this user raced themselves" would be a
       * distinction with no different action behind it.
       */
      return null
    }
  },

  async profileSources(userId): Promise<AgriProfileSourceData | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      /*
       * Two columns out of a table that also holds a phone number, an email address, a date of
       * birth and a gender. None of those has any business in a profile meant to be shown.
       *
       * `status` is deliberately not among them: whether the account is active was already
       * settled by the policy layer, which denies a suspended actor before this is reached, and
       * selecting a column this module has no use for would weaken the rule it is built on.
       */
      select: { fullName: true, createdAt: true },
    })
    if (user === null) return null

    const [roles, verifications, farmerProfile, farms, addresses] = await Promise.all([
      prisma.userRoleAssignment.findMany({
        // Live roles only. A revoked role must not still appear on a card somebody is showing.
        where: { userId, revokedAt: null },
        select: { role: true },
      }),
      prisma.verification.findMany({
        where: { userId },
        select: { type: true, status: true },
      }),
      prisma.farmerProfile.findUnique({
        where: { userId },
        select: {
          farmingExperienceYears: true,
          totalLandAmountMilli: true,
          landUnit: true,
          irrigationAvailable: true,
          farmingMethod: true,
          verificationStatus: true,
          id: true,
        },
      }),
      prisma.farm.findMany({
        // Farms hang off the farmer profile, so ownership travels through it — the same condition
        // the farm repository compiles into every one of its queries.
        where: { farmer: { userId }, deletedAt: null },
        // The admin area, and only to walk up to a district. Never the coordinates, never the
        // address line, never the village.
        select: {
          id: true,
          adminAreaId: true,
          _count: { select: { plots: { where: { deletedAt: null } } } },
        },
      }),
      prisma.address.findMany({
        where: { userId, deletedAt: null },
        select: { adminAreaId: true, isDefault: true },
        orderBy: { isDefault: 'desc' },
        take: 1,
      }),
    ])

    /* ------------------------------------------------------------- location */

    /*
     * District and division, walked up from whichever area the person has already given.
     *
     * A farm's area is preferred over an address because it is where they work rather than where
     * they sleep, and the profile is about the former. Nothing below district is read: a union
     * plus a name identifies a household in rural Bangladesh.
     */
    const anchorAreaId = farms[0]?.adminAreaId ?? addresses[0]?.adminAreaId ?? null
    let location: AgriProfileSourceData['location'] = null

    if (anchorAreaId !== null) {
      const chain: { type: string; nameEn: string }[] = []
      let cursor: string | null = anchorAreaId

      // Four levels at most — DIVISION, DISTRICT, UPAZILA, UNION — so the walk is bounded by the
      // hierarchy rather than by a guard.
      for (let step = 0; step < 4 && cursor !== null; step += 1) {
        const area: { type: string; nameEn: string; parentId: string | null } | null =
          await prisma.adminArea.findUnique({
            where: { id: cursor },
            select: { type: true, nameEn: true, parentId: true },
          })
        if (area === null) break
        chain.push({ type: area.type, nameEn: area.nameEn })
        cursor = area.parentId
      }

      location = {
        district: chain.find((entry) => entry.type === 'DISTRICT')?.nameEn ?? null,
        division: chain.find((entry) => entry.type === 'DIVISION')?.nameEn ?? null,
      }
    }

    /* ----------------------------------------------------------------- farm */

    const farm: AgriFarmSummary | null =
      farmerProfile === null && farms.length === 0
        ? null
        : {
            farmCount: farms.length,
            plotCount: farms.reduce((total: number, entry) => total + entry._count.plots, 0),
            // Banded here and never carried as a number past this line.
            landBand: landBandFor(
              landDecimals(
                farmerProfile?.totalLandAmountMilli ?? null,
                farmerProfile?.landUnit ?? null,
              ),
            ),
            irrigationAvailable: farmerProfile?.irrigationAvailable ?? null,
            farmingMethod: farmerProfile?.farmingMethod ?? null,
            experienceYears: farmerProfile?.farmingExperienceYears ?? null,
          }

    /* ----------------------------------------------------------- production */

    let production: AgriProfileSourceData['production'] = null

    if (farmerProfile !== null) {
      /*
       * Grouped in SQL. Fetching the rows to count them here would mean holding every selling
       * price and every quantity in the one module whose job is to disclose none of it.
       */
      const grouped = await prisma.production.groupBy({
        by: ['year', 'season'],
        where: { farmerProfileId: farmerProfile.id },
        _count: { _all: true },
      })

      if (grouped.length > 0) {
        const years = new Set(
          grouped.map((entry) => entry.year).filter((year): year is number => year !== null),
        )

        const crops = await prisma.production.findMany({
          where: { farmerProfileId: farmerProfile.id, productId: { not: null } },
          // The crop's NAME. Not the quantity, not the price, not the revenue.
          select: { product: { select: { nameEn: true } } },
          distinct: ['productId'],
          take: 20,
        })

        production = {
          seasonsRecorded: grouped.length,
          yearsRecorded: years.size,
          crops: crops
            .map((entry) => entry.product?.nameEn)
            .filter((name): name is string => typeof name === 'string')
            .sort(),
          latestYear: years.size === 0 ? null : Math.max(...years),
        }
      }
    }

    /* ------------------------------------------------------------- business */

    /*
     * A trading name, which is public by nature — it is painted on the shopfront. Never the trade
     * licence, the TIN or the BIN, which are the documents behind it.
     */
    const [retailer, wholesaler, supplier, logistics] = await Promise.all([
      prisma.retailerProfile.findUnique({
        where: { userId },
        select: { businessName: true, verificationStatus: true },
      }),
      prisma.wholesalerProfile.findUnique({
        where: { userId },
        select: {
          businessName: true,
          verificationStatus: true,
          _count: { select: { serviceArea: true } },
        },
      }),
      prisma.supplierProfile.findUnique({
        where: { userId },
        select: {
          companyName: true,
          verificationStatus: true,
          _count: { select: { serviceArea: true } },
        },
      }),
      prisma.logisticsProviderProfile.findUnique({
        where: { userId },
        select: {
          companyName: true,
          verificationStatus: true,
          _count: { select: { serviceArea: true } },
        },
      }),
    ])

    const business: AgriProfileSourceData['business'] =
      retailer !== null
        ? {
            role: 'RETAILER',
            businessName: retailer.businessName,
            verified: retailer.verificationStatus === 'VERIFIED',
            serviceAreaCount: 0,
          }
        : wholesaler !== null
          ? {
              role: 'WHOLESALER',
              businessName: wholesaler.businessName,
              verified: wholesaler.verificationStatus === 'VERIFIED',
              serviceAreaCount: wholesaler._count.serviceArea,
            }
          : supplier !== null
            ? {
                role: 'SUPPLIER',
                businessName: supplier.companyName,
                verified: supplier.verificationStatus === 'VERIFIED',
                serviceAreaCount: supplier._count.serviceArea,
              }
            : logistics !== null
              ? {
                  role: 'LOGISTICS_PROVIDER',
                  businessName: logistics.companyName,
                  verified: logistics.verificationStatus === 'VERIFIED',
                  serviceAreaCount: logistics._count.serviceArea,
                }
              : null

    return {
      displayName: user.fullName,
      memberSince: user.createdAt,
      roles: roles.map((entry) => ({
        role: entry.role,
        // A role is "verified" when its own profile has been. Never how it was proven.
        verified:
          entry.role === 'FARMER'
            ? farmerProfile?.verificationStatus === 'VERIFIED'
            : business?.role === entry.role && business.verified,
      })),
      verifications: verifications.map((entry) => ({
        type: entry.type,
        // The subject-facing word, so no caller has to know the internal states exist.
        status: userFacingStatus(entry.status as VerificationStatus),
      })),
      location,
      farm,
      production,
      business,
    }
  },
}
