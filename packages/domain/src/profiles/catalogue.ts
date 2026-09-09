/**
 * The vocabularies the six role profiles choose from.
 *
 * Closed lists rather than free text, for the same reason the farming vocabulary is closed: free
 * text cannot be aggregated, translated, or matched. "Cold chain", "refrigerated" and "চিলার" are
 * one capability typed three ways, and a buyer searching for cold-chain logistics would find one
 * of the three.
 *
 * Display text lives in the i18n catalogues, keyed by these identifiers. The domain owns the
 * vocabulary; the interface owns the words.
 */

const asSet = <T extends string>(values: readonly T[]): ReadonlySet<string> => new Set(values)

/* -------------------------------------------------------------------- consumer */

/**
 * Dietary preferences.
 *
 * Deliberately short and about food rather than identity. Langgol needs to know what to surface
 * in a marketplace, not to hold a record of somebody's religion — `HALAL` is here because it
 * determines which listings are useful, and nothing more is collected than that.
 */
export const DIETARY_PREFERENCES = ['HALAL', 'VEGETARIAN', 'VEGAN', 'NO_PREFERENCE'] as const
export type DietaryPreference = (typeof DIETARY_PREFERENCES)[number]

export const PURCHASE_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'FORTNIGHTLY',
  'MONTHLY',
  'OCCASIONAL',
] as const
export type PurchaseFrequency = (typeof PURCHASE_FREQUENCIES)[number]

/* -------------------------------------------------------------------- retailer */

export const BUSINESS_TYPES = [
  'GROCERY',
  'SUPERSHOP',
  'RESTAURANT',
  'HOTEL',
  'INSTITUTION',
  'STREET_VENDOR',
] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

/* ------------------------------------------------------------------ wholesaler */

/**
 * How far a wholesaler distributes.
 *
 * Expressed as administrative reach rather than kilometres, because that is how distribution is
 * actually organised in Bangladesh — a wholesaler covers upazilas and districts, not radii, and
 * the admin-area tree already models exactly that.
 */
export const DISTRIBUTION_REACH = ['UPAZILA', 'DISTRICT', 'DIVISION', 'NATIONAL'] as const
export type DistributionReach = (typeof DISTRIBUTION_REACH)[number]

/* -------------------------------------------------------------------- supplier */

/** What a supplier sells INTO farming — inputs, not produce. */
export const SUPPLY_CATEGORIES = [
  'SEED',
  'FERTILISER',
  'PESTICIDE',
  'EQUIPMENT',
  'IRRIGATION',
  'FEED',
  'VETERINARY',
] as const
export type SupplyCategory = (typeof SUPPLY_CATEGORIES)[number]

/* ---------------------------------------------------------------------- expert */

export const SPECIALISATIONS = [
  'AGRONOMY',
  'PLANT_PATHOLOGY',
  'ENTOMOLOGY',
  'SOIL_SCIENCE',
  'HORTICULTURE',
  'LIVESTOCK',
  'FISHERIES',
  'IRRIGATION',
  'POST_HARVEST',
] as const
export type Specialisation = (typeof SPECIALISATIONS)[number]

/* ------------------------------------------------------------------- logistics */

export const VEHICLE_TYPES = [
  'VAN',
  'PICKUP',
  'TRUCK',
  'COVERED_VAN',
  'REFRIGERATED_TRUCK',
  'THREE_WHEELER',
  'BOAT',
] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

/*
 * `BOAT` is not decoration. Large parts of Barisal and the haor basin move produce by water for
 * months of the year, and a vehicle list without it would quietly exclude those operators.
 */

const SETS = {
  dietary: asSet(DIETARY_PREFERENCES),
  frequency: asSet(PURCHASE_FREQUENCIES),
  businessType: asSet(BUSINESS_TYPES),
  reach: asSet(DISTRIBUTION_REACH),
  supply: asSet(SUPPLY_CATEGORIES),
  specialisation: asSet(SPECIALISATIONS),
  vehicle: asSet(VEHICLE_TYPES),
} as const

export const isDietaryPreference = (v: unknown): v is DietaryPreference =>
  typeof v === 'string' && SETS.dietary.has(v)
export const isPurchaseFrequency = (v: unknown): v is PurchaseFrequency =>
  typeof v === 'string' && SETS.frequency.has(v)
export const isBusinessType = (v: unknown): v is BusinessType =>
  typeof v === 'string' && SETS.businessType.has(v)
export const isDistributionReach = (v: unknown): v is DistributionReach =>
  typeof v === 'string' && SETS.reach.has(v)
export const isSupplyCategory = (v: unknown): v is SupplyCategory =>
  typeof v === 'string' && SETS.supply.has(v)
export const isSpecialisation = (v: unknown): v is Specialisation =>
  typeof v === 'string' && SETS.specialisation.has(v)
export const isVehicleType = (v: unknown): v is VehicleType =>
  typeof v === 'string' && SETS.vehicle.has(v)
