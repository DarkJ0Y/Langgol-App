export {
  FARMER_TYPES,
  LAND_UNITS,
  LAND_OWNERSHIP_TYPES,
  IRRIGATION_METHODS,
  WATER_SOURCES,
  FARMING_METHODS,
  isFarmerType,
  isFarmingMethod,
  isIrrigationMethod,
  isLandOwnershipType,
  isLandUnit,
  isWaterSource,
  type FarmerType,
  type FarmingMethod,
  type IrrigationMethod,
  type LandOwnershipType,
  type LandUnit,
  type WaterSource,
} from './catalogue.js'

export {
  LAND_AMOUNT_SCALE,
  MAX_LAND_MILLI_DECIMALS,
  LandError,
  formatLandAmount,
  normalizeDigits,
  parseLandAmount,
  toDecimals,
  toMilliDecimals,
} from './land.js'

export {
  EMPTY_FARMING_FIELDS,
  MAX_EXPERIENCE_YEARS,
  ONBOARDING_STEPS,
  FarmingProfileError,
  farmingCompletion,
  validateFarmingUpdate,
  type FarmingCompletion,
  type FarmingFields,
  type FarmingFieldsUpdate,
  type OnboardingStep,
} from './profile.js'
