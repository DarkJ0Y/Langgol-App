'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, PhoneInput } from '@langgol/ui/components'
import { idleActionState, requestOtpAction } from '@/app/actions/auth'

export interface PhoneFormLabels {
  readonly phone: string
  readonly hint: string
  readonly placeholder: string
  readonly submit: string
  readonly loading: string
  readonly invalid: string
  readonly empty: string
  readonly unexpected: string
}

export function PhoneForm({ labels }: { labels: PhoneFormLabels }) {
  const [state, formAction, pending] = useActionState(requestOtpAction, idleActionState)

  const error =
    state.status !== 'error'
      ? undefined
      : state.errorKey === 'errors.phoneEmpty'
        ? labels.empty
        : state.errorKey === 'errors.phoneInvalid'
          ? labels.invalid
          : labels.unexpected

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {error !== undefined && state.field !== 'phone' ? <Alert tone="error">{error}</Alert> : null}

      <FormField
        id="phone"
        label={labels.phone}
        hint={labels.hint}
        {...(state.field === 'phone' && error !== undefined ? { error } : {})}
      >
        {({ describedBy, invalid }) => (
          <PhoneInput
            id="phone"
            name="phone"
            required
            autoFocus
            placeholder={labels.placeholder}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <Button type="submit" loading={pending}>
        {pending ? labels.loading : labels.submit}
      </Button>
    </form>
  )
}
