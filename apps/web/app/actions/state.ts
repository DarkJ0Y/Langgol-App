/**
 * Server-action result shape.
 *
 * Lives outside the `'use server'` module because such a file may export only async functions —
 * a constant or a type there is a runtime error, not a lint warning.
 */

import type { MessageKey } from '@langgol/i18n'

export interface ActionState {
  readonly status: 'idle' | 'error'
  /** A message KEY, not a message — the client renders it in the reader's language. */
  readonly errorKey?: MessageKey | undefined
  readonly errorValues?: Record<string, string | number> | undefined
  readonly field?: string | undefined
}

export const idleActionState: ActionState = { status: 'idle' }
