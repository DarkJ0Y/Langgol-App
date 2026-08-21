'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, LinkButton, OtpInput } from '@langgol/ui/components'
import { verifyOtpAction } from '@/app/actions/auth'
import { idleActionState } from '@/app/actions/state'

export interface VerifyFormLabels {
  readonly code: string
  readonly submit: string
  readonly loading: string
  readonly resend: string
  readonly invalid: string
  readonly unexpected: string
}

export function VerifyForm({ labels }: { labels: VerifyFormLabels }) {
  const [state, formAction, pending] = useActionState(verifyOtpAction, idleActionState)

  const error =
    state.status !== 'error'
      ? undefined
      : state.errorKey === 'errors.codeInvalid'
        ? labels.invalid
        : labels.unexpected

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {error !== undefined && state.field !== 'code' ? <Alert tone="error">{error}</Alert> : null}

      {/*
        No phone field. The number is carried server-side in an HttpOnly cookie set when the code
        was requested — see lib/otp-handoff.ts. A hidden input here could only ever hold the
        MASKED number the page was given, which is why this used to post "" and every correct code
        came back invalid; and a client-supplied number would let a stolen code be redeemed
        against somebody else's challenge.
      */}
      <FormField
        id="code"
        label={labels.code}
        {...(state.field === 'code' && error !== undefined ? { error } : {})}
      >
        {({ describedBy, invalid }) => (
          <OtpInput
            id="code"
            name="code"
            required
            autoFocus
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <Button type="submit" loading={pending}>
        {pending ? labels.loading : labels.submit}
      </Button>

      <LinkButton href="/auth/phone" variant="ghost">
        {labels.resend}
      </LinkButton>
    </form>
  )
}
