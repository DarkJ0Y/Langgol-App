/**
 * The order state machine.
 *
 * `OrderStatus` is changed by **exactly one function**: `transition()`. Assigning a status
 * anywhere else is a review-blocking defect, because the guards, the mandatory fault attribution
 * and the effect list all live here — a status set directly bypasses every one of them.
 *
 * Five rules govern this module (docs/05_ORDER_SYSTEM.md §1):
 *
 *  1. One function changes status.
 *  2. Every transition appends an immutable `OrderEvent`; `orders.status` is a projection of it.
 *  3. Every transition declares permitted actors, a guard, and effects.
 *  4. Transitions are **idempotent** — replaying `accept` on a confirmed order succeeds with the
 *     current state rather than erroring, and does not double-post to the ledger.
 *  5. The client requests an **action**, never a status. The server decides the resulting state.
 *
 * Refs: docs/05_ORDER_SYSTEM.md §1–3, §5.1
 */

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED'
  | 'DISPUTED'

export type OrderActorRole = 'BUYER' | 'FARMER' | 'OPS_AGENT' | 'ADMIN' | 'SYSTEM'

/** WHO the cost of a failure is attributable to. docs/05 §5.1. */
export type FaultParty =
  'BUYER' | 'SELLER' | 'PLATFORM' | 'LOGISTICS' | 'FORCE_MAJEURE' | 'UNDETERMINED'

/** What a caller asks for. Never a status. */
export type OrderAction =
  | 'ACCEPT'
  | 'REJECT'
  | 'CANCEL'
  | 'EXPIRE'
  | 'START_PREPARING'
  | 'MARK_READY'
  | 'PICK_UP'
  | 'CONFIRM_DELIVERY'
  | 'FAIL_DELIVERY'
  | 'COMPLETE'
  | 'OPEN_DISPUTE'
  | 'RESOLVE_DISPUTE_NO_REFUND'
  | 'RESOLVE_DISPUTE_REFUND'
  | 'REFUND'

export type TransitionErrorCode =
  | 'ILLEGAL_TRANSITION'
  | 'ACTOR_NOT_PERMITTED'
  | 'GUARD_FAILED'
  | 'FAULT_REQUIRED'
  | 'REASON_REQUIRED'

export class TransitionError extends Error {
  readonly code: TransitionErrorCode
  readonly from: OrderStatus
  readonly action: OrderAction

  constructor(code: TransitionErrorCode, message: string, from: OrderStatus, action: OrderAction) {
    super(message)
    this.name = 'TransitionError'
    this.code = code
    this.from = from
    this.action = action
  }
}

/** Side effects a transition requires. The caller runs them in the same database transaction. */
export type TransitionEffect =
  | 'COMMIT_RESERVATION'
  | 'RELEASE_RESERVATION'
  | 'CLOSE_RESERVATION'
  | 'POST_GOODS_DELIVERED'
  | 'POST_REFUND'
  | 'CAPTURE_PAYMENT'
  | 'SET_SETTLEMENT_HOLD'
  | 'RELEASE_SETTLEMENT_HOLD'
  | 'MARK_SETTLEABLE'
  | 'PENALISE_SELLER_RELIABILITY'
  | 'CREATE_DELIVERY'
  | 'GENERATE_DELIVERY_OTP'
  | 'RECORD_CANCELLATION_FEE'
  | 'NOTIFY_BUYER'
  | 'NOTIFY_SELLER'
  | 'NOTIFY_OPS'

export interface TransitionContext {
  readonly status: OrderStatus
  readonly action: OrderAction
  readonly actor: OrderActorRole
  readonly now: Date
  readonly acceptanceDeadline: Date
  readonly fulfilmentMode: 'BUYER_PICKUP' | 'SELLER_DELIVERY' | 'LANGGOL_DELIVERY'
  /** Required for any transition into CANCELLED, FAILED or REFUNDED. */
  readonly faultParty?: FaultParty | null
  readonly reason?: string | null
  /** T11/T13: delivery must be proved, not asserted. */
  readonly deliveryProofVerified?: boolean
  /** T9: the farmer must record what they actually packed. */
  readonly actualQuantityRecorded?: boolean
  readonly deliveredAt?: Date | null
  /** From `order.reviewWindowHours` / `order.disputeWindowHours`. */
  readonly reviewWindowHours?: number
  readonly disputeWindowHours?: number
}

export interface TransitionResult {
  readonly from: OrderStatus
  readonly to: OrderStatus
  readonly effects: readonly TransitionEffect[]
  /** True when the order was already in the target state and nothing changed. */
  readonly idempotent: boolean
  readonly faultParty: FaultParty | null
  readonly reason: string | null
}

/** States from which nothing further can happen except a refund. */
const TERMINAL: ReadonlySet<OrderStatus> = new Set(['COMPLETED', 'REFUNDED'])

/** Any transition landing here demands a fault party. docs/05 §3, and a database CHECK. */
const FAULT_REQUIRED_TARGETS: ReadonlySet<OrderStatus> = new Set([
  'CANCELLED',
  'FAILED',
  'REFUNDED',
])

interface Rule {
  readonly id: string
  readonly from: readonly OrderStatus[]
  readonly action: OrderAction
  readonly to: OrderStatus
  readonly actors: readonly OrderActorRole[]
  readonly effects: readonly TransitionEffect[]
  readonly requiresReason?: boolean
  readonly guard?: (context: TransitionContext) => string | null
}

/**
 * The normative transition table from docs/05 §3.
 *
 * Kept as data rather than a switch so it can be read against the document line by line, and so a
 * missing row is visibly missing rather than silently unreachable.
 */
const RULES: readonly Rule[] = [
  {
    id: 'T2',
    from: ['PENDING'],
    action: 'ACCEPT',
    to: 'CONFIRMED',
    actors: ['FARMER', 'ADMIN'],
    effects: ['COMMIT_RESERVATION', 'NOTIFY_BUYER'],
    guard: (context) =>
      context.actor === 'ADMIN' || context.now <= context.acceptanceDeadline
        ? null
        : 'The acceptance window has closed',
  },
  {
    id: 'T3',
    from: ['PENDING'],
    action: 'REJECT',
    to: 'CANCELLED',
    actors: ['FARMER', 'ADMIN'],
    requiresReason: true,
    effects: ['RELEASE_RESERVATION', 'PENALISE_SELLER_RELIABILITY', 'POST_REFUND', 'NOTIFY_BUYER'],
  },
  {
    id: 'T5',
    from: ['PENDING'],
    action: 'EXPIRE',
    to: 'CANCELLED',
    actors: ['SYSTEM'],
    effects: [
      'RELEASE_RESERVATION',
      'PENALISE_SELLER_RELIABILITY',
      'POST_REFUND',
      'NOTIFY_BUYER',
      'NOTIFY_SELLER',
    ],
    guard: (context) =>
      context.now > context.acceptanceDeadline ? null : 'The acceptance window has not elapsed yet',
  },
  {
    // T4 (buyer, no fee) and T7/T8 (later states, fee may apply). One action, because the fee is
    // a policy decision made from the state, not a different request.
    id: 'T4/T7/T8',
    from: ['PENDING', 'CONFIRMED', 'PREPARING'],
    action: 'CANCEL',
    to: 'CANCELLED',
    actors: ['BUYER', 'FARMER', 'ADMIN'],
    requiresReason: true,
    effects: [
      'RELEASE_RESERVATION',
      'RECORD_CANCELLATION_FEE',
      'POST_REFUND',
      'NOTIFY_BUYER',
      'NOTIFY_SELLER',
    ],
  },
  {
    id: 'T6',
    from: ['CONFIRMED'],
    action: 'START_PREPARING',
    to: 'PREPARING',
    actors: ['FARMER'],
    effects: ['NOTIFY_BUYER'],
  },
  {
    id: 'T9',
    from: ['PREPARING'],
    action: 'MARK_READY',
    to: 'READY_FOR_PICKUP',
    actors: ['FARMER'],
    effects: ['CREATE_DELIVERY', 'NOTIFY_OPS', 'NOTIFY_BUYER'],
    guard: (context) =>
      context.actualQuantityRecorded === true
        ? null
        : 'The actual packed quantity must be recorded before an order is ready',
  },
  {
    id: 'T10',
    from: ['READY_FOR_PICKUP'],
    action: 'PICK_UP',
    to: 'IN_TRANSIT',
    actors: ['OPS_AGENT', 'FARMER'],
    effects: ['GENERATE_DELIVERY_OTP', 'NOTIFY_BUYER'],
    guard: (context) =>
      context.fulfilmentMode === 'BUYER_PICKUP'
        ? 'A pickup order is collected by the buyer, not put in transit'
        : null,
  },
  {
    // T11 (buyer collects) and T13 (courier delivers) share an action; the guard differs only in
    // which proof is required, and both require proof.
    id: 'T11/T13',
    from: ['READY_FOR_PICKUP', 'IN_TRANSIT'],
    action: 'CONFIRM_DELIVERY',
    to: 'DELIVERED',
    actors: ['OPS_AGENT', 'FARMER'],
    effects: ['CLOSE_RESERVATION', 'CAPTURE_PAYMENT', 'POST_GOODS_DELIVERED', 'NOTIFY_BUYER'],
    guard: (context) => {
      if (context.status === 'READY_FOR_PICKUP' && context.fulfilmentMode !== 'BUYER_PICKUP') {
        return 'Only a pickup order goes straight from ready to delivered'
      }
      // docs/05 T11/T13: the OTP or photo proof is the control that stops a courier marking an
      // undelivered order as delivered and triggering settlement.
      return context.deliveryProofVerified === true
        ? null
        : 'Delivery must be proved by OTP or photo evidence before it is confirmed'
    },
  },
  {
    id: 'T12/T14',
    from: ['READY_FOR_PICKUP', 'IN_TRANSIT'],
    action: 'FAIL_DELIVERY',
    to: 'FAILED',
    actors: ['OPS_AGENT', 'ADMIN', 'SYSTEM'],
    requiresReason: true,
    effects: ['RELEASE_RESERVATION', 'POST_REFUND', 'NOTIFY_BUYER', 'NOTIFY_OPS'],
  },
  {
    id: 'T16',
    from: ['DELIVERED'],
    action: 'COMPLETE',
    to: 'COMPLETED',
    actors: ['SYSTEM', 'ADMIN'],
    effects: ['MARK_SETTLEABLE'],
    guard: (context) => {
      if (context.actor === 'ADMIN') return null
      if (!context.deliveredAt) return 'The order has no delivery time recorded'
      const hours = context.reviewWindowHours ?? 0
      const elapsed = (context.now.getTime() - context.deliveredAt.getTime()) / 3_600_000
      return elapsed >= hours ? null : 'The review window has not elapsed'
    },
  },
  {
    id: 'T17',
    from: ['DELIVERED', 'COMPLETED'],
    action: 'OPEN_DISPUTE',
    to: 'DISPUTED',
    actors: ['BUYER'],
    requiresReason: true,
    effects: ['SET_SETTLEMENT_HOLD', 'NOTIFY_SELLER', 'NOTIFY_OPS'],
    guard: (context) => {
      if (!context.deliveredAt) return 'The order has no delivery time recorded'
      const hours = context.disputeWindowHours ?? 0
      const elapsed = (context.now.getTime() - context.deliveredAt.getTime()) / 3_600_000
      return elapsed <= hours ? null : 'The dispute window has closed'
    },
  },
  {
    id: 'T18',
    from: ['DISPUTED'],
    action: 'RESOLVE_DISPUTE_NO_REFUND',
    to: 'COMPLETED',
    actors: ['ADMIN'],
    requiresReason: true,
    effects: ['RELEASE_SETTLEMENT_HOLD', 'MARK_SETTLEABLE'],
  },
  {
    id: 'T19',
    from: ['DISPUTED'],
    action: 'RESOLVE_DISPUTE_REFUND',
    to: 'REFUNDED',
    actors: ['ADMIN'],
    requiresReason: true,
    effects: ['POST_REFUND', 'RELEASE_SETTLEMENT_HOLD', 'NOTIFY_BUYER', 'NOTIFY_SELLER'],
  },
  {
    id: 'T20',
    from: ['CANCELLED', 'FAILED'],
    action: 'REFUND',
    to: 'REFUNDED',
    actors: ['SYSTEM', 'ADMIN'],
    effects: ['POST_REFUND', 'NOTIFY_BUYER'],
  },
]

/**
 * The action that, replayed, should be treated as a no-op rather than an illegal transition.
 *
 * Rule 4: replaying `accept` on a confirmed order returns success with the current state. Without
 * this, every retry on a flaky connection becomes a spurious error the buyer sees.
 */
function isIdempotentReplay(context: TransitionContext): boolean {
  const rule = RULES.find((entry) => entry.action === context.action)
  return rule !== undefined && rule.to === context.status
}

/**
 * Decide the resulting state, or refuse.
 *
 * Returns the target state and the effects the caller must apply **in the same transaction**.
 * This function performs no I/O and has no opinion about how the effects are executed.
 */
export function transition(context: TransitionContext): TransitionResult {
  if (isIdempotentReplay(context)) {
    return {
      from: context.status,
      to: context.status,
      effects: [],
      idempotent: true,
      faultParty: context.faultParty ?? null,
      reason: context.reason ?? null,
    }
  }

  const rule = RULES.find(
    (entry) => entry.action === context.action && entry.from.includes(context.status),
  )

  if (!rule) {
    // A client attempting one of these is either broken or probing; the caller logs it as a
    // security-relevant event. docs/05 §3.
    throw new TransitionError(
      'ILLEGAL_TRANSITION',
      TERMINAL.has(context.status)
        ? `An order in ${context.status} is final and cannot be changed by ${context.action}`
        : `${context.action} is not a legal action from ${context.status}`,
      context.status,
      context.action,
    )
  }

  if (!rule.actors.includes(context.actor)) {
    throw new TransitionError(
      'ACTOR_NOT_PERMITTED',
      `${context.actor} may not ${context.action} an order in ${context.status}; ` +
        `permitted: ${rule.actors.join(', ')}`,
      context.status,
      context.action,
    )
  }

  const guardFailure = rule.guard?.(context) ?? null
  if (guardFailure !== null) {
    throw new TransitionError('GUARD_FAILED', guardFailure, context.status, context.action)
  }

  if (rule.requiresReason === true && (context.reason == null || context.reason.trim() === '')) {
    throw new TransitionError(
      'REASON_REQUIRED',
      `${rule.id}: ${context.action} requires a reason`,
      context.status,
      context.action,
    )
  }

  /*
   * No unattributed failure. The domain refuses to construct the transition without a fault
   * party, and the database refuses to store the resulting row without one — the two together are
   * what make this an approved decision rather than a convention a busy ops interface can skip.
   */
  if (FAULT_REQUIRED_TARGETS.has(rule.to) && context.faultParty == null) {
    throw new TransitionError(
      'FAULT_REQUIRED',
      `${rule.id}: moving an order to ${rule.to} requires a fault party. ` +
        'An unattributed failure is one nobody learns from.',
      context.status,
      context.action,
    )
  }

  return {
    from: context.status,
    to: rule.to,
    effects: rule.effects,
    idempotent: false,
    faultParty: context.faultParty ?? null,
    reason: context.reason ?? null,
  }
}

/** Every action legal from a state, for building an ops or farmer UI without guessing. */
export function availableActions(
  status: OrderStatus,
  actor: OrderActorRole,
): readonly OrderAction[] {
  return RULES.filter((rule) => rule.from.includes(status) && rule.actors.includes(actor)).map(
    (rule) => rule.action,
  )
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.has(status)
}
