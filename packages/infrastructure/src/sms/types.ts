import type { E164Phone } from '@langgol/domain/identity'

export interface SmsMessage {
  readonly to: E164Phone
  readonly body: string
  /** Unicode (Bangla) messages fit fewer characters per segment and cost more. */
  readonly unicode: boolean
}

export interface SmsSendResult {
  readonly accepted: boolean
  readonly providerRef?: string
  readonly error?: string
}

/**
 * The SMS boundary.
 *
 * SMS is the reliable channel in rural Bangladesh — it works with no data balance, on any
 * handset, and it is what users actually check. Delivery rates vary by operator and time of day,
 * so every adapter reports enough for per-operator monitoring.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §4
 */
export interface SmsProvider {
  readonly id: string
  send(message: SmsMessage): Promise<SmsSendResult>
}
