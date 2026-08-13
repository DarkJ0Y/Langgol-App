export {
  availableActions,
  isTerminal,
  transition,
  TransitionError,
  type FaultParty,
  type OrderAction,
  type OrderActorRole,
  type OrderStatus,
  type TransitionContext,
  type TransitionEffect,
  type TransitionErrorCode,
  type TransitionResult,
} from './transition.js'

import * as transitions from './transition.js'

/** Namespace object: `Orders.transition(context)`. */
export const Orders = { ...transitions } as const
