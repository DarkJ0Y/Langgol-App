/**
 * Consent action result shape.
 *
 * Outside the `'use server'` module, which may export only async functions.
 */

import type { MessageKey } from '@langgol/i18n'

export interface ConsentActionState {
  readonly status: 'idle' | 'ok' | 'error'
  readonly errorKey?: MessageKey | undefined
  readonly noticeKey?: MessageKey | undefined
}

export const idleConsentState: ConsentActionState = { status: 'idle' }
