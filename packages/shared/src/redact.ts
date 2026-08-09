/**
 * Log redaction.
 *
 * Langgol logs must never carry an OTP, a session token, a payment secret, or personal data that
 * is not needed. That is a hard rule in docs/07_SECURITY.md §11 — and a rule enforced only by
 * developer discipline is a rule that fails on the day someone is debugging at 02:00 and adds
 * `logger.info({ user })`.
 *
 * So redaction is applied by the logger to EVERY payload, by key name and by value shape, rather
 * than being remembered at each call site. Over-redaction is the intended failure mode: a
 * `[redacted]` in a log line costs a few minutes, a leaked phone number costs a user.
 *
 * Refs: docs/07_SECURITY.md §9, §11
 */

export const REDACTED = '[redacted]'

/**
 * Key names whose values are removed wherever they appear, at any depth.
 * Matched case-insensitively against the key's word segments.
 */
const SENSITIVE_KEYS = new Set([
  'code',
  'otp',
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'session',
  'apikey',
  'key',
  'credential',
  'signature',
  'nid',
  'pin',
  'cvv',
  'payout',
  'account',
])

/** Keys that are personal data: masked rather than removed, so a log stays diagnosable. */
const MASKED_KEYS = new Set(['phone', 'mobile', 'msisdn', 'email', 'recipientphone'])

function segments(name: string): string[] {
  return name
    .split(/[._\-\s]+/)
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/\s+/))
    .map((part) => part.toLowerCase())
    .filter(Boolean)
}

function isSensitiveKey(name: string): boolean {
  return segments(name).some((segment) => SENSITIVE_KEYS.has(segment))
}

function isMaskedKey(name: string): boolean {
  const parts = segments(name)
  return parts.some((segment) => MASKED_KEYS.has(segment)) || MASKED_KEYS.has(name.toLowerCase())
}

/** `+8801712345678` → `+880171****5678`; `someone@example.com` → `s****@example.com`. */
export function maskValue(value: string): string {
  if (value.includes('@')) {
    const [local = '', domain = ''] = value.split('@')
    return `${local.slice(0, 1)}****@${domain}`
  }
  if (value.length < 8) return REDACTED
  return `${value.slice(0, 7)}****${value.slice(-4)}`
}

/** Values that look like a secret regardless of the key they arrived under. */
function looksLikeSecret(value: string): boolean {
  // A bare Bangladeshi phone number, however it was labelled.
  if (/^\+?8801[3-9][0-9]{8}$/.test(value.replace(/[\s-]/g, ''))) return true
  // Our scrypt hash format.
  if (value.startsWith('scrypt$')) return true
  // A bearer token.
  if (/^Bearer\s+\S+/i.test(value)) return true
  return false
}

/**
 * Redact an arbitrary log payload.
 *
 * Handles cycles, keeps errors readable (message and name survive; a stack is kept but never
 * a `cause` payload), and leaves ordinary diagnostic values alone.
 */
export function redact(input: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (input === null || input === undefined) return input

  if (typeof input === 'bigint') return input.toString()

  if (typeof input === 'string') {
    return looksLikeSecret(input) ? maskValue(input) : input
  }

  if (typeof input !== 'object') return input

  if (input instanceof Date) return input.toISOString()

  if (input instanceof Error) {
    return { name: input.name, message: input.message }
  }

  if (seen.has(input)) return '[circular]'
  seen.add(input)

  if (Array.isArray(input)) {
    return input.map((item) => redact(item, seen))
  }

  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveKey(key)) {
      output[key] = REDACTED
      continue
    }
    if (isMaskedKey(key) && typeof value === 'string') {
      output[key] = maskValue(value)
      continue
    }
    output[key] = redact(value, seen)
  }
  return output
}
