'use client'

import { useActionState } from 'react'
import { Alert, Button, Choice } from '@langgol/ui/components'
import { developmentSignInAction } from '@/app/actions/auth'
import { idleActionState } from '@/app/actions/state'

export interface IdentityOption {
  readonly key: string
  readonly label: string
  readonly description: string
}

export function DevelopmentIdentityForm({
  identities,
  submitLabel,
  loadingLabel,
}: {
  identities: readonly IdentityOption[]
  submitLabel: string
  loadingLabel: string
}) {
  const [state, formAction, pending] = useActionState(developmentSignInAction, idleActionState)

  return (
    <form action={formAction} className="lg-stack">
      {state.status === 'error' ? (
        <Alert tone="error">
          {/* The action returns a message KEY; unknown identities are the only realistic case
              here, and the copy is deliberately plain. */}
          Unknown development identity.
        </Alert>
      ) : null}

      <fieldset className="lg-stack-tight" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="lg-visually-hidden">Development identity</legend>
        {identities.map((identity, index) => (
          <Choice
            key={identity.key}
            name="identityKey"
            value={identity.key}
            label={identity.label}
            description={identity.description}
            defaultChecked={index === 0}
          />
        ))}
      </fieldset>

      <Button type="submit" loading={pending}>
        {pending ? loadingLabel : submitLabel}
      </Button>
    </form>
  )
}
