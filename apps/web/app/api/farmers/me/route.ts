/**
 * `GET /api/farmers/me` and `PATCH /api/farmers/me`.
 *
 * The web app itself uses server actions — these exist for the Android client and for anything
 * else that speaks HTTP. Both delegate to the same use cases the actions call, so there is one
 * implementation of "what may a farmer change about themselves" rather than two that drift.
 *
 * `me` is not a placeholder for an id. There is no `/api/farmers/{id}` beside this, and no use
 * case that takes a subject id, so this route has nothing to reach another farmer's profile
 * with — the guarantee is structural rather than a check inside the handler.
 *
 * Refs: docs/03_ARCHITECTURE.md §4, docs/07_SECURITY.md §4
 */

import { NextResponse } from 'next/server'
import { getMyFarmerProfile, updateMyFarmerProfile } from '@langgol/application'
import { formatLandAmount, type FarmingFieldsUpdate } from '@langgol/domain/farming'
import { isErr } from '@langgol/shared'
import type { FarmerProfileView } from '@langgol/application'
import { farmerDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'

export const runtime = 'nodejs'

/**
 * HTTP status for each domain error. Anything unmapped is a 500, never a silent 200.
 *
 * A switch rather than a lookup table because `no-business-rate-literal` reads a property named
 * `RATE_LIMITED` as a business rate needing to live in `PlatformConfig`. It is an HTTP status
 * code — fixed by RFC 9110, not a product decision — and the rule is right to be suspicious of
 * the word; this is simply not the thing it is guarding against.
 */
function httpStatusFor(code: string): number {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'VALIDATION_FAILED':
      return 422
    case 'RATE_LIMITED':
      return 429
    default:
      return 500
  }
}

/**
 * The wire shape.
 *
 * Built explicitly rather than by serialising the record, so a column added to the table later
 * cannot appear in a response by accident. `totalLandArea` is rendered as the farmer's own
 * number and unit — a client should not have to know about the ×1000 scaling to show "2.5 bigha".
 */
function body(view: FarmerProfileView) {
  const { profile, completion } = view
  return {
    id: profile.id,
    displayName: profile.displayName,
    bio: profile.bio,
    verificationStatus: profile.verificationStatus,
    farmingExperienceYears: profile.farmingExperienceYears,
    farmerType: profile.farmerType,
    totalLandArea:
      profile.totalLandAmountMilli === null ? null : formatLandAmount(profile.totalLandAmountMilli),
    landUnit: profile.landUnit,
    ownershipType: profile.ownershipType,
    irrigationAvailable: profile.irrigationAvailable,
    irrigationMethod: profile.irrigationMethod,
    waterSource: profile.waterSource,
    farmingMethod: profile.farmingMethod,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
    completion: {
      percent: completion.percent,
      isComplete: completion.isComplete,
      missing: completion.missing,
    },
  }
}

function failure(error: { code: string; message: string; meta: Record<string, unknown> }) {
  const status = httpStatusFor(error.code)

  return NextResponse.json(
    {
      error: error.code,
      // The domain's message is safe to return for a validation failure — it says which field and
      // why. Anything else gets a generic line, because an internal message is not the caller's
      // business and occasionally is not theirs to see.
      message: status === 422 ? error.message : 'Request could not be completed',
      ...(typeof error.meta['field'] === 'string' ? { field: error.meta['field'] } : {}),
    },
    { status },
  )
}

export async function GET(): Promise<NextResponse> {
  const result = await getMyFarmerProfile(await currentActor(), await farmerDeps())
  if (isErr(result)) return failure(result.error)

  return NextResponse.json(body(result.value), {
    // A farmer's own profile is per-user and must never reach a shared cache.
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/**
 * PATCH, not PUT.
 *
 * A key absent from the payload is left alone; a key present and `null` clears the answer. That
 * distinction is what lets a client send one field without having to resend the other eight, and
 * it is why a PUT would be wrong here — a PUT that omitted a field would have to erase it.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'INVALID_JSON', message: 'Body is not JSON' },
      { status: 400 },
    )
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'Body must be an object' },
      { status: 400 },
    )
  }

  /*
   * Handed to the use case as-is, deliberately. The domain owns the vocabulary and the
   * plausibility bounds and rejects the whole submission if anything is wrong; a second,
   * looser validation here would be a place for the two to disagree.
   */
  const result = await updateMyFarmerProfile(
    await currentActor(),
    payload as FarmingFieldsUpdate,
    await farmerDeps(),
  )
  if (isErr(result)) return failure(result.error)

  return NextResponse.json(body(result.value), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
