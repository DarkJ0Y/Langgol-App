'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, OtpInput } from '@langgol/ui/components'
import { confirmPhoneCodeAction, sendPhoneCodeAction } from '../verify-actions'
import { idleAccountState, type AccountActionState } from '../state'

export interface VerifyPhoneLabels {
  readonly send: string
  readonly code: string
  readonly confirm: string
  readonly resend: string
  readonly loading: string
  readonly codeSent: string
  readonly verified: string
  /** Carries `{seconds}`; substituted below rather than shipping the translator to the client. */
  readonly rateLimited: string
  readonly invalid: string
  readonly smsUnavailable: string
  readonly notAllowed: string
  readonly unexpected: string
}

/**
 * Request a code, then enter it.
 *
 * Two forms rather than one, so the state of each is independent: a failed code entry must not
 * clear the "we sent it" notice, and tapping resend must not wipe what the user has typed.
 *
 * Nothing here decides whether a resend is allowed. The button stays enabled and the server
 * answers with how many seconds remain — a client-side timer would be both a lie (the clock that
 * matters is the server's) and a control an attacker simply skips.
 */
export function VerifyPhoneForm({ labels }: { labels: VerifyPhoneLabels }) {
  const [sendState, sendAction, sending] = useActionState(sendPhoneCodeAction, idleAccountState)
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmPhoneCodeAction,
    idleAccountState,
  )

  const describe = (state: AccountActionState): string | undefined => {
    if (state.status === 'ok') {
      return state.noticeKey === 'verify.phoneVerified' ? labels.verified : labels.codeSent
    }
    if (state.status !== 'error') return undefined

    switch (state.errorKey) {
      case 'errors.rateLimited':
        // The one message with a runtime number in it. One substitution beats bundling both
        // message catalogues into the client to render a single sentence.
        return labels.rateLimited.replace('{seconds}', String(state.errorValues?.['seconds'] ?? 60))
      case 'errors.codeInvalid':
        return labels.invalid
      case 'errors.smsUnavailable':
        return labels.smsUnavailable
      case 'errors.notAllowed':
        return labels.notAllowed
      default:
        return labels.unexpected
    }
  }

  const sendMessage = describe(sendState)
  const confirmMessage = describe(confirmState)

  return (
    <div className="lg-stack">
      <form action={sendAction} className="lg-stack">
        {sendMessage === undefined ? null : (
          <Alert tone={sendState.status === 'ok' ? 'success' : 'error'}>{sendMessage}</Alert>
        )}
        <Button type="submit" loading={sending}>
          {sending ? labels.loading : sendState.status === 'ok' ? labels.resend : labels.send}
        </Button>
      </form>

      <form action={confirmAction} className="lg-stack" noValidate>
        {confirmMessage !== undefined && confirmState.field !== 'code' ? (
          <Alert tone={confirmState.status === 'ok' ? 'success' : 'error'}>{confirmMessage}</Alert>
        ) : null}

        <FormField
          id="code"
          label={labels.code}
          {...(confirmState.field === 'code' && confirmMessage !== undefined
            ? { error: confirmMessage }
            : {})}
        >
          {({ describedBy, invalid }) => (
            <OtpInput
              id="code"
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              describedBy={describedBy}
              invalid={invalid}
            />
          )}
        </FormField>

        <Button type="submit" loading={confirming}>
          {confirming ? labels.loading : labels.confirm}
        </Button>
      </form>
    </div>
  )
}
