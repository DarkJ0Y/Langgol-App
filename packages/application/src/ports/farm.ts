/**
 * Farms and plots.
 *
 * ## Every method takes the owner, and that is not decoration
 *
 * There is no `findById(farmId)` and no `findById(plotId)` on this port, deliberately. An id-only
 * lookup is one `req.params.id` away from returning another farmer's holding, and the reliable
 * way not to have that bug is not to have that method — a caller cannot forget to pass an owner
 * to a function that requires one.
 *
 * The adapter is expected to put the ownership condition **in the WHERE clause**, not to fetch
 * and then compare. That is layer three of the three-layer defence in docs/07_SECURITY.md §4: a
 * policy check can be forgotten by a future caller, a compiled-in query condition cannot. A miss
 * returns `null` or affects zero rows; it never returns somebody else's row for the use case to
 * screen out afterwards.
 *
 * Plots are reached **through** their farm, so a plot query carries the same ownership condition
 * one join further out. A plot id belonging to a stranger's farm resolves to nothing.
 */

import type { FarmFields, PlotFields } from '@langgol/domain/farming'

export interface Coordinates {
  readonly latitude: string
  readonly longitude: string
}

export interface FarmRecord extends FarmFields {
  readonly id: string
  readonly adminAreaId: string
  readonly addressId: string | null
  readonly villageOrArea: string | null
  readonly addressLine: string | null
  readonly latitude: string | null
  readonly longitude: string | null
  readonly verificationStatus: string
  readonly plotCount: number
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface PlotRecord extends PlotFields {
  readonly id: string
  readonly farmId: string
  readonly latitude: string | null
  readonly longitude: string | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface CreateFarmInput {
  readonly name: string
  readonly adminAreaId: string
  readonly villageOrArea?: string | null
  readonly addressLine?: string | null
  readonly addressId?: string | null
  readonly coordinates?: Coordinates | null
}

export interface CreatePlotInput {
  readonly name: string
  readonly coordinates?: Coordinates | null
}

export interface FarmRepository {
  /** This farmer's farms, newest first. Soft-deleted rows are excluded. */
  listForUser(userId: string): Promise<readonly FarmRecord[]>

  /** One farm, or null if it does not exist OR is not theirs — the caller cannot tell which. */
  findForUser(userId: string, farmId: string): Promise<FarmRecord | null>

  countForUser(userId: string): Promise<number>

  createForUser(userId: string, input: CreateFarmInput): Promise<FarmRecord>

  /** Applies validated changes. Returns null when the farm is not theirs. */
  updateForUser(
    userId: string,
    farmId: string,
    changes: Record<string, unknown>,
  ): Promise<FarmRecord | null>

  /** Soft delete — a farm may be referenced by listings and orders. */
  softDeleteForUser(userId: string, farmId: string): Promise<boolean>
}

export interface PlotRepository {
  /** Plots of one farm, scoped through the farm's owner. Empty when the farm is not theirs. */
  listForFarm(userId: string, farmId: string): Promise<readonly PlotRecord[]>

  findForUser(userId: string, plotId: string): Promise<PlotRecord | null>

  countForFarm(userId: string, farmId: string): Promise<number>

  createForUser(userId: string, farmId: string, input: CreatePlotInput): Promise<PlotRecord | null>

  updateForUser(
    userId: string,
    plotId: string,
    changes: Record<string, unknown>,
  ): Promise<PlotRecord | null>

  softDeleteForUser(userId: string, plotId: string): Promise<boolean>
}
