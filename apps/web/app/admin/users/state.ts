/**
 * Back-office action result shape.
 *
 * Outside the `'use server'` module because such a file may export only async functions. Same
 * shape as every other form state in the app.
 */

import type { MessageKey } from '@langgol/i18n'

export interface AdminActionState {
  readonly status: 'idle' | 'ok' | 'error'
  readonly errorKey?: MessageKey | undefined
}

export const idleAdminState: AdminActionState = { status: 'idle' }
