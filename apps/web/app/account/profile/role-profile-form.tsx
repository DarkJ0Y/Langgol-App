'use client'

/**
 * One onboarding form for all six role profiles.
 *
 * It renders a list of questions the server built from the domain descriptors, so a field added
 * to `PROFILE_FIELDS` appears here with no edit — and, more usefully, a field REMOVED from the
 * domain cannot linger on a screen still collecting it. Six near-identical form components is the
 * arrangement where the fifth one silently stops matching the other four.
 *
 * The component receives words, never keys: every label, option and message is already in the
 * reader's language by the time it arrives. That keeps the catalogue on the server and out of the
 * bundle a shopkeeper downloads on 2G.
 *
 * Three shapes here are requirements rather than styling, and they are the same three the farmer
 * questionnaire settled:
 *
 *  - **Every question is skippable, and the screen says so.** Each select carries a blank first
 *    option meaning "not answered", distinct from any real choice.
 *  - **Yes/no questions are radio groups, not checkboxes.** An unticked checkbox posts nothing,
 *    which would make "I have no cold chain" indistinguishable from "I have not reached that
 *    question" — and the completion meter would then nag forever about something already answered.
 *  - **Nothing is disabled to indicate a problem.** A control a person cannot use and cannot see
 *    why is worse than one that accepts an answer and explains what was wrong with it.
 */

import { useActionState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Choice,
  FormField,
  Input,
  Select,
  Textarea,
} from '@langgol/ui/components'
import { saveRoleProfileAction } from './actions'
import { ROLE_FIELD, SERVICE_AREA_INPUT, geoInputName } from './fields'
import { idleProfileState } from './state'

export interface Option {
  readonly value: string
  readonly label: string
}

/**
 * How one question renders.
 *
 * A flattened, serialisable view of a `FieldDescriptor` — the descriptor itself carries guard
 * FUNCTIONS, which cannot cross into a client component.
 */
export interface RenderField {
  readonly name: string
  readonly label: string
  readonly hint?: string | undefined
  readonly required?: boolean | undefined
  readonly control:
    | 'text'
    | 'longText'
    | 'number'
    | 'money'
    | 'boolean'
    | 'choice'
    | 'multi'
    | 'list'
    | 'address'
    | 'geo'
  readonly options?: readonly Option[] | undefined
  /**
   * A string for most controls; the chosen values for `multi`; and, for `geo`, exactly two
   * entries — latitude then longitude, in the order they are typed.
   */
  readonly value: string | readonly string[]
}

/**
 * What `FormField` hands its render prop.
 *
 * Named rather than written inline at each control, because under `exactOptionalPropertyTypes` an
 * inline `describedBy?: string` is a DIFFERENT type from `describedBy: string | undefined` and
 * will not match — the kind of mismatch that is one confusing error message per control.
 */
interface ControlIds {
  readonly describedBy: string | undefined
  readonly invalid: boolean
}

export interface ProfileFormLabels {
  readonly optionalNote: string
  readonly notAnswered: string
  readonly yes: string
  readonly no: string
  readonly save: string
  readonly loading: string
  readonly saved: string
  readonly serviceArea: string
  readonly serviceAreaHint: string
  readonly latitude: string
  readonly longitude: string
  /** Shown in place of the picker when the address book is empty. */
  readonly addressNone: string
  readonly addressAdd: string
  /** Pre-rendered messages, keyed by the same message key the action returns. */
  readonly messages: Readonly<Record<string, string>>
  readonly errorUnexpected: string
}

export function RoleProfileForm({
  role,
  fields,
  labels,
  serviceAreas,
  chosenServiceAreas,
}: {
  role: string
  fields: readonly RenderField[]
  labels: ProfileFormLabels
  serviceAreas?: readonly Option[] | undefined
  chosenServiceAreas?: readonly string[] | undefined
}) {
  const [state, formAction, pending] = useActionState(saveRoleProfileAction, idleProfileState)

  const errorText =
    state.status === 'error'
      ? (labels.messages[state.errorKey ?? ''] ?? labels.errorUnexpected)
      : null

  /*
   * A field-scoped failure shows beside its own question AND at the top. The banner alone leaves
   * a person scrolling a long form hunting for which box was wrong; the inline message alone can
   * be off-screen when the page re-renders at the top.
   */
  const errorFor = (name: string) =>
    state.status === 'error' && state.field === name && errorText !== null
      ? { error: errorText }
      : {}

  const control = (field: RenderField) => {
    const shared = (describedBy: string | undefined, invalid: boolean) => ({
      id: field.name,
      name: field.name,
      describedBy,
      invalid,
    })

    switch (field.control) {
      case 'boolean':
        // Three states, and the third is the one everybody starts in. No option is preselected
        // when there is no answer yet, so saving does not silently assert "no".
        return () => (
          <div className="lg-stack-tight" role="radiogroup" aria-labelledby={`${field.name}-label`}>
            <Choice
              name={field.name}
              value="YES"
              label={labels.yes}
              defaultChecked={field.value === 'YES'}
            />
            <Choice
              name={field.name}
              value="NO"
              label={labels.no}
              defaultChecked={field.value === 'NO'}
            />
          </div>
        )

      case 'choice':
        return ({ describedBy, invalid }: ControlIds) => (
          <Select {...shared(describedBy, invalid)} defaultValue={String(field.value)}>
            {/* Never preselects a real answer. An empty value is what "not answered" posts. */}
            <option value="">{labels.notAnswered}</option>
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )

      case 'multi':
        /*
         * Checkboxes rather than a multiple-select. A `<select multiple>` requires knowing to hold
         * ctrl, which on a phone is not a gesture that exists.
         */
        return () => (
          <div className="lg-stack-tight">
            {(field.options ?? []).map((option) => (
              <Checkbox
                key={option.value}
                name={field.name}
                value={option.value}
                label={option.label}
                defaultChecked={Array.isArray(field.value) && field.value.includes(option.value)}
              />
            ))}
          </div>
        )

      case 'list':
        // Free text, comma separated — a certification is whatever the issuing body called it.
        return ({ describedBy, invalid }: ControlIds) => (
          <Input
            {...shared(describedBy, invalid)}
            defaultValue={Array.isArray(field.value) ? field.value.join(', ') : ''}
            maxLength={400}
          />
        )

      case 'address':
        /*
         * A pointer into the address book, never a second copy of the street. Somebody who moves
         * corrects one address and every profile pointing at it follows.
         *
         * An empty book gets a sentence and a link rather than an empty dropdown. A select with
         * nothing in it is a dead end a person cannot act on, and this one is reachable: adding
         * the address is a page away.
         */
        return ({ describedBy, invalid }: ControlIds) =>
          (field.options ?? []).length === 0 ? (
            <p className="lg-hint">
              {labels.addressNone} <a href="/account/addresses">{labels.addressAdd}</a>
            </p>
          ) : (
            <Select {...shared(describedBy, invalid)} defaultValue={String(field.value)}>
              <option value="">{labels.notAnswered}</option>
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )

      case 'geo': {
        /*
         * Two boxes, one answer, and both are optional. Whether the pair is complete and whether
         * it lands in Bangladesh is judged server-side by the same rules an address pin is judged
         * by — repeating them as browser patterns would give the rule a second home to drift in.
         *
         * `decimal` rather than `numeric` on the keypad: a coordinate without its decimal point
         * is a different country.
         */
        const pair = Array.isArray(field.value) ? field.value : ['', '']
        return ({ describedBy, invalid }: ControlIds) => (
          <div className="lg-row">
            <Input
              id={field.name}
              name={geoInputName(field.name, 'latitude')}
              aria-label={labels.latitude}
              placeholder={labels.latitude}
              describedBy={describedBy}
              invalid={invalid}
              defaultValue={pair[0] ?? ''}
              inputMode="decimal"
              maxLength={12}
            />
            <Input
              name={geoInputName(field.name, 'longitude')}
              aria-label={labels.longitude}
              placeholder={labels.longitude}
              describedBy={describedBy}
              invalid={invalid}
              defaultValue={pair[1] ?? ''}
              inputMode="decimal"
              maxLength={12}
            />
          </div>
        )
      }

      case 'longText':
        return ({ describedBy, invalid }: ControlIds) => (
          <Textarea
            {...shared(describedBy, invalid)}
            rows={4}
            maxLength={1000}
            defaultValue={String(field.value)}
          />
        )

      case 'number':
        return ({ describedBy, invalid }: ControlIds) => (
          <Input
            {...shared(describedBy, invalid)}
            defaultValue={String(field.value)}
            inputMode="numeric"
            maxLength={7}
          />
        )

      case 'money':
        return ({ describedBy, invalid }: ControlIds) => (
          <Input
            {...shared(describedBy, invalid)}
            defaultValue={String(field.value)}
            inputMode="decimal"
            maxLength={10}
          />
        )

      default:
        return ({ describedBy, invalid }: ControlIds) => (
          <Input
            {...shared(describedBy, invalid)}
            defaultValue={String(field.value)}
            maxLength={160}
          />
        )
    }
  }

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {state.status === 'ok' ? <Alert tone="success">{labels.saved}</Alert> : null}
      {errorText === null ? null : <Alert tone="error">{errorText}</Alert>}

      <p className="lg-hint">{labels.optionalNote}</p>

      {/* Untrusted, and treated as such: the use case checks the caller holds this role. */}
      <input type="hidden" name={ROLE_FIELD} value={role} />

      {fields.map((field) => (
        <FormField
          key={field.name}
          id={field.name}
          label={field.label}
          {...(field.hint === undefined ? {} : { hint: field.hint })}
          {...errorFor(field.name)}
        >
          {control(field)}
        </FormField>
      ))}

      {serviceAreas === undefined ? null : (
        <FormField id={SERVICE_AREA_INPUT} label={labels.serviceArea} hint={labels.serviceAreaHint}>
          {() => (
            <div className="lg-stack-tight lg-scroll-list">
              {serviceAreas.map((area) => (
                <Checkbox
                  key={area.value}
                  name={SERVICE_AREA_INPUT}
                  value={area.value}
                  label={area.label}
                  defaultChecked={(chosenServiceAreas ?? []).includes(area.value)}
                />
              ))}
            </div>
          )}
        </FormField>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? labels.loading : labels.save}
      </Button>
    </form>
  )
}
