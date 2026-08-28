/**
 * The farming vocabulary.
 *
 * Six independent axes describing how somebody farms. Each is a closed list rather than free
 * text, for the same reason the product catalogue is curated (docs/02_DATABASE.md §6.1): free
 * text cannot be aggregated, cannot be translated, and cannot be matched against an advisory
 * rule. "সেচ আছে" and "sech ache" and "irrigated" are one fact typed three ways.
 *
 * **Display text is NOT here.** It lives in the i18n catalogues, keyed by these identifiers.
 * Consent puts its wording in the domain because consent text is legally versioned and the
 * version is evidence; a farmer's irrigation method is ordinary UI copy, and duplicating it into
 * the domain would give it two homes and one of them would go stale.
 *
 * Every axis is optional on the profile. A farmer who does not know their total land, or does
 * not wish to say, is a farmer — not an invalid record. See `profile.ts`.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2
 */

/**
 * What the farmer principally produces.
 *
 * `MIXED` is a real answer and the common one — the smallholder norm in Bangladesh is rice plus
 * a homestead vegetable plot plus a few birds, not specialisation. Offering only single-commodity
 * options would force most farmers to misdescribe themselves.
 */
export const FARMER_TYPES = [
  'CROP',
  'VEGETABLE',
  'FRUIT',
  'FISH',
  'LIVESTOCK',
  'POULTRY',
  'DAIRY',
  'MIXED',
] as const
export type FarmerType = (typeof FARMER_TYPES)[number]

/**
 * The units Bangladeshi farmers actually use for land.
 *
 * A farmer says "দুই বিঘা", never "0.27 hectares". Asking in hectares would get a wrong answer
 * from someone who knows their land perfectly well, so the unit is stored alongside the number
 * and the conversion happens in `land.ts` — never in the farmer's head.
 *
 * `KATHA` and `BIGHA` vary regionally; the values used here are the Dhaka convention, which is
 * what the conversion table documents. See `land.ts`.
 */
export const LAND_UNITS = ['DECIMAL', 'KATHA', 'BIGHA', 'ACRE', 'HECTARE'] as const
export type LandUnit = (typeof LAND_UNITS)[number]

/**
 * How the land is held.
 *
 * Tenure matters beyond bookkeeping: a sharecropper (`SHARECROPPED` — বর্গা) does not control
 * what is planted and often cannot pledge the crop, so advisory and credit features must be able
 * to tell them apart from an owner. `MIXED` is common — owning a homestead plot while
 * sharecropping a larger field is an ordinary arrangement.
 */
export const LAND_OWNERSHIP_TYPES = [
  'OWNED',
  'LEASED',
  'SHARECROPPED',
  'MIXED',
  'COMMUNITY',
] as const
export type LandOwnershipType = (typeof LAND_OWNERSHIP_TYPES)[number]

/**
 * How water reaches the field.
 *
 * Distinct from where the water comes from: a farmer can lift pond water with a bucket or with a
 * sprinkler, and those are different capital positions with the same source. Collapsing the two
 * into one question is the sort of shortcut that makes the data useless for the thing it was
 * collected for.
 */
export const IRRIGATION_METHODS = ['MANUAL', 'FLOOD', 'FURROW', 'SPRINKLER', 'DRIP'] as const
export type IrrigationMethod = (typeof IRRIGATION_METHODS)[number]

/** Where the water comes from. See `IRRIGATION_METHODS` for why this is a separate axis. */
export const WATER_SOURCES = [
  'RAIN',
  'RIVER',
  'CANAL',
  'POND',
  'SHALLOW_TUBEWELL',
  'DEEP_TUBEWELL',
  'SUPPLY',
] as const
export type WaterSource = (typeof WATER_SOURCES)[number]

/**
 * The growing practice.
 *
 * `ORGANIC` here is the farmer's own description, NOT a certification. Nothing in this field may
 * be surfaced to buyers as a certified claim — that would turn a self-declaration into a
 * marketing assertion the platform cannot stand behind. Certification, if it is ever added, is a
 * separate verified field with evidence behind it.
 */
export const FARMING_METHODS = ['CONVENTIONAL', 'ORGANIC', 'INTEGRATED', 'MIXED'] as const
export type FarmingMethod = (typeof FARMING_METHODS)[number]

/**
 * Soil types a farmer recognises, not a pedological classification.
 *
 * `SALINE` sits beside the texture classes rather than under them: coastal salinity is a distinct
 * problem with distinct remedies, and it is spreading. A farmer in Khulna needs to be able to say
 * it, and a texture-only list would force them to describe their field as something it is not.
 */
export const SOIL_TYPES = [
  'LOAM',
  'CLAY',
  'CLAY_LOAM',
  'SANDY',
  'SANDY_LOAM',
  'SILT',
  'PEAT',
  'SALINE',
] as const
export type SoilType = (typeof SOIL_TYPES)[number]

const asSet = <T extends string>(values: readonly T[]): ReadonlySet<string> => new Set(values)

const FARMER_TYPE_SET = asSet(FARMER_TYPES)
const LAND_UNIT_SET = asSet(LAND_UNITS)
const OWNERSHIP_SET = asSet(LAND_OWNERSHIP_TYPES)
const IRRIGATION_SET = asSet(IRRIGATION_METHODS)
const WATER_SET = asSet(WATER_SOURCES)
const METHOD_SET = asSet(FARMING_METHODS)
const SOIL_SET = asSet(SOIL_TYPES)

export const isFarmerType = (value: unknown): value is FarmerType =>
  typeof value === 'string' && FARMER_TYPE_SET.has(value)

export const isLandUnit = (value: unknown): value is LandUnit =>
  typeof value === 'string' && LAND_UNIT_SET.has(value)

export const isLandOwnershipType = (value: unknown): value is LandOwnershipType =>
  typeof value === 'string' && OWNERSHIP_SET.has(value)

export const isIrrigationMethod = (value: unknown): value is IrrigationMethod =>
  typeof value === 'string' && IRRIGATION_SET.has(value)

export const isWaterSource = (value: unknown): value is WaterSource =>
  typeof value === 'string' && WATER_SET.has(value)

export const isFarmingMethod = (value: unknown): value is FarmingMethod =>
  typeof value === 'string' && METHOD_SET.has(value)

export const isSoilType = (value: unknown): value is SoilType =>
  typeof value === 'string' && SOIL_SET.has(value)
