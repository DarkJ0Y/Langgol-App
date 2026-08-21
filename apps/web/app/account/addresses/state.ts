/**
 * Address action result shape.
 *
 * Outside the `'use server'` module because such a file may export only async functions. Same
 * shape as the account and verification states, so the forms across the app behave identically.
 */

import type { MessageKey } from '@langgol/i18n'

export interface AddressActionState {
  readonly status: 'idle' | 'ok' | 'error'
  /** A message KEY, not a message — the client renders it in the reader's language. */
  readonly errorKey?: MessageKey | undefined
  readonly noticeKey?: MessageKey | undefined
  readonly field?: string | undefined
}

export const idleAddressState: AddressActionState = { status: 'idle' }
