export {
  BusinessIdentityError,
  normalizeBin,
  normalizeBusinessName,
  normalizeDigits,
  normalizeTin,
  normalizeTradeLicence,
  validateBusinessIdentity,
  type BusinessIdentity,
  type BusinessIdentityInput,
} from './business.js'

export {
  BUSINESS_TYPES,
  DIETARY_PREFERENCES,
  DISTRIBUTION_REACH,
  PURCHASE_FREQUENCIES,
  SPECIALISATIONS,
  SUPPLY_CATEGORIES,
  VEHICLE_TYPES,
  isBusinessType,
  isDietaryPreference,
  isDistributionReach,
  isPurchaseFrequency,
  isSpecialisation,
  isSupplyCategory,
  isVehicleType,
  type BusinessType,
  type DietaryPreference,
  type DistributionReach,
  type PurchaseFrequency,
  type Specialisation,
  type SupplyCategory,
  type VehicleType,
} from './catalogue.js'

export {
  PROFILE_FIELDS,
  PROFILE_ROLES,
  ROLES_WITH_SERVICE_AREA,
  SERVICE_AREA_FIELD,
  isProfileRole,
  type FieldDescriptor,
  type FieldKind,
  type ProfileRole,
} from './schema.js'

export {
  ProfileError,
  profileCompletion,
  validateProfile,
  type ProfileChanges,
  type ProfileInput,
} from './validate.js'
