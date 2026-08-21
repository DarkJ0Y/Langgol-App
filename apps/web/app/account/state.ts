/**
 * Account action result shape.
 *
 * Lives outside the `'use server'` module because such a file may export only async functions —
 * a constant or a value there is a runtime error, not a lint warning. Same reason and same shape
 * as `app/actions/state.ts`, with a success notice added: the account forms have something to say
 * when they succeed, whereas the auth forms navigate away.
 */

import type { MessageKey } from '@langgol/i18n'

export interface AccountActionState {
  readonly status: 'idle' | 'ok' | 'error'
  /** A message KEY, not a message — the client renders it in the reader's language. */
  readonly errorKey?: MessageKey | undefined
  readonly noticeKey?: MessageKey | undefined
  /**
   * Interpolation values for an error message — currently only the seconds in a rate-limit
   * notice, which is the one number a form genuinely cannot know before submitting.
   */
  readonly errorValues?: Record<string, string | number> | undefined
  readonly field?: string | undefined
}

export const idleAccountState: AccountActionState = { status: 'idle' }
