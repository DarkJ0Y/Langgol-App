'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, Input } from '@langgol/ui/components'
import { demoPasswordSignInAction } from '@/app/actions/auth'
import { idleActionState } from '@/app/actions/state'

export interface DemoFormLabels {
  readonly email: string
  readonly password: string
  readonly submit: string
  readonly loading: string
  readonly invalid: string
  readonly unexpected: string
}

/** Email and password for the all-features demo account. See lib/demo-login.ts. */
export function DemoLoginForm({ labels }: { labels: DemoFormLabels }) {
  const [state, formAction, pending] = useActionState(demoPasswordSignInAction, idleActionState)

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {state.status === 'error' ? (
        // Only a credential mismatch says "wrong email or password". Anything else — demo data not
        // seeded, an inactive fixture — is a different problem, and saying otherwise sends the
        // reader off retyping a password that was right.
        <Alert tone="error">
          {state.errorKey === 'auth.demoInvalid' ? labels.invalid : labels.unexpected}
        </Alert>
      ) : null}

      <FormField id="demo-email" label={labels.email}>
        {({ describedBy, invalid }) => (
          <Input
            id="demo-email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <FormField id="demo-password" label={labels.password}>
        {({ describedBy, invalid }) => (
          <Input
            id="demo-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
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
