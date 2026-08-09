/**
 * Structured logging.
 *
 * JSON lines with a request correlation id, so one user's journey through the system can be
 * reconstructed from an order id or a request id when something goes wrong at 02:00.
 *
 * Every payload passes through {@link redact} — redaction is not a call-site responsibility,
 * because a rule that depends on remembering is a rule that fails under pressure.
 *
 * Implemented directly rather than on a logging library: the requirement is a JSON line on
 * stdout with mandatory redaction, and owning ~60 lines is cheaper than owning a dependency's
 * redaction semantics on a codebase that handles phone numbers and money.
 *
 * Refs: docs/03_ARCHITECTURE.md §12; docs/07_SECURITY.md §11
 */

import { redact } from './redact.js'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

export interface LogContext {
  readonly requestId?: string
  readonly userId?: string
  readonly route?: string
  readonly [key: string]: unknown
}

export interface Logger {
  trace(message: string, data?: LogContext): void
  debug(message: string, data?: LogContext): void
  info(message: string, data?: LogContext): void
  warn(message: string, data?: LogContext): void
  error(message: string, data?: LogContext): void
  fatal(message: string, data?: LogContext): void
  /** A logger that carries fixed context — typically one request. */
  child(context: LogContext): Logger
}

export interface LogRecord {
  readonly level: LogLevel
  readonly time: string
  readonly message: string
  readonly [key: string]: unknown
}

export type LogSink = (record: LogRecord) => void

export interface LoggerOptions {
  readonly level?: LogLevel
  readonly base?: LogContext
  readonly sink?: LogSink
  readonly now?: () => Date
}

const defaultSink: LogSink = (record) => {
  const line = JSON.stringify(record)
  if (LEVEL_ORDER[record.level] >= LEVEL_ORDER.error) {
    process.stderr.write(`${line}\n`)
  } else {
    process.stdout.write(`${line}\n`)
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minimum = LEVEL_ORDER[options.level ?? 'info']
  const sink = options.sink ?? defaultSink
  const now = options.now ?? (() => new Date())
  const base = options.base ?? {}

  const emit = (level: LogLevel, message: string, data?: LogContext): void => {
    if (LEVEL_ORDER[level] < minimum) return
    const merged = { ...base, ...(data ?? {}) }
    const safe = redact(merged) as Record<string, unknown>
    sink({ level, time: now().toISOString(), message, ...safe })
  }

  return {
    trace: (message, data) => {
      emit('trace', message, data)
    },
    debug: (message, data) => {
      emit('debug', message, data)
    },
    info: (message, data) => {
      emit('info', message, data)
    },
    warn: (message, data) => {
      emit('warn', message, data)
    },
    error: (message, data) => {
      emit('error', message, data)
    },
    fatal: (message, data) => {
      emit('fatal', message, data)
    },
    child: (context) =>
      createLogger({
        ...options,
        level: options.level ?? 'info',
        base: { ...base, ...context },
      }),
  }
}

/* --------------------------------------------------------------- error reporting */

export interface ErrorReport {
  readonly error: Error
  readonly context?: LogContext
  readonly level?: 'error' | 'fatal'
}

/**
 * Error reporting boundary.
 *
 * A vendor SDK plugs in here. The abstraction exists from day one so that adding one later is a
 * dependency decision rather than a code change across every catch block — and so that the
 * redaction rules above apply to reported errors too, which a vendor SDK will not do for us.
 */
export interface ErrorReporter {
  report(report: ErrorReport): void
}

/** Routes errors to the logger. The default when no vendor DSN is configured. */
export function createLoggingErrorReporter(logger: Logger): ErrorReporter {
  return {
    report({ error, context, level }) {
      const method = level === 'fatal' ? logger.fatal : logger.error
      method(error.message, { ...(context ?? {}), errorName: error.name, stack: error.stack })
    },
  }
}

/** Discards reports. Tests only. */
export const noopErrorReporter: ErrorReporter = {
  report() {
    /* intentionally empty */
  },
}
