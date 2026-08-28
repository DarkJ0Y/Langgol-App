/**
 * Farm and plot action results.
 *
 * Outside the `'use server'` module because such a file may export only async functions. Same
 * shape as every other form state in the app, so the screens behave identically.
 */

import type { MessageKey } from '@langgol/i18n'

export interface FarmActionState {
  readonly status: 'idle' | 'ok' | 'error'
  readonly errorKey?: MessageKey | undefined
  readonly field?: string | undefined
}

export const idleFarmState: FarmActionState = { status: 'idle' }
