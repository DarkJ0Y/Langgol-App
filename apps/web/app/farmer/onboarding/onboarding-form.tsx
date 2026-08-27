'use client'

import { useActionState, useState } from 'react'
import { Alert, Button, Choice, FormField, Input, Select } from '@langgol/ui/components'
import { saveFarmerProfileAction } from './actions'
import { idleFarmerState } from './state'

export interface Option {
  readonly value: string
  readonly label: string
}

export interface OnboardingLabels {
  readonly optionalNote: string
  readonly experience: string
  readonly experienceHint: string
  readonly experienceUnit: string
  readonly farmerType: string
  readonly land: string
  readonly landHint: string
  readonly landUnit: string
  readonly ownership: string
  readonly irrigation: string
  readonly irrigationYes: string
  readonly irrigationNo: string
  readonly irrigationMethod: string
  readonly waterSource: string
  readonly method: string
  readonly methodNote: string
  readonly notAnswered: string
  readonly save: string
  readonly loading: string
  readonly saved: string
  readonly errorExperience: string
  readonly errorLand: string
  readonly errorIrrigation: string
  readonly errorNotAllowed: string
  readonly errorUnexpected: string
}

export interface OnboardingValues {
  readonly farmingExperienceYears: string
  readonly farmerType: string
  readonly totalLandAmount: string
  readonly landUnit: string
  readonly ownershipType: string
  /** `'YES' | 'NO' | ''` — the third state is "has not said", and it is where everyone starts. */
  readonly irrigationAvailable: string
  readonly irrigationMethod: string
  readonly waterSource: string
  readonly farmingMethod: string
}

export interface OnboardingOptions {
  readonly farmerTypes: readonly Option[]
  readonly landUnits: readonly Option[]
  readonly ownershipTypes: readonly Option[]
  readonly irrigationMethods: readonly Option[]
  readonly waterSources: readonly Option[]
  readonly farmingMethods: readonly Option[]
}

/**
 * The farmer questionnaire.
 *
 * Three things about its shape are requirements rather than styling:
 *
 *  - **Every question is skippable, and the screen says so.** A farmer signing up on a borrowed
 *    phone at the edge of coverage must be able to save five answers and leave the sixth. Each
 *    select therefore carries a blank first option that means "not answered" — distinct from any
 *    real choice.
 *  - **Irrigation is a radio group, not a checkbox.** An unticked checkbox posts nothing, which
 *    would make "I have no irrigation" indistinguishable from "I have not reached that question",
 *    and the completion meter would nag a rain-fed farmer forever about something they answered.
 *  - **The follow-up questions disappear when there is no irrigation.** Not disabled, hidden:
 *    asking somebody how they irrigate directly after they said they do not is the kind of thing
 *    that makes a form feel like it is not listening.
 */
export function OnboardingForm({
  labels,
  options,
  initial,
}: {
  labels: OnboardingLabels
  options: OnboardingOptions
  initial: OnboardingValues
}) {
  const [state, formAction, pending] = useActionState(saveFarmerProfileAction, idleFarmerState)

  // Held in React only so the follow-up questions can appear and disappear. The server reads the
  // submitted value, never this.
  const [irrigation, setIrrigation] = useState(initial.irrigationAvailable)

  const message =
    state.status === 'ok'
      ? { tone: 'success' as const, text: labels.saved }
      : state.status === 'error'
        ? {
            tone: 'error' as const,
            text:
              state.errorKey === 'errors.experienceInvalid'
                ? labels.errorExperience
                : state.errorKey === 'errors.landInvalid'
                  ? labels.errorLand
                  : state.errorKey === 'errors.irrigationInconsistent'
                    ? labels.errorIrrigation
                    : state.errorKey === 'errors.notAllowed'
                      ? labels.errorNotAllowed
                      : labels.errorUnexpected,
          }
        : null

  const errorFor = (field: string) =>
    state.status === 'error' && state.field === field && message !== null
      ? { error: message.text }
      : {}

  /** A select whose blank option means "I have not answered this". */
  const question = (
    id: string,
    label: string,
    value: string,
    choices: readonly Option[],
    hint?: string,
  ) => (
    <FormField id={id} label={label} {...(hint === undefined ? {} : { hint })} {...errorFor(id)}>
      {({ describedBy, invalid }) => (
        <Select id={id} name={id} defaultValue={value} describedBy={describedBy} invalid={invalid}>
          {/* Never pre-selects a real answer. An empty value is what "not answered" posts. */}
          <option value="">{labels.notAnswered}</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  )

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {message === null ? null : <Alert tone={message.tone}>{message.text}</Alert>}

      <p className="lg-hint">{labels.optionalNote}</p>

      <FormField
        id="farmingExperienceYears"
        label={labels.experience}
        hint={labels.experienceHint}
        {...errorFor('farmingExperienceYears')}
      >
        {({ describedBy, invalid }) => (
          <Input
            id="farmingExperienceYears"
            name="farmingExperienceYears"
            defaultValue={initial.farmingExperienceYears}
            inputMode="numeric"
            maxLength={3}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      {question('farmerType', labels.farmerType, initial.farmerType, options.farmerTypes)}

      {/* The area and its unit are one question, so they sit together. */}
      <FormField
        id="totalLandAmount"
        label={labels.land}
        hint={labels.landHint}
        {...errorFor('totalLandArea')}
      >
        {({ describedBy, invalid }) => (
          <div className="lg-row">
            <Input
              id="totalLandAmount"
              name="totalLandAmount"
              defaultValue={initial.totalLandAmount}
              inputMode="decimal"
              maxLength={12}
              describedBy={describedBy}
              invalid={invalid}
            />
            <Select
              id="landUnit"
              name="landUnit"
              defaultValue={initial.landUnit}
              aria-label={labels.landUnit}
            >
              {options.landUnits.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </FormField>

      {question('ownershipType', labels.ownership, initial.ownershipType, options.ownershipTypes)}

      {/*
        Three states, so three radios. "Not answered" is a real state and the one every farmer
        starts in; a checkbox could only express two.
      */}
      <fieldset className="lg-stack-tight" style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="lg-label">{labels.irrigation}</legend>
        <Choice
          name="irrigationAvailable"
          value="YES"
          label={labels.irrigationYes}
          defaultChecked={initial.irrigationAvailable === 'YES'}
          onChange={() => setIrrigation('YES')}
        />
        <Choice
          name="irrigationAvailable"
          value="NO"
          label={labels.irrigationNo}
          defaultChecked={initial.irrigationAvailable === 'NO'}
          onChange={() => setIrrigation('NO')}
        />
      </fieldset>

      {/*
        Hidden rather than disabled when there is no irrigation. Asking somebody how they irrigate
        immediately after they said they do not is a form that is not listening — and the server
        clears both fields anyway, so leaving them visible would also be misleading.
      */}
      {irrigation === 'NO' ? null : (
        <>
          {question(
            'irrigationMethod',
            labels.irrigationMethod,
            initial.irrigationMethod,
            options.irrigationMethods,
          )}
          {question('waterSource', labels.waterSource, initial.waterSource, options.waterSources)}
        </>
      )}

      {question('farmingMethod', labels.method, initial.farmingMethod, options.farmingMethods)}
      <p className="lg-hint">{labels.methodNote}</p>

      <Button type="submit" loading={pending}>
        {pending ? labels.loading : labels.save}
      </Button>
    </form>
  )
}
