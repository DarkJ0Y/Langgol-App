import type { Clock } from '@langgol/application'

/** The real clock. Injected everywhere so use cases stay testable at a boundary. */
export const systemClock: Clock = {
  now: () => new Date(),
}

/** A clock frozen at a fixed instant. Tests and deterministic replays only. */
export function fixedClock(at: Date): Clock {
  return { now: () => at }
}
