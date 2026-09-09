/**
 * KYC action result shape.
 *
 * Outside the `'use server'` module because such a file may export only async functions. Same
 * shape as every other form state in the app, so the submit button, the error banner and the
 * pending state all behave identically to the ones a person has already used.
 */

import type { MessageKey } from '@langgol/i18n'

export interface KycActionState {
  readonly status: 'idle' | 'ok' | 'error'
  /** A message KEY, not a message — the client renders it in the reader's language. */
  readonly errorKey?: MessageKey | undefined
  /** Which question the message belongs beside, when the failure was about one. */
  readonly field?: string | undefined
}

export const idleKycState: KycActionState = { status: 'idle' }
