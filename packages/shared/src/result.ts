/**
 * Result type.
 *
 * Expected failures — a stale quote, insufficient stock, an unauthorised actor — are values, not
 * exceptions. Exceptions are reserved for genuine faults (a bug, a lost database connection).
 * The distinction matters because expected failures must be handled at the call site, and a
 * type the compiler checks is a better reminder than a comment.
 */

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export type Result<T, E> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

/** Unwrap, throwing if the result is an error. Use in tests and at trusted boundaries only. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value
  throw new Error(`Attempted to unwrap an error result: ${JSON.stringify(result.error)}`)
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result
}
