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
  isSoilType,
  SOIL_TYPES,
  type FarmerType,
  type FarmingMethod,
  type IrrigationMethod,
  type LandOwnershipType,
  type LandUnit,
  type WaterSource,
  type SoilType,
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

export {
  MAX_FARMS_PER_FARMER,
  MAX_NAME_LENGTH,
  MAX_PLOTS_PER_FARM,
  HoldingError,
  resolvePlot,
  validateHolding,
  type FarmFields,
  type HoldingUpdate,
  type PlotFields,
} from './holding.js'
