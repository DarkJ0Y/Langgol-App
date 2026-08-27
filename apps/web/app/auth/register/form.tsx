'use client'

import { useActionState } from 'react'
import {
  Alert,
  Button,
  Choice,
  FormField,
  Input,
  LinkButton,
  PhoneInput,
} from '@langgol/ui/components'
import { registerAction } from '@/app/actions/auth'
import { idleActionState } from '@/app/actions/state'

export interface RegisterFormLabels {
  readonly phone: string
  readonly phoneHint: string
  readonly phonePlaceholder: string
  readonly name: string
  readonly nameHint: string
  readonly roleLabel: string
  readonly submit: string
  readonly loading: string
  readonly signIn: string
  readonly phoneInvalid: string
  readonly phoneEmpty: string
  readonly nameEmpty: string
  readonly notAllowed: string
  readonly rateLimited: string
  readonly smsUnavailable: string
  readonly unexpected: string
}

export interface RoleChoice {
  readonly value: string
  readonly label: string
}

/**
 * Registration: name and role BEFORE the code.
 *
 * The order is the whole design. Verifying first and asking afterwards needs somewhere to keep
 * the half-made account while the questions are answered — a session a brand-new user has not
 * got, or a user row with no name and no role, which nothing else in the system expects. Asking
 * first means the account is created complete, in one write, or not at all.
 *
 * The role is a radio group with **nothing pre-selected**. A default would mean most people
 * register as whatever happened to be first in the list, and role decides which half of the
 * product somebody sees.
 *
 * Refs: docs/07_SECURITY.md §3.1
 */
export function RegisterForm({
  labels,
  roles,
}: {
  labels: RegisterFormLabels
  roles: readonly RoleChoice[]
}) {
  const [state, formAction, pending] = useActionState(registerAction, idleActionState)

  const error =
    state.status !== 'error'
      ? undefined
      : state.errorKey === 'errors.phoneEmpty'
        ? labels.phoneEmpty
        : state.errorKey === 'errors.phoneInvalid'
          ? labels.phoneInvalid
          : state.errorKey === 'errors.nameEmpty'
            ? labels.nameEmpty
            : state.errorKey === 'errors.rateLimited'
              ? labels.rateLimited
              : state.errorKey === 'errors.smsUnavailable'
                ? labels.smsUnavailable
                : state.errorKey === 'errors.notAllowed'
                  ? labels.notAllowed
                  : labels.unexpected

  /** Show the message beside its field when we know which one, and at the top otherwise. */
  const errorFor = (field: string) =>
    state.status === 'error' && state.field === field && error !== undefined ? { error } : {}

  const unplaced =
    error !== undefined && (state.status !== 'error' || state.field === undefined) ? error : null

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {unplaced === null ? null : <Alert tone="error">{unplaced}</Alert>}

      <FormField id="fullName" label={labels.name} hint={labels.nameHint} {...errorFor('fullName')}>
        {({ describedBy, invalid }) => (
          <Input
            id="fullName"
            name="fullName"
            required
            autoFocus
            maxLength={120}
            autoComplete="name"
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <FormField id="phone" label={labels.phone} hint={labels.phoneHint} {...errorFor('phone')}>
        {({ describedBy, invalid }) => (
          <PhoneInput
            id="phone"
            name="phone"
            required
            placeholder={labels.phonePlaceholder}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      {/*
        Nothing is `defaultChecked`. Role decides which half of the product a person sees, and a
        pre-selected option is a choice the platform made and then attributed to them.
      */}
      <fieldset className="lg-stack-tight" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="lg-label">{labels.roleLabel}</legend>
        {roles.map((role) => (
          <Choice key={role.value} name="role" value={role.value} label={role.label} />
        ))}
      </fieldset>

      <Button type="submit" loading={pending}>
        {pending ? labels.loading : labels.submit}
      </Button>

      <LinkButton href="/auth/phone" variant="ghost">
        {labels.signIn}
      </LinkButton>
    </form>
  )
}
