'use client'

import { useActionState } from 'react'
import { Alert, Button, Choice } from '@langgol/ui/components'
import { idleActionState, selectRoleAction } from '@/app/actions/auth'

export interface RoleOption {
  readonly value: string
  readonly label: string
  readonly selected: boolean
}

export function RoleForm({
  roles,
  submitLabel,
  loadingLabel,
  errorLabel,
}: {
  roles: readonly RoleOption[]
  submitLabel: string
  loadingLabel: string
  errorLabel: string
}) {
  const [state, formAction, pending] = useActionState(selectRoleAction, idleActionState)
  const firstSelected = roles.findIndex((role) => role.selected)

  return (
    <form action={formAction} className="lg-stack">
      {state.status === 'error' ? <Alert tone="error">{errorLabel}</Alert> : null}

      <fieldset className="lg-stack-tight" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="lg-visually-hidden">{submitLabel}</legend>
        {roles.map((role, index) => (
          <Choice
            key={role.value}
            name="role"
            value={role.value}
            label={role.label}
            defaultChecked={firstSelected === -1 ? index === 0 : role.selected}
          />
        ))}
      </fieldset>

      <Button type="submit" loading={pending}>
        {pending ? loadingLabel : submitLabel}
      </Button>
    </form>
  )
}
