/**
 * Browsing the administrative tree.
 *
 * The picker walks one level at a time. Loading ~4,500 unions so a farmer can choose one is a
 * payload nobody on a metered connection should pay for, and the hierarchical path has to be a
 * complete way to give an address — not a fallback that loses features when the map does not
 * load. docs/08_BANGLADESH_CONTEXT.md §2
 *
 * Reference geography is not secret, but it is only offered to signed-in callers: an open
 * endpoint that enumerates the tree is a free scraping target with no upside.
 */

import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import { childLevelOf, type AreaLevel } from '@langgol/domain/location'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type { AdminAreaRecord, AdminAreaRepository } from '../../ports/index.js'

export interface AreaDeps {
  readonly areas: AdminAreaRepository
}

export interface AreaChildrenResult {
  readonly parentId: string | null
  /** The level of the returned nodes, so the UI can label the select without guessing. */
  readonly level: AreaLevel | null
  readonly areas: readonly AdminAreaRecord[]
  /** The level a caller should ask for next, or null at the bottom of the tree. */
  readonly nextLevel: AreaLevel | null
}

/**
 * Children of an area, or the eight divisions when `parentId` is null.
 *
 * `level` is derived from what came back rather than from what was asked for, so a caller that
 * passes a stale id gets an empty list instead of a mislabelled one.
 */
export async function listAreaChildren(
  actor: MaybeActor,
  parentId: string | null,
  deps: AreaDeps,
): Promise<Result<AreaChildrenResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'address:create')) return err(Errors.forbidden())

  const areas = await deps.areas.listChildren(parentId)
  const level = areas[0]?.level ?? null

  return ok({
    parentId,
    level,
    areas,
    nextLevel: level === null ? null : childLevelOf(level),
  })
}

/** Root-to-node chain, coarse first, for rendering a saved address or rehydrating the picker. */
export async function resolveAreaPath(
  actor: MaybeActor,
  areaId: string,
  deps: AreaDeps,
): Promise<Result<readonly AdminAreaRecord[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'address:create')) return err(Errors.forbidden())

  const path = await deps.areas.resolvePath(areaId)
  if (path.length === 0) return err(Errors.notFound('Area'))
  return ok(path)
}
