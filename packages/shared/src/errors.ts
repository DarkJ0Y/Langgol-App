/**
 * Application error vocabulary.
 *
 * Every failure that crosses a layer boundary is one of these. A typed error is what lets the
 * interface layer decide the HTTP status, the log level and the user-facing message without
 * string-matching on a message.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PRECONDITION_FAILED'
  | 'CONFIG_NOT_SET'
  | 'PROVIDER_UNAVAILABLE'
  | 'INTERNAL'

export interface AppErrorOptions {
  readonly detail?: string
  readonly cause?: unknown
  /** Safe to show a user. Anything else is for logs only. */
  readonly userFacing?: boolean
  readonly meta?: Readonly<Record<string, string | number | boolean>>
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly detail: string | undefined
  readonly userFacing: boolean
  readonly meta: Readonly<Record<string, string | number | boolean>>

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.detail = options.detail
    this.userFacing = options.userFacing ?? false
    this.meta = options.meta ?? {}
  }
}

export const Errors = {
  unauthenticated: (detail?: string) =>
    new AppError('UNAUTHENTICATED', 'Authentication required', { ...(detail ? { detail } : {}) }),

  /**
   * Deliberately indistinguishable from "not found" at the boundary. A 403 confirms that a
   * resource exists, which is itself a disclosure. docs/07_SECURITY.md §4.4
   */
  forbidden: (detail?: string) =>
    new AppError('FORBIDDEN', 'Not permitted', { ...(detail ? { detail } : {}) }),

  notFound: (what: string) => new AppError('NOT_FOUND', `${what} not found`),

  validation: (message: string, meta?: Record<string, string | number | boolean>) =>
    new AppError('VALIDATION_FAILED', message, { userFacing: true, ...(meta ? { meta } : {}) }),

  conflict: (message: string) => new AppError('CONFLICT', message),

  rateLimited: (retryAfterSeconds: number) =>
    new AppError('RATE_LIMITED', 'Too many requests', {
      userFacing: true,
      meta: { retryAfterSeconds },
    }),

  preconditionFailed: (message: string) => new AppError('PRECONDITION_FAILED', message),

  configNotSet: (key: string) =>
    new AppError('CONFIG_NOT_SET', `Platform configuration "${key}" is not set`, {
      detail:
        'This value is an open product decision. The operation refuses to proceed rather than ' +
        'assume a business parameter.',
      meta: { key },
    }),

  providerUnavailable: (provider: string, cause?: unknown) =>
    new AppError('PROVIDER_UNAVAILABLE', `${provider} is unavailable`, {
      ...(cause === undefined ? {} : { cause }),
      meta: { provider },
    }),

  internal: (message: string, cause?: unknown) =>
    new AppError('INTERNAL', message, { ...(cause === undefined ? {} : { cause }) }),
} as const
