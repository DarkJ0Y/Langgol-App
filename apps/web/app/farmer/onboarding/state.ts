/**
 * Farmer onboarding action result shape.
 *
 * Outside the `'use server'` module because such a file may export only async functions. Same
 * shape as the address, account and consent states, so every form in the app behaves identically.
 */

import type { MessageKey } from '@langgol/i18n'

export interface FarmerActionState {
  readonly status: 'idle' | 'ok' | 'error'
  /** A message KEY, not a message — the client renders it in the reader's language. */
  readonly errorKey?: MessageKey | undefined
  readonly field?: string | undefined
}

export const idleFarmerState: FarmerActionState = { status: 'idle' }
