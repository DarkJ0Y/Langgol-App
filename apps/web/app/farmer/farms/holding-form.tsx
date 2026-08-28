'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { Alert, Button, Choice, FormField, Input, Select } from '@langgol/ui/components'
import { AreaPicker, type AreaPickerLabels } from '@/app/account/addresses/area-picker'
import { idleFarmState, type FarmActionState } from './state'

export interface Option {
  readonly value: string
  readonly label: string
}

export interface HoldingLabels {
  readonly name: string
  readonly nameHint: string
  readonly area: string
  readonly areaUnit: string
  readonly soil: string
  readonly ownership: string
  readonly irrigation: string
  readonly irrigationYes: string
  readonly irrigationNo: string
  readonly irrigationMethod: string
  readonly waterSource: string
  readonly method: string
  readonly notAnswered: string
  readonly optionalNote: string
  readonly submit: string
  readonly loading: string
  readonly saved: string
  readonly errorName: string
  readonly errorArea: string
  readonly errorIrrigation: string
  readonly errorNotFound: string
  readonly errorNotAllowed: string
  readonly errorLimit: string
  readonly errorUnexpected: string
}

export interface HoldingOptions {
  readonly units: readonly Option[]
  readonly soils: readonly Option[]
  readonly ownerships: readonly Option[]
  readonly irrigationMethods: readonly Option[]
  readonly waterSources: readonly Option[]
  readonly farmingMethods: readonly Option[]
}

export interface HoldingValues {
  readonly name: string
  readonly areaAmount: string
  readonly areaUnit: string
  readonly soilType: string
  readonly ownershipType: string
  /** `'YES' | 'NO' | ''` — the third state is "has not said". */
  readonly irrigationAvailable: string
  readonly irrigationMethod: string
  readonly waterSource: string
  readonly farmingMethod: string
}

export const EMPTY_HOLDING: HoldingValues = {
  name: '',
  areaAmount: '',
  areaUnit: '',
  soilType: '',
  ownershipType: '',
  irrigationAvailable: '',
  irrigationMethod: '',
  waterSource: '',
  farmingMethod: '',
}

/**
 * The shared farm/plot form.
 *
 * One component for four screens — create farm, edit farm, create plot, edit plot — because a
 * separate "edit" variant is two forms to keep in step and the second one always misses a field.
 * `variant` decides how much is asked: a plot inherits its farm's ownership, water source and
 * method, so asking again would invite an answer that contradicts the farm above it.
 *
 * Every question is optional and the screen says so, matching the P5 questionnaire. Irrigation is
 * a radio group rather than a checkbox for the same reason as there: "no irrigation" and "have not
 * said" are different answers, and an unticked checkbox cannot tell them apart.
 */
export function HoldingForm({
  action,
  labels,
  options,
  initial,
  variant,
  hidden,
  areaPicker,
  children,
}: {
  action: (state: FarmActionState, data: FormData) => Promise<FarmActionState>
  labels: HoldingLabels
  options: HoldingOptions
  initial?: HoldingValues
  variant: 'farm' | 'plot'
  /** Ids the action needs. Attacker-controllable by nature; the owner-scoped query is the guard. */
  hidden?: Record<string, string>
  /**
   * Where the farm is. Present only when creating a farm.
   *
   * Rendered here rather than passed in as `children` from the page, because `AreaPicker` is a
   * client component that reports its selection through `onChange` — a server component has no
   * callback to give it. The chosen id rides in a hidden input, the same arrangement the address
   * form uses.
   */
  areaPicker?: { readonly labels: AreaPickerLabels; readonly locale: 'bn' | 'en' }
  children?: ReactNode
}) {
  const values = initial ?? EMPTY_HOLDING
  const [state, formAction, pending] = useActionState(action, idleFarmState)
  const [irrigation, setIrrigation] = useState(values.irrigationAvailable)
  const [areaId, setAreaId] = useState('')

  const message =
    state.status === 'ok'
      ? { tone: 'success' as const, text: labels.saved }
      : state.status === 'error'
        ? {
            tone: 'error' as const,
            text:
              state.errorKey === 'errors.nameEmpty'
                ? labels.errorName
                : state.errorKey === 'errors.landInvalid'
                  ? labels.errorArea
                  : state.errorKey === 'errors.irrigationInconsistent'
                    ? labels.errorIrrigation
                    : state.errorKey === 'errors.notFound'
                      ? labels.errorNotFound
                      : state.errorKey === 'errors.notAllowed'
                        ? labels.errorNotAllowed
                        : state.errorKey === 'errors.addressLimit'
                          ? labels.errorLimit
                          : labels.errorUnexpected,
          }
        : null

  const errorFor = (field: string) =>
    state.status === 'error' && state.field === field && message !== null
      ? { error: message.text }
      : {}

  const question = (id: string, label: string, value: string, choices: readonly Option[]) => (
    <FormField id={id} label={label} {...errorFor(id)}>
      {({ describedBy, invalid }) => (
        <Select id={id} name={id} defaultValue={value} describedBy={describedBy} invalid={invalid}>
          <option value="">{labels.notAnswered}</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  )

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {message === null ? null : <Alert tone={message.tone}>{message.text}</Alert>}

      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <FormField id="name" label={labels.name} hint={labels.nameHint} {...errorFor('name')}>
        {({ describedBy, invalid }) => (
          <Input
            id="name"
            name="name"
            defaultValue={values.name}
            required
            maxLength={80}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      {areaPicker === undefined ? null : (
        <>
          <input type="hidden" name="adminAreaId" value={areaId} />
          <AreaPicker
            labels={areaPicker.labels}
            locale={areaPicker.locale}
            initialPath={[]}
            onChange={setAreaId}
          />
        </>
      )}

      <p className="lg-hint">{labels.optionalNote}</p>

      {children}

      {/* The area and its unit are one question, so they sit on one row. */}
      <FormField id="areaAmount" label={labels.area} {...errorFor('area')}>
        {({ describedBy, invalid }) => (
          <div className="lg-row">
            <Input
              id="areaAmount"
              name="areaAmount"
              defaultValue={values.areaAmount}
              inputMode="decimal"
              maxLength={12}
              describedBy={describedBy}
              invalid={invalid}
            />
            <Select
              id="areaUnit"
              name="areaUnit"
              defaultValue={values.areaUnit}
              aria-label={labels.areaUnit}
            >
              {options.units.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </div>
        )}
      </FormField>

      {question('soilType', labels.soil, values.soilType, options.soils)}

      {variant === 'farm' ? (
        <>
          {question('ownershipType', labels.ownership, values.ownershipType, options.ownerships)}

          <fieldset className="lg-stack-tight" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="lg-label">{labels.irrigation}</legend>
            <Choice
              name="irrigationAvailable"
              value="YES"
              label={labels.irrigationYes}
              defaultChecked={values.irrigationAvailable === 'YES'}
              onChange={() => setIrrigation('YES')}
            />
            <Choice
              name="irrigationAvailable"
              value="NO"
              label={labels.irrigationNo}
              defaultChecked={values.irrigationAvailable === 'NO'}
              onChange={() => setIrrigation('NO')}
            />
          </fieldset>

          {/* Hidden rather than disabled: asking how somebody irrigates right after they said
              they do not is a form that is not listening. The server clears them regardless. */}
          {irrigation === 'NO' ? null : (
            <>
              {question(
                'irrigationMethod',
                labels.irrigationMethod,
                values.irrigationMethod,
                options.irrigationMethods,
              )}
              {question(
                'waterSource',
                labels.waterSource,
                values.waterSource,
                options.waterSources,
              )}
            </>
          )}

          {question('farmingMethod', labels.method, values.farmingMethod, options.farmingMethods)}
        </>
      ) : (
        /* A plot inherits ownership, water source and method from its farm. Asking again would
           invite an answer that contradicts the farm above it. */
        question(
          'irrigationMethod',
          labels.irrigationMethod,
          values.irrigationMethod,
          options.irrigationMethods,
        )
      )}

      <Button type="submit" loading={pending}>
        {pending ? labels.loading : labels.submit}
      </Button>
    </form>
  )
}
