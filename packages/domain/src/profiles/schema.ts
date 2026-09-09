/**
 * What each role profile is made of.
 *
 * One descriptor table rather than six hand-written validators and six hand-written forms. That
 * is the "do not duplicate validation logic, create reusable profile components" instruction
 * taken at its word: adding a field to the wholesaler profile is a line here, and the validator,
 * the form control and the label key all follow from it.
 *
 * The alternative — six near-identical modules — is the arrangement where the fifth one silently
 * stops matching the other four, and the one that drifts is always the one nobody was looking at.
 *
 * ## What is deliberately NOT here
 *
 * **`preferredLanguage`.** It already lives on `User`, where every role has it. A copy on the
 * consumer profile would be a second answer to the same question, and the two would disagree the
 * first time somebody changed one.
 *
 * **`verificationStatus`.** It is on the stored record but not in this table, because it is never
 * submitted: a self-attested verification is not a verification. It is set by the operations
 * process, and the absence of a descriptor is what makes it unreachable from a form.
 */

import {
  isBusinessType,
  isDietaryPreference,
  isDistributionReach,
  isPurchaseFrequency,
  isSpecialisation,
  isSupplyCategory,
  isVehicleType,
  BUSINESS_TYPES,
  DIETARY_PREFERENCES,
  DISTRIBUTION_REACH,
  PURCHASE_FREQUENCIES,
  SPECIALISATIONS,
  SUPPLY_CATEGORIES,
  VEHICLE_TYPES,
} from './catalogue.js'

/** The roles that carry a profile of their own. FARMER has its own richer one from P5. */
export const PROFILE_ROLES = [
  'CONSUMER',
  'RETAILER',
  'WHOLESALER',
  'SUPPLIER',
  'AGRICULTURAL_EXPERT',
  'LOGISTICS_PROVIDER',
] as const
export type ProfileRole = (typeof PROFILE_ROLES)[number]

export const isProfileRole = (value: unknown): value is ProfileRole =>
  typeof value === 'string' && (PROFILE_ROLES as readonly string[]).includes(value)

/**
 * How a field behaves.
 *
 * `choice` and `multi` carry their own vocabulary so the form can render options and the
 * validator can reject anything outside them from the same declaration.
 */
export type FieldKind =
  | { readonly kind: 'text'; readonly maxLength: number }
  | { readonly kind: 'longText'; readonly maxLength: number }
  | { readonly kind: 'integer'; readonly min: number; readonly max: number }
  | { readonly kind: 'money' }
  | { readonly kind: 'boolean' }
  | {
      readonly kind: 'choice'
      readonly options: readonly string[]
      readonly guard: (v: unknown) => boolean
    }
  | {
      readonly kind: 'multi'
      readonly options: readonly string[]
      readonly guard: (v: unknown) => boolean
    }
  /** Trade licence, TIN or BIN — normalised by the shared business-identity module. */
  | { readonly kind: 'tin' }
  | { readonly kind: 'bin' }
  | { readonly kind: 'licence' }
  /**
   * One of the caller's OWN addresses, chosen by id.
   *
   * A reference to the address book rather than a second copy of the street and the upazila. A
   * retailer who moves shop corrects one address and every profile pointing at it follows; two
   * copies would mean the delivery went to the old one.
   *
   * The descriptor judges the SHAPE only. It has no database, so it cannot know whose address an
   * id is — `updateMyRoleProfile` refuses one belonging to somebody else, and a trigger refuses
   * it again underneath. Refs: docs/07_SECURITY.md §4
   */
  | { readonly kind: 'address' }
  /**
   * A latitude/longitude PAIR.
   *
   * Judged by the same bounds an address pin is judged by, imported rather than restated — a shop
   * that would be rejected as an address must not be accepted as a shop location.
   */
  | { readonly kind: 'geo' }

export interface FieldDescriptor {
  readonly name: string
  /** Required means the profile cannot be saved without it, not that it gates the account. */
  readonly required?: boolean
  readonly kind: FieldKind
  /**
   * What to call this field when the column name is not the question.
   *
   * Three roles store an address in a column called `address_id`, but they are not asking the
   * same thing: a retailer is asked where the shop is, a wholesaler and a supplier where the
   * warehouse is. Labelling all three "Address" would be accurate about the storage and useless
   * to the person filling it in.
   *
   * A slug rather than a message key, so the domain still names no catalogue and the interface
   * still owns the words. Defaults to `name`.
   */
  readonly labelSlug?: string
}

const text = (maxLength: number): FieldKind => ({ kind: 'text', maxLength })
const choice = (options: readonly string[], guard: (v: unknown) => boolean): FieldKind => ({
  kind: 'choice',
  options,
  guard,
})
const multi = (options: readonly string[], guard: (v: unknown) => boolean): FieldKind => ({
  kind: 'multi',
  options,
  guard,
})

/** The three documents every trading entity presents. Declared once, spread into three roles. */
const BUSINESS_DOCS: readonly FieldDescriptor[] = [
  { name: 'tradeLicence', kind: { kind: 'licence' } },
  { name: 'tin', kind: { kind: 'tin' } },
  { name: 'bin', kind: { kind: 'bin' } },
]

export const PROFILE_FIELDS: Record<ProfileRole, readonly FieldDescriptor[]> = {
  CONSUMER: [
    { name: 'dietaryPreferences', kind: multi(DIETARY_PREFERENCES, isDietaryPreference) },
    { name: 'preferredProducts', kind: multi([], () => true) },
    { name: 'purchaseFrequency', kind: choice(PURCHASE_FREQUENCIES, isPurchaseFrequency) },
    // Where the shop delivers by default. A pointer into the address book, never a copy of it.
    { name: 'defaultAddressId', labelSlug: 'defaultAddress', kind: { kind: 'address' } },
  ],

  RETAILER: [
    { name: 'businessName', required: true, kind: text(160) },
    { name: 'businessType', kind: choice(BUSINESS_TYPES, isBusinessType) },
    ...BUSINESS_DOCS,
    { name: 'yearsInBusiness', kind: { kind: 'integer', min: 0, max: 100 } },
    { name: 'addressId', labelSlug: 'businessAddress', kind: { kind: 'address' } },
    /*
     * The shop's pin, separate from its address, because the two answer different questions. The
     * address is where a letter goes; the pin is where a rider stops — and in a bazaar the second
     * is not derivable from the first.
     */
    { name: 'shopLocation', kind: { kind: 'geo' } },
  ],

  WHOLESALER: [
    { name: 'businessName', required: true, kind: text(160) },
    ...BUSINESS_DOCS,
    // Tonnes. A wholesaler thinks in tonnes of capacity, not kilograms.
    { name: 'warehouseCapacityTonnes', kind: { kind: 'integer', min: 0, max: 100_000 } },
    { name: 'distributionReach', kind: choice(DISTRIBUTION_REACH, isDistributionReach) },
    { name: 'ownsTransport', kind: { kind: 'boolean' } },
    // Where the warehouse is. Same address book, same ownership rule as every other role.
    { name: 'addressId', labelSlug: 'warehouseAddress', kind: { kind: 'address' } },
  ],

  SUPPLIER: [
    { name: 'companyName', required: true, kind: text(160) },
    { name: 'businessRegistration', kind: text(60) },
    ...BUSINESS_DOCS,
    { name: 'hasWarehouse', kind: { kind: 'boolean' } },
    { name: 'productCategories', kind: multi(SUPPLY_CATEGORIES, isSupplyCategory) },
    // Only meaningful alongside `hasWarehouse`, and deliberately not conditional on it: a
    // supplier who ticks the box and then unticks it should not silently lose the address.
    { name: 'addressId', labelSlug: 'warehouseAddress', kind: { kind: 'address' } },
  ],

  AGRICULTURAL_EXPERT: [
    { name: 'specialisations', kind: multi(SPECIALISATIONS, isSpecialisation) },
    { name: 'qualification', kind: text(160) },
    { name: 'institution', kind: text(160) },
    { name: 'yearsOfExperience', kind: { kind: 'integer', min: 0, max: 70 } },
    { name: 'certifications', kind: multi([], () => true) },
    // Integer poisha, like every other amount in the schema.
    { name: 'consultationFeePoisha', kind: { kind: 'money' } },
    { name: 'offersOnline', kind: { kind: 'boolean' } },
    { name: 'offersOffline', kind: { kind: 'boolean' } },
    { name: 'bio', kind: { kind: 'longText', maxLength: 1000 } },
  ],

  LOGISTICS_PROVIDER: [
    { name: 'companyName', required: true, kind: text(160) },
    { name: 'vehicleTypes', kind: multi(VEHICLE_TYPES, isVehicleType) },
    { name: 'coldChainAvailable', kind: { kind: 'boolean' } },
    { name: 'warehouseAvailable', kind: { kind: 'boolean' } },
  ],
}

/**
 * The service area every non-consumer role declares.
 *
 * A separate join rather than a column, because "where do you operate?" is answered with a list
 * of upazilas and districts, and the admin-area tree already models exactly that. Modelled here
 * as a field name so the form and the use case agree what to call it.
 */
export const SERVICE_AREA_FIELD = 'serviceAreaIds'

export const ROLES_WITH_SERVICE_AREA: readonly ProfileRole[] = [
  'WHOLESALER',
  'SUPPLIER',
  'AGRICULTURAL_EXPERT',
  'LOGISTICS_PROVIDER',
]
