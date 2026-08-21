'use client'

import { useActionState } from 'react'
import { Alert, Button, FormField, Input, Select } from '@langgol/ui/components'
import { updateProfileAction } from './actions'
import { idleAccountState } from './state'

export interface Option {
  readonly value: string
  readonly label: string
}

/**
 * Every string this form can display, resolved on the server.
 *
 * The translator stays out of the client bundle: shipping both catalogues to a phone on a slow
 * connection to render six labels is not a trade worth making.
 */
export interface ProfileFormLabels {
  readonly name: string
  readonly phone: string
  readonly phoneLocked: string
  readonly email: string
  readonly emailHint: string
  readonly dateOfBirth: string
  readonly gender: string
  readonly genderUnset: string
  readonly language: string
  readonly submit: string
  readonly loading: string
  readonly saved: string
  readonly errorNameEmpty: string
  readonly errorNameTooLong: string
  readonly errorEmailInvalid: string
  readonly errorDateInvalid: string
  readonly errorUnderage: string
  readonly errorNotAllowed: string
  readonly errorUnexpected: string
}

export interface ProfileDefaults {
  readonly fullName: string
  readonly email: string
  readonly preferredLanguage: string
  readonly dateOfBirth: string
  readonly gender: string
}

/**
 * The profile form.
 *
 * The phone number is shown but disabled: it is the authentication identifier, so changing it is
 * an OTP flow of its own rather than a profile edit. Rendering it read-only is clearer than
 * hiding it — the user can confirm the number they sign in with, and understand why it is fixed.
 */
export function ProfileForm({
  defaults,
  phone,
  languages,
  genders,
  labels,
}: {
  defaults: ProfileDefaults
  phone: string
  languages: readonly Option[]
  genders: readonly Option[]
  labels: ProfileFormLabels
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, idleAccountState)

  const message =
    state.status !== 'error'
      ? undefined
      : state.errorKey === 'errors.nameEmpty'
        ? labels.errorNameEmpty
        : state.errorKey === 'errors.nameTooLong'
          ? labels.errorNameTooLong
          : state.errorKey === 'errors.emailInvalid'
            ? labels.errorEmailInvalid
            : state.errorKey === 'errors.dateInvalid'
              ? labels.errorDateInvalid
              : state.errorKey === 'errors.dateOfBirthUnderage'
                ? labels.errorUnderage
                : state.errorKey === 'errors.notAllowed'
                  ? labels.errorNotAllowed
                  : labels.errorUnexpected

  /** An error belongs beside its field when we know which one; otherwise at the top. */
  const fieldError = (field: string) =>
    message !== undefined && state.field === field ? { error: message } : {}

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {message !== undefined && state.field === undefined ? (
        <Alert tone="error">{message}</Alert>
      ) : null}
      {state.status === 'ok' ? <Alert tone="success">{labels.saved}</Alert> : null}

      <FormField id="fullName" label={labels.name} {...fieldError('fullName')}>
        {({ describedBy, invalid }) => (
          <Input
            id="fullName"
            name="fullName"
            defaultValue={defaults.fullName}
            required
            maxLength={120}
            autoComplete="name"
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <FormField id="phone" label={labels.phone} hint={labels.phoneLocked}>
        {({ describedBy }) => (
          <Input id="phone" name="phone" defaultValue={phone} disabled describedBy={describedBy} />
        )}
      </FormField>

      <FormField id="email" label={labels.email} hint={labels.emailHint} {...fieldError('email')}>
        {({ describedBy, invalid }) => (
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={defaults.email}
            maxLength={254}
            autoComplete="email"
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <FormField id="dateOfBirth" label={labels.dateOfBirth} {...fieldError('dateOfBirth')}>
        {({ describedBy, invalid }) => (
          <Input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={defaults.dateOfBirth}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <FormField id="gender" label={labels.gender}>
        {({ describedBy }) => (
          <Select
            id="gender"
            name="gender"
            defaultValue={defaults.gender}
            describedBy={describedBy}
          >
            {/* Blank means "not answered", which is not the same as declining to say. */}
            <option value="">{labels.genderUnset}</option>
            {genders.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField id="preferredLanguage" label={labels.language}>
        {({ describedBy }) => (
          <Select
            id="preferredLanguage"
            name="preferredLanguage"
            defaultValue={defaults.preferredLanguage}
            describedBy={describedBy}
          >
            {languages.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <Button type="submit" loading={pending}>
        {pending ? labels.loading : labels.submit}
      </Button>
    </form>
  )
}
