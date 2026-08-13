/**
 * Order state machine tests.
 *
 * The transition table in docs/05_ORDER_SYSTEM.md §3 is the specification, and this suite is its
 * executable form. Three properties matter more than the rest:
 *
 *  - **no unattributed failure** — every route into CANCELLED, FAILED or REFUNDED demands a fault
 *    party, in the domain as well as in the database;
 *  - **delivery must be proved** — a courier cannot mark an order delivered and trigger
 *    settlement without OTP or photo evidence;
 *  - **replays are idempotent** — a retry on a flaky connection is normal operation here, not an
 *    error the buyer should ever see.
 */

import { describe, expect, it } from 'vitest'
import {
  availableActions,
  isTerminal,
  transition,
  TransitionError,
  type OrderStatus,
  type TransitionContext,
} from './transition.js'

const NOW = new Date('2026-08-13T10:00:00.000Z')
const DEADLINE = new Date('2026-08-13T12:00:00.000Z')

function context(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    status: 'PENDING',
    action: 'ACCEPT',
    actor: 'FARMER',
    now: NOW,
    acceptanceDeadline: DEADLINE,
    fulfilmentMode: 'LANGGOL_DELIVERY',
    ...overrides,
  }
}

describe('the happy path, end to end', () => {
  it('walks PENDING → CONFIRMED → PREPARING → READY → IN_TRANSIT → DELIVERED → COMPLETED', () => {
    const accepted = transition(context())
    expect(accepted.to).toBe('CONFIRMED')
    expect(accepted.effects).toContain('COMMIT_RESERVATION')

    const preparing = transition(context({ status: 'CONFIRMED', action: 'START_PREPARING' }))
    expect(preparing.to).toBe('PREPARING')

    const ready = transition(
      context({ status: 'PREPARING', action: 'MARK_READY', actualQuantityRecorded: true }),
    )
    expect(ready.to).toBe('READY_FOR_PICKUP')
    expect(ready.effects).toContain('CREATE_DELIVERY')

    const transit = transition(
      context({ status: 'READY_FOR_PICKUP', action: 'PICK_UP', actor: 'OPS_AGENT' }),
    )
    expect(transit.to).toBe('IN_TRANSIT')
    expect(transit.effects).toContain('GENERATE_DELIVERY_OTP')

    const delivered = transition(
      context({
        status: 'IN_TRANSIT',
        action: 'CONFIRM_DELIVERY',
        actor: 'OPS_AGENT',
        deliveryProofVerified: true,
      }),
    )
    expect(delivered.to).toBe('DELIVERED')
    expect(delivered.effects).toContain('POST_GOODS_DELIVERED')
    expect(delivered.effects).toContain('CAPTURE_PAYMENT')

    const completed = transition(
      context({
        status: 'DELIVERED',
        action: 'COMPLETE',
        actor: 'SYSTEM',
        deliveredAt: new Date(NOW.getTime() - 49 * 3_600_000),
        reviewWindowHours: 48,
      }),
    )
    expect(completed.to).toBe('COMPLETED')
    expect(completed.effects).toContain('MARK_SETTLEABLE')
  })

  it('lets a pickup order go straight from ready to delivered', () => {
    const result = transition(
      context({
        status: 'READY_FOR_PICKUP',
        action: 'CONFIRM_DELIVERY',
        actor: 'FARMER',
        fulfilmentMode: 'BUYER_PICKUP',
        deliveryProofVerified: true,
      }),
    )
    expect(result.to).toBe('DELIVERED')
  })
})

describe('no unattributed failure — the approved decision, enforced', () => {
  const routesToFailure: [OrderStatus, TransitionContext['action'], TransitionContext['actor']][] =
    [
      ['PENDING', 'REJECT', 'FARMER'],
      ['PENDING', 'EXPIRE', 'SYSTEM'],
      ['PENDING', 'CANCEL', 'BUYER'],
      ['CONFIRMED', 'CANCEL', 'BUYER'],
      ['PREPARING', 'CANCEL', 'ADMIN'],
      ['IN_TRANSIT', 'FAIL_DELIVERY', 'OPS_AGENT'],
      ['CANCELLED', 'REFUND', 'SYSTEM'],
      ['DISPUTED', 'RESOLVE_DISPUTE_REFUND', 'ADMIN'],
    ]

  for (const [status, action, actor] of routesToFailure) {
    it(`${status} --${action}--> refuses without a fault party`, () => {
      expect(() =>
        transition(
          context({
            status,
            action,
            actor,
            reason: 'a reason',
            now: new Date(DEADLINE.getTime() + 1000),
            deliveredAt: NOW,
            disputeWindowHours: 72,
          }),
        ),
      ).toThrow(expect.objectContaining({ code: 'FAULT_REQUIRED' }))
    })

    it(`${status} --${action}--> succeeds once fault is attributed`, () => {
      const result = transition(
        context({
          status,
          action,
          actor,
          reason: 'a reason',
          faultParty: 'SELLER',
          now: new Date(DEADLINE.getTime() + 1000),
          deliveredAt: NOW,
          disputeWindowHours: 72,
        }),
      )
      expect(['CANCELLED', 'FAILED', 'REFUNDED']).toContain(result.to)
      expect(result.faultParty).toBe('SELLER')
    })
  }
})

describe('delivery must be proved, not asserted', () => {
  it('refuses to confirm delivery without OTP or photo proof', () => {
    expect(() =>
      transition(context({ status: 'IN_TRANSIT', action: 'CONFIRM_DELIVERY', actor: 'OPS_AGENT' })),
    ).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
  })

  it('refuses to mark ready before the packed quantity is recorded', () => {
    // Fresh produce delivered rarely equals fresh produce ordered; the figure must be captured.
    expect(() => transition(context({ status: 'PREPARING', action: 'MARK_READY' }))).toThrow(
      expect.objectContaining({ code: 'GUARD_FAILED' }),
    )
  })

  it('refuses to put a pickup order in transit', () => {
    expect(() =>
      transition(
        context({
          status: 'READY_FOR_PICKUP',
          action: 'PICK_UP',
          actor: 'OPS_AGENT',
          fulfilmentMode: 'BUYER_PICKUP',
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
  })
})

describe('windows and deadlines', () => {
  it('refuses a farmer acceptance after the window closes', () => {
    expect(() => transition(context({ now: new Date(DEADLINE.getTime() + 1000) }))).toThrow(
      expect.objectContaining({ code: 'GUARD_FAILED' }),
    )
  })

  it('lets an admin accept late — an ops override is a real need', () => {
    const result = transition(context({ actor: 'ADMIN', now: new Date(DEADLINE.getTime() + 1000) }))
    expect(result.to).toBe('CONFIRMED')
  })

  it('refuses to expire an order before its deadline', () => {
    expect(() =>
      transition(context({ action: 'EXPIRE', actor: 'SYSTEM', faultParty: 'SELLER' })),
    ).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
  })

  it('refuses auto-completion before the review window elapses', () => {
    expect(() =>
      transition(
        context({
          status: 'DELIVERED',
          action: 'COMPLETE',
          actor: 'SYSTEM',
          deliveredAt: new Date(NOW.getTime() - 1 * 3_600_000),
          reviewWindowHours: 48,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
  })

  it('refuses a dispute opened after the window closes', () => {
    expect(() =>
      transition(
        context({
          status: 'DELIVERED',
          action: 'OPEN_DISPUTE',
          actor: 'BUYER',
          reason: 'bad quality',
          deliveredAt: new Date(NOW.getTime() - 100 * 3_600_000),
          disputeWindowHours: 72,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'GUARD_FAILED' }))
  })

  it('accepts a dispute inside the window and holds settlement', () => {
    const result = transition(
      context({
        status: 'DELIVERED',
        action: 'OPEN_DISPUTE',
        actor: 'BUYER',
        reason: 'bad quality',
        deliveredAt: new Date(NOW.getTime() - 10 * 3_600_000),
        disputeWindowHours: 72,
      }),
    )
    expect(result.to).toBe('DISPUTED')
    expect(result.effects).toContain('SET_SETTLEMENT_HOLD')
  })
})

describe('actors', () => {
  it('refuses a buyer accepting their own order', () => {
    expect(() => transition(context({ actor: 'BUYER' }))).toThrow(
      expect.objectContaining({ code: 'ACTOR_NOT_PERMITTED' }),
    )
  })

  it('refuses a farmer resolving a dispute', () => {
    expect(() =>
      transition(
        context({
          status: 'DISPUTED',
          action: 'RESOLVE_DISPUTE_NO_REFUND',
          actor: 'FARMER',
          reason: 'x',
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'ACTOR_NOT_PERMITTED' }))
  })

  it('lists the actions available to each actor, so a UI need not guess', () => {
    expect(availableActions('PENDING', 'FARMER')).toEqual(
      expect.arrayContaining(['ACCEPT', 'REJECT', 'CANCEL']),
    )
    expect(availableActions('PENDING', 'BUYER')).toEqual(['CANCEL'])
    expect(availableActions('COMPLETED', 'FARMER')).toEqual([])
  })
})

describe('illegal transitions are refused, not tolerated', () => {
  const illegal: [OrderStatus, TransitionContext['action']][] = [
    ['DELIVERED', 'START_PREPARING'],
    ['COMPLETED', 'CANCEL'],
    ['CANCELLED', 'ACCEPT'],
    ['REFUNDED', 'CONFIRM_DELIVERY'],
    ['PENDING', 'CONFIRM_DELIVERY'],
    ['PENDING', 'COMPLETE'],
  ]

  for (const [status, action] of illegal) {
    it(`${status} --${action}--> is rejected`, () => {
      expect(() =>
        transition(
          context({
            status,
            action,
            actor: 'ADMIN',
            reason: 'x',
            faultParty: 'PLATFORM',
            deliveryProofVerified: true,
          }),
        ),
      ).toThrow(TransitionError)
    })
  }

  it('marks COMPLETED and REFUNDED as terminal', () => {
    expect(isTerminal('COMPLETED')).toBe(true)
    expect(isTerminal('REFUNDED')).toBe(true)
    expect(isTerminal('PENDING')).toBe(false)
  })
})

describe('replays are idempotent — rule 4', () => {
  it('accepting an already-confirmed order succeeds and posts nothing', () => {
    const result = transition(context({ status: 'CONFIRMED', action: 'ACCEPT' }))
    expect(result.idempotent).toBe(true)
    expect(result.to).toBe('CONFIRMED')
    // Crucially: no effects, so a retry cannot double-commit the reservation.
    expect(result.effects).toEqual([])
  })

  it('confirming an already-delivered order does not re-post the ledger', () => {
    const result = transition(
      context({ status: 'DELIVERED', action: 'CONFIRM_DELIVERY', actor: 'OPS_AGENT' }),
    )
    expect(result.idempotent).toBe(true)
    expect(result.effects).not.toContain('POST_GOODS_DELIVERED')
  })
})

describe('reasons', () => {
  it('requires a reason when a farmer rejects', () => {
    expect(() => transition(context({ action: 'REJECT', faultParty: 'SELLER' }))).toThrow(
      expect.objectContaining({ code: 'REASON_REQUIRED' }),
    )
  })

  it('does not require one for the happy path', () => {
    expect(() => transition(context())).not.toThrow()
  })
})
