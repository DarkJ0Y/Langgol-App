'use client'

import { useActionState } from 'react'
import { Alert, Button, LinkButton } from '@langgol/ui/components'
import { sendEmailLinkAction } from './verify-actions'
import { idleAccountState } from './state'

export interface VerificationPanelLabels {
  readonly phoneVerified: string
  readonly phoneUnverified: string
  readonly verifyPhone: string
  readonly emailOptional: string
  readonly emailVerified: string
  readonly emailUnverified: string
  readonly emailSend: string
  readonly emailSent: string
  readonly emailUnavailable: string
  readonly loading: string
  /** Carries `{seconds}`; substituted here rather than shipping the translator to the client. */
  readonly rateLimited: string
  readonly unexpected: string
}

/**
 * Verification state, and a nudge where one is useful.
 *
 * The email half is a **reminder, never a gate**. It renders only when there is an address to
 * confirm and a provider able to send to it; with no address, no provider, or a confirmed
 * address, there is nothing here to do and nothing is shown. Signup and login are by phone, so
 * an account that never touches this panel is a complete account.
 */
export function VerificationPanel({
  phoneVerified,
  email,
  emailVerified,
  emailAvailable,
  labels,
}: {
  phoneVerified: boolean
  /** Already masked by the server. The full address is not sent to the browser. */
  email: string | null
  emailVerified: boolean
  emailAvailable: boolean
  labels: VerificationPanelLabels
}) {
  const [state, action, pending] = useActionState(sendEmailLinkAction, idleAccountState)

  const message =
    state.status === 'ok'
      ? {
          tone: 'success' as const,
          text:
            state.noticeKey === 'verify.emailVerified' ? labels.emailVerified : labels.emailSent,
        }
      : state.status === 'error'
        ? {
            tone: 'error' as const,
            text:
              state.errorKey === 'errors.rateLimited'
                ? labels.rateLimited.replace(
                    '{seconds}',
                    String(state.errorValues?.['seconds'] ?? 60),
                  )
                : state.errorKey === 'verify.emailUnavailable'
                  ? labels.emailUnavailable
                  : labels.unexpected,
          }
        : null

  return (
    <div className="lg-stack">
      {phoneVerified ? (
        <Alert tone="success">{labels.phoneVerified}</Alert>
      ) : (
        <>
          <Alert tone="warning">{labels.phoneUnverified}</Alert>
          <LinkButton href="/account/verify-phone">{labels.verifyPhone}</LinkButton>
        </>
      )}

      {/* Nothing to say when there is no address, or nowhere to send to. */}
      {email === null ? (
        <p className="lg-subtitle">{labels.emailOptional}</p>
      ) : emailVerified ? (
        <Alert tone="success">{labels.emailVerified}</Alert>
      ) : !emailAvailable ? null : (
        <form action={action} className="lg-stack">
          {message === null ? null : <Alert tone={message.tone}>{message.text}</Alert>}
          <Alert tone="info">{labels.emailUnverified}</Alert>
          <Button type="submit" variant="secondary" loading={pending}>
            {pending ? labels.loading : labels.emailSend}
          </Button>
        </form>
      )}
    </div>
  )
}
