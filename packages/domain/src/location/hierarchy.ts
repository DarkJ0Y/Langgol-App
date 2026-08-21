/**
 * The administrative hierarchy, as pure structure.
 *
 * Division (8) → District (64) → Upazila (~495) → Union (~4,500). The tree itself lives in
 * `admin_areas` and is seeded reference data; this module holds the rules ABOUT the tree that
 * both the picker and the validators need, so neither reimplements them.
 *
 * The tree is deliberately not rooted at a country. Langgol serves Bangladesh, and adding a
 * country level would re-parent all eight divisions to buy nothing — an address carries its own
 * `countryCode` instead. If a second country is ever served, a root level is added here and the
 * levels below shift down by one, which is why callers ask `childLevelOf` rather than hard-coding
 * "the parent of a district is a division".
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2
 */

/**
 * Ordered coarse-to-fine. The order is the containment relation, so `indexOf` answers "is A above
 * B?" without a lookup table that could disagree with it.
 */
export const AREA_LEVELS = ['DIVISION', 'DISTRICT', 'UPAZILA', 'UNION'] as const
export type AreaLevel = (typeof AREA_LEVELS)[number]

export function isAreaLevel(value: string): value is AreaLevel {
  return (AREA_LEVELS as readonly string[]).includes(value)
}

/** The level a picker should offer next, or null when the hierarchy bottoms out. */
export function childLevelOf(level: AreaLevel): AreaLevel | null {
  return AREA_LEVELS[AREA_LEVELS.indexOf(level) + 1] ?? null
}

/** The level above, or null at the root. */
export function parentLevelOf(level: AreaLevel): AreaLevel | null {
  const index = AREA_LEVELS.indexOf(level)
  return index <= 0 ? null : (AREA_LEVELS[index - 1] ?? null)
}

/** True when `outer` is a strictly coarser level than `inner`. */
export function contains(outer: AreaLevel, inner: AreaLevel): boolean {
  return AREA_LEVELS.indexOf(outer) < AREA_LEVELS.indexOf(inner)
}

/**
 * The finest level an address is REQUIRED to reach.
 *
 * Upazila, not union. Union coverage is incomplete in the seeded data and a buyer who genuinely
 * does not know their union must still be able to finish — the union field stays available and
 * improves the delivery estimate when supplied, but demanding it would strand people at the last
 * step of a form on a slow connection.
 */
export const MINIMUM_ADDRESS_LEVEL: AreaLevel = 'UPAZILA'

export function isDeepEnoughForAddress(level: AreaLevel): boolean {
  return !contains(level, MINIMUM_ADDRESS_LEVEL)
}

export interface AreaNode {
  readonly id: string
  readonly level: AreaLevel
  readonly parentId: string | null
  readonly nameBn: string
  readonly nameEn: string
}

/** Localised name. Bangla is the default; English is the toggle, not the other way round. */
export function areaName(area: Pick<AreaNode, 'nameBn' | 'nameEn'>, locale: 'bn' | 'en'): string {
  return locale === 'bn' ? area.nameBn : area.nameEn
}

/**
 * Render a path coarse-to-fine, e.g. "Rajshahi, Bogura, Shibganj".
 *
 * Takes the chain the caller already walked rather than walking it here: resolving parents is a
 * database concern, and a pure function that needed I/O would not be pure.
 */
export function formatAreaPath(
  chain: readonly Pick<AreaNode, 'nameBn' | 'nameEn'>[],
  locale: 'bn' | 'en',
): string {
  return chain.map((area) => areaName(area, locale)).join(locale === 'bn' ? ', ' : ', ')
}

/**
 * Is `chain` a well-formed root-to-leaf path?
 *
 * Each entry must be one level finer than the last and name the previous as its parent. Guards
 * the case where a client posts an area id that is real but not actually inside the district they
 * also posted — which would otherwise produce a delivery quote to the wrong half of the country.
 */
export function isValidAreaPath(chain: readonly AreaNode[]): boolean {
  if (chain.length === 0) return false

  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]
    if (node === undefined) return false

    const expected = AREA_LEVELS[index]
    if (expected === undefined || node.level !== expected) return false

    const parent = chain[index - 1]
    if (index === 0) {
      if (node.parentId !== null) return false
    } else if (parent === undefined || node.parentId !== parent.id) {
      return false
    }
  }

  return true
}
