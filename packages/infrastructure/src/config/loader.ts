/**
 * Loads platform configuration from the database into an immutable domain snapshot.
 *
 * For each key the highest version whose `effectiveFrom` has passed wins. Configuration rows are
 * append-only (enforced by database rule), so "the current value" is always the newest effective
 * version rather than an edited row.
 *
 * Refs: docs/03_ARCHITECTURE.md §7
 */

import { prisma } from '@langgol/db'
import { createConfigSnapshot, type ConfigEntry, type ConfigSnapshot } from '@langgol/domain/config'

/**
 * Cache lifetime — an infrastructure constant, not a business parameter.
 * Long enough that config is not a per-request query; short enough that a rate
 * change reaches every instance within a minute without a deploy. A rate change is a product
 * decision, and product decisions should not require an engineer.
 */
const CACHE_LIFETIME_MS = 60_000

interface CacheEntry {
  readonly snapshot: ConfigSnapshot
  readonly loadedAt: number
}

let cache: CacheEntry | undefined

export async function loadConfigSnapshot(now: Date = new Date()): Promise<ConfigSnapshot> {
  const rows = await prisma.platformConfig.findMany({
    where: { effectiveFrom: { lte: now } },
    orderBy: [{ key: 'asc' }, { version: 'desc' }],
    select: { key: true, version: true, value: true },
  })

  const latest = new Map<string, ConfigEntry>()
  for (const row of rows) {
    // Rows arrive newest-version-first per key, so the first sighting wins.
    if (!latest.has(row.key)) {
      latest.set(row.key, { key: row.key, version: row.version, value: row.value })
    }
  }

  return createConfigSnapshot([...latest.values()], now)
}

/** Cached accessor for request paths. */
export async function getConfig(now: Date = new Date()): Promise<ConfigSnapshot> {
  const age = cache === undefined ? Infinity : now.getTime() - cache.loadedAt
  if (cache !== undefined && age < CACHE_LIFETIME_MS) return cache.snapshot

  const snapshot = await loadConfigSnapshot(now)
  cache = { snapshot, loadedAt: now.getTime() }
  return snapshot
}

/** Drop the cache — after an admin writes a new version, and in tests. */
export function invalidateConfigCache(): void {
  cache = undefined
}
