/**
 * `GET /agri-profile/me` — the digital agricultural identity card.
 *
 * ## `me` is not a placeholder for an identifier
 *
 * There is no `/agri-profile/{agriId}` beside this, and no use case that takes a subject. That is
 * the point rather than an omission: an AGRI-ID is printed on certificates and delivery notes, so
 * it must never be sufficient to FETCH anything. Knowing somebody's identifier grants no more than
 * knowing their name does, and the guarantee is a route that does not exist rather than a check
 * inside one that does.
 *
 * ## The response is checked before it is sent
 *
 * The use case runs the disclosure tripwire over the assembled profile and refuses to return it if
 * anything private has reached it. This handler therefore has no scrubbing of its own — a second
 * opinion here would be a second place for the rule to drift, and the one that drifts is always
 * the one nobody was looking at.
 *
 * Refs: docs/03_ARCHITECTURE.md §4, docs/07_SECURITY.md §4, §7
 */

import { NextResponse } from 'next/server'
import { myAgriProfile } from '@langgol/application'
import { isErr } from '@langgol/shared'
import type { AgriProfile } from '@langgol/domain/agri-identity'
import { agriProfileDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'

export const runtime = 'nodejs'

function httpStatusFor(code: string): number {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    default:
      return 500
  }
}

/**
 * The wire shape.
 *
 * Written out field by field rather than serialising the profile object, for the same reason the
 * farmer route does it: a field added to the domain type later cannot appear in a response
 * because somebody forgot this file existed. Adding one here is a deliberate act.
 */
function body(profile: AgriProfile) {
  return {
    agriId: profile.agriId,
    displayName: profile.displayName,
    memberSince: profile.memberSince.toISOString(),
    roles: profile.roles.map((entry) => ({ role: entry.role, verified: entry.verified })),
    verification: profile.verifications.map((entry) => ({
      type: entry.type,
      status: entry.status,
    })),
    completion:
      profile.completion === null
        ? null
        : {
            percent: profile.completion.percent,
            answered: profile.completion.answered,
            total: profile.completion.total,
            missing: profile.completion.missing,
          },
    location:
      profile.location === null
        ? null
        : { district: profile.location.district, division: profile.location.division },
    farm:
      profile.farm === null
        ? null
        : {
            farmCount: profile.farm.farmCount,
            plotCount: profile.farm.plotCount,
            // A band. The exact area is deliberately not on the wire — see the note in
            // packages/domain/src/agri-identity/profile.ts.
            landBand: profile.farm.landBand,
            irrigationAvailable: profile.farm.irrigationAvailable,
            farmingMethod: profile.farm.farmingMethod,
            experienceYears: profile.farm.experienceYears,
          },
    production:
      profile.production === null
        ? null
        : {
            seasonsRecorded: profile.production.seasonsRecorded,
            yearsRecorded: profile.production.yearsRecorded,
            crops: profile.production.crops,
            latestYear: profile.production.latestYear,
          },
    business:
      profile.business === null
        ? null
        : {
            role: profile.business.role,
            businessName: profile.business.businessName,
            verified: profile.business.verified,
            serviceAreaCount: profile.business.serviceAreaCount,
          },
  }
}

export async function GET(): Promise<Response> {
  const actor = await currentActor()
  const result = await myAgriProfile(actor, await agriProfileDeps())

  if (isErr(result)) {
    return NextResponse.json(
      { error: result.error.code },
      {
        status: httpStatusFor(result.error.code),
        // A refusal must not be cached either: the reason can be that the session expired.
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }

  return NextResponse.json(body(result.value), {
    /*
     * Private and uncached.
     *
     * The card is per-user and carries a name and a district. A shared cache holding it would
     * serve one farmer's identity to the next request that looked similar enough, which is the
     * classic way a personalised response becomes a disclosure.
     */
    headers: { 'Cache-Control': 'no-store, private' },
  })
}
