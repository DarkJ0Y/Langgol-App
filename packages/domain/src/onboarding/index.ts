export {
  NO_PROGRESS,
  ONBOARDING_STEPS,
  ROLES_AFFECTING_STEPS,
  STEP_DESCRIPTORS,
  STEP_TIERS,
  applicableSteps,
  isOnboardingStep,
  isStepSatisfied,
  type OnboardingFacts,
  type OnboardingStep,
  type StepDescriptor,
  type StepTier,
} from './steps.js'

export {
  onboardingCompletion,
  type OnboardingCompletion,
  type StepStatus,
  type TierProgress,
} from './completion.js'

export {
  ONBOARDING_STATES,
  advanceOnboardingState,
  deriveOnboardingState,
  isOnboardingState,
  migrateLegacyState,
  onboardingRank,
  type OnboardingState,
} from './states.js'

export { MAX_PROMPTS, nextBestAction, onboardingPrompts, type OnboardingPrompt } from './prompts.js'
