'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, Input, Select } from '@langgol/ui/components'
import { assignRoleAction, removeRoleAction } from './actions'
import { idleAccountState, type AccountActionState } from './state'
import type { Option } from './profile-form'

export interface RoleAdminLabels {
  readonly user: string
  readonly role: string
  readonly reason: string
  readonly assign: string
  readonly remove: string
  readonly loading: string
  readonly roleAdded: string
  readonly roleAlreadyHeld: string
  readonly roleRemoved: string
  readonly roleNotHeld: string
  readonly errorReasonRequired: string
  readonly errorCannotRemoveOwn: string
  readonly errorNotAllowed: string
  readonly errorUnexpected: string
}

/**
 * Grant and revoke roles.
 *
 * Rendered only for an actor the policy engine says may administer roles — but that is a
 * courtesy, not the control. Both actions authorize independently and audit a refusal, so this
 * component being on screen proves nothing and its absence prevents nothing.
 *
 * Removal asks for a reason in the same submit as the role, because a revocation without one is
 * refused by the use case AND by a database CHECK. Making the field optional here would only
 * teach an administrator to expect an error.
 */
export function RoleAdmin({
  roles,
  labels,
}: {
  roles: readonly Option[]
  labels: RoleAdminLabels
}) {
  const [assignState, assignAction, assigning] = useActionState(assignRoleAction, idleAccountState)
  const [removeState, removeAction, removing] = useActionState(removeRoleAction, idleAccountState)

  const describe = (
    state: AccountActionState,
  ): { tone: 'success' | 'error'; text: string } | null => {
    if (state.status === 'ok') {
      const text =
        state.noticeKey === 'account.roleAdded'
          ? labels.roleAdded
          : state.noticeKey === 'account.roleAlreadyHeld'
            ? labels.roleAlreadyHeld
            : state.noticeKey === 'account.roleRemoved'
              ? labels.roleRemoved
              : labels.roleNotHeld
      return { tone: 'success', text }
    }

    if (state.status === 'error') {
      const text =
        state.errorKey === 'errors.reasonRequired'
          ? labels.errorReasonRequired
          : state.errorKey === 'errors.cannotRemoveOwnRole'
            ? labels.errorCannotRemoveOwn
            : state.errorKey === 'errors.notAllowed'
              ? labels.errorNotAllowed
              : labels.errorUnexpected
      return { tone: 'error', text }
    }

    return null
  }

  const assignMessage = describe(assignState)
  const removeMessage = describe(removeState)

  return (
    <div className="lg-stack">
      <form action={assignAction} className="lg-stack" noValidate>
        {assignMessage === null ? null : (
          <Alert tone={assignMessage.tone}>{assignMessage.text}</Alert>
        )}

        <FormField id="assign-user" label={labels.user}>
          {({ describedBy }) => (
            <Input
              id="assign-user"
              name="userId"
              required
              inputMode="text"
              autoComplete="off"
              describedBy={describedBy}
            />
          )}
        </FormField>

        <FormField id="assign-role" label={labels.role}>
          {({ describedBy }) => (
            <Select id="assign-role" name="role" required describedBy={describedBy}>
              {roles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <Button type="submit" loading={assigning}>
          {assigning ? labels.loading : labels.assign}
        </Button>
      </form>

      <form action={removeAction} className="lg-stack" noValidate>
        {removeMessage === null ? null : (
          <Alert tone={removeMessage.tone}>{removeMessage.text}</Alert>
        )}

        <FormField id="remove-user" label={labels.user}>
          {({ describedBy }) => (
            <Input
              id="remove-user"
              name="userId"
              required
              inputMode="text"
              autoComplete="off"
              describedBy={describedBy}
            />
          )}
        </FormField>

        <FormField id="remove-role" label={labels.role}>
          {({ describedBy }) => (
            <Select id="remove-role" name="role" required describedBy={describedBy}>
              {roles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>

        <FormField
          id="remove-reason"
          label={labels.reason}
          {...(removeState.status === 'error' && removeState.field === 'reason'
            ? { error: labels.errorReasonRequired }
            : {})}
        >
          {({ describedBy, invalid }) => (
            <Input
              id="remove-reason"
              name="reason"
              required
              maxLength={500}
              describedBy={describedBy}
              invalid={invalid}
            />
          )}
        </FormField>

        <Button type="submit" variant="secondary" loading={removing}>
          {removing ? labels.loading : labels.remove}
        </Button>
      </form>
    </div>
  )
}
