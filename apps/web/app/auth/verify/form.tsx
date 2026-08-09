'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, OtpInput } from '@langgol/ui/components'
import { idleActionState, verifyOtpAction } from '@/app/actions/auth'

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

      {/* The phone is re-submitted rather than held in a session, so the verify step is
          stateless and a reload does not strand the user mid-flow. The server re-normalises it. */}
      <input type="hidden" name="phone" value="" />

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

      <a href="/auth/phone">
        <Button type="button" variant="ghost">
          {labels.resend}
        </Button>
      </a>
    </form>
  )
}
