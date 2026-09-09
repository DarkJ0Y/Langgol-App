'use client'

/**
 * The identity submission form.
 *
 * Three questions and two photographs. Everything about it assumes a farmer on a phone on a
 * metered connection, which is why the file inputs ask for a camera capture directly rather than
 * routing through a picker, and why the size limit is stated up front rather than discovered
 * after a failed upload has already cost them the data.
 *
 * The component receives words, never keys: every label and message arrives already in the
 * reader's language, which keeps the catalogue on the server and out of the bundle.
 */

import { useActionState } from 'react'
import { Alert, Button, FormField, Input, Select } from '@langgol/ui/components'
import { submitIdentityAction } from './actions'
import { idleKycState } from './state'
import {
  DOCUMENT_BACK_FIELD,
  DOCUMENT_FRONT_FIELD,
  IDENTITY_NUMBER_FIELD,
  IDENTITY_TYPE_FIELD,
} from './form'

export interface Option {
  readonly value: string
  readonly label: string
}

export interface VerificationFormLabels {
  readonly documentType: string
  readonly number: string
  readonly numberHint: string
  readonly front: string
  readonly back: string
  readonly fileHint: string
  readonly submit: string
  readonly loading: string
  readonly submitted: string
  readonly privacyNote: string
  readonly messages: Readonly<Record<string, string>>
  readonly errorUnexpected: string
}

export function VerificationForm({
  documentTypes,
  accept,
  labels,
}: {
  documentTypes: readonly Option[]
  /** The accept attribute, built from the domain's own allowlist. */
  accept: string
  labels: VerificationFormLabels
}) {
  const [state, formAction, pending] = useActionState(submitIdentityAction, idleKycState)

  const errorText =
    state.status === 'error'
      ? (labels.messages[state.errorKey ?? ''] ?? labels.errorUnexpected)
      : null

  const errorFor = (name: string) =>
    state.status === 'error' && state.field === name && errorText !== null
      ? { error: errorText }
      : {}

  return (
    <form action={formAction} className="lg-stack" encType="multipart/form-data" noValidate>
      {state.status === 'ok' ? <Alert tone="success">{labels.submitted}</Alert> : null}
      {errorText === null ? null : <Alert tone="error">{errorText}</Alert>}

      {/*
       * Said before anything is typed, not afterwards. Somebody being asked for their national
       * identity number is entitled to know what happens to it before they hand it over.
       */}
      <p className="lg-hint">{labels.privacyNote}</p>

      <FormField id={IDENTITY_TYPE_FIELD} label={labels.documentType}>
        {({ describedBy, invalid }) => (
          <Select
            id={IDENTITY_TYPE_FIELD}
            name={IDENTITY_TYPE_FIELD}
            describedBy={describedBy}
            invalid={invalid}
            defaultValue={documentTypes[0]?.value ?? ''}
          >
            {documentTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </FormField>

      <FormField
        id={IDENTITY_NUMBER_FIELD}
        label={labels.number}
        hint={labels.numberHint}
        {...errorFor('identityNumber')}
      >
        {({ describedBy, invalid }) => (
          <Input
            id={IDENTITY_NUMBER_FIELD}
            name={IDENTITY_NUMBER_FIELD}
            describedBy={describedBy}
            invalid={invalid}
            inputMode="numeric"
            maxLength={20}
            autoComplete="off"
          />
        )}
      </FormField>

      <FormField
        id={DOCUMENT_FRONT_FIELD}
        label={labels.front}
        hint={labels.fileHint}
        {...errorFor('documentFront')}
      >
        {({ describedBy, invalid }) => (
          <input
            id={DOCUMENT_FRONT_FIELD}
            name={DOCUMENT_FRONT_FIELD}
            type="file"
            className="lg-input"
            accept={accept}
            // Opens the camera directly on a phone rather than a file browser, which is what
            // somebody photographing a card in their hand actually wants.
            capture="environment"
            aria-describedby={describedBy}
            aria-invalid={invalid === true || undefined}
          />
        )}
      </FormField>

      <FormField id={DOCUMENT_BACK_FIELD} label={labels.back} {...errorFor('documentBack')}>
        {({ describedBy, invalid }) => (
          <input
            id={DOCUMENT_BACK_FIELD}
            name={DOCUMENT_BACK_FIELD}
            type="file"
            className="lg-input"
            accept={accept}
            capture="environment"
            aria-describedby={describedBy}
            aria-invalid={invalid === true || undefined}
          />
        )}
      </FormField>

      <Button type="submit" disabled={pending}>
        {pending ? labels.loading : labels.submit}
      </Button>
    </form>
  )
}
