/**
 * Prisma-backed onboarding facts.
 *
 * Every fact is a boolean, and every query is written to settle one without loading the record it
 * is about. `hasFarm` is a count capped at one, not a list of farms; `hasLocation` is a count of
 * addresses, not an address. A dashboard that loaded somebody's farms in order to decide whether
 * to say "add a farm" would be doing considerable work to answer a yes-or-no question, and would
 * be holding a set of coordinates while it did.
 *
 * ## The current-crop question
 *
 * "Is something growing now?" has no clean answer in a table of harvest records, so it is read as
 * "is there a production record for this year or last?". Last year is included deliberately: in
 * February a farmer's most recent record is usually the Aman harvest from the previous calendar
 * year, and a checklist that told them to add a crop they had just recorded would be wrong in the
 * most annoying way.
 */

import { prisma } from '@langgol/db'
import type { OnboardingFacts } from '@langgol/domain/onboarding'
import type { OnboardingRepository } from '@langgol/application'

/** How far back a production record still counts as "current". See the note above. */
const CURRENT_CROP_YEARS = 1

export const onboardingRepository: OnboardingRepository = {
  async factsForUser(userId): Promise<OnboardingFacts | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, phoneVerifiedAt: true },
    })
    if (user === null) return null

    const farmerProfile = await prisma.farmerProfile.findUnique({
      where: { userId },
      select: { id: true },
    })

    const currentYear = new Date().getUTCFullYear()

    const [
      roles,
      addressCount,
      farmCount,
      cropCount,
      identity,
      retailer,
      wholesaler,
      supplier,
      expert,
      logistics,
      consumer,
    ] = await Promise.all([
      prisma.userRoleAssignment.findMany({
        // Live roles only. A revoked role must not keep its steps on somebody's checklist.
        where: { userId, revokedAt: null },
        select: { role: true },
      }),
      prisma.address.count({ where: { userId, deletedAt: null } }),
      farmerProfile === null
        ? Promise.resolve(0)
        : prisma.farm.count({ where: { farmerProfileId: farmerProfile.id, deletedAt: null } }),
      farmerProfile === null
        ? Promise.resolve(0)
        : prisma.production.count({
            where: {
              farmerProfileId: farmerProfile.id,
              year: { gte: currentYear - CURRENT_CROP_YEARS },
            },
          }),
      prisma.verification.findUnique({
        where: { userId_type: { userId, type: 'IDENTITY' } },
        select: { status: true },
      }),
      prisma.retailerProfile.findUnique({ where: { userId }, select: { businessName: true } }),
      prisma.wholesalerProfile.findUnique({ where: { userId }, select: { businessName: true } }),
      prisma.supplierProfile.findUnique({ where: { userId }, select: { companyName: true } }),
      prisma.agriculturalExpertProfile.findUnique({
        where: { userId },
        select: { qualification: true },
      }),
      prisma.logisticsProviderProfile.findUnique({
        where: { userId },
        select: { companyName: true },
      }),
      prisma.consumerProfile.findUnique({
        where: { userId },
        select: { purchaseFrequency: true },
      }),
    ])

    /*
     * A role profile is "started" once a row exists and "complete" once the field that role's
     * questionnaire actually requires has been answered.
     *
     * Rows are created on first read, so existence alone would mark everybody started the moment
     * they opened the page — which is why the two are distinguished by content rather than by
     * presence.
     */
    const roleProfileRow =
      retailer ?? wholesaler ?? supplier ?? expert ?? logistics ?? consumer ?? null

    const roleProfileComplete =
      (retailer?.businessName ?? '').trim() !== '' ||
      (wholesaler?.businessName ?? '').trim() !== '' ||
      (supplier?.companyName ?? '').trim() !== '' ||
      (expert?.qualification ?? '').trim() !== '' ||
      (logistics?.companyName ?? '').trim() !== '' ||
      (consumer?.purchaseFrequency ?? '').trim() !== ''

    const kycStatus: OnboardingFacts['kycStatus'] =
      identity === null
        ? 'NONE'
        : identity.status === 'VERIFIED'
          ? 'VERIFIED'
          : identity.status === 'REJECTED'
            ? 'REJECTED'
            : identity.status === 'PENDING' || identity.status === 'UNDER_REVIEW'
              ? 'PENDING'
              : 'NONE'

    /*
     * Returned without a cast, deliberately.
     *
     * An `as OnboardingFacts` here would let a stray or misspelled field through silently, which
     * is precisely the mistake this object is shaped to prevent. The compiler checking it is the
     * cheapest guard available.
     */
    const facts: OnboardingFacts = {
      // A name they gave, not the empty string a half-finished registration would leave.
      hasConfirmedName: user.fullName.trim() !== '',
      phoneVerified: user.phoneVerifiedAt !== null,
      roles: roles.map((entry) => entry.role),
      // An address OR a farm. Demanding the one they have not got is how a farmer with no postal
      // address gets stuck on a step they cannot complete.
      hasLocation: addressCount > 0 || farmCount > 0,
      hasFarm: farmCount > 0,
      hasCurrentCrop: cropCount > 0,
      roleProfileStarted: roleProfileRow !== null,
      roleProfileComplete,
      kycStatus,
    }

    return facts
  },

  async recordState(userId, state) {
    /*
     * `updateMany` rather than `update`, as everywhere else in this codebase: a miss affects zero
     * rows instead of throwing. A progress counter is the last thing that should be able to fail
     * the request that triggered it.
     */
    await prisma.user.updateMany({
      where: { id: userId },
      data: { onboardingStatus: state as never },
    })
  },
}
