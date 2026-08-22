'use client'

import { useActionState, useState } from 'react'
import { Alert, Button, Checkbox, FormField, Input, PhoneInput } from '@langgol/ui/components'
import { createAddressAction, updateAddressAction } from './actions'
import { idleAddressState } from './state'
import { AreaPicker, type AreaOption, type AreaPickerLabels } from './area-picker'

export interface AddressFormLabels extends AreaPickerLabels {
  readonly label: string
  readonly labelHint: string
  readonly recipientName: string
  readonly recipientPhone: string
  readonly village: string
  readonly addressLine: string
  readonly landmark: string
  readonly postalCode: string
  readonly postalCodeHint: string
  readonly makeDefault: string
  readonly save: string
  readonly loading: string
  readonly saved: string
  readonly useCurrentLocation: string
  readonly locationCaptured: string
  readonly clearLocation: string
  readonly locationHelp: string
  readonly locationDenied: string
  readonly locationUnsupported: string
  readonly errorAreaRequired: string
  readonly errorAddressLine: string
  readonly errorPhone: string
  readonly errorName: string
  readonly errorPostalCode: string
  readonly errorCoordinates: string
  readonly errorLimit: string
  readonly errorNotAllowed: string
  readonly errorUnexpected: string
}

export interface AddressFormValues {
  readonly id?: string
  readonly label: string
  readonly recipientName: string
  readonly recipientPhone: string
  readonly villageOrArea: string
  readonly addressLine: string
  readonly landmark: string
  readonly postalCode: string
  readonly latitude: string
  readonly longitude: string
  readonly isDefault: boolean
  readonly areaPath: readonly AreaOption[]
}

const EMPTY: AddressFormValues = {
  label: '',
  recipientName: '',
  recipientPhone: '',
  villageOrArea: '',
  addressLine: '',
  landmark: '',
  postalCode: '',
  latitude: '',
  longitude: '',
  isDefault: false,
  areaPath: [],
}

/**
 * The reusable address form — used for both creating and editing.
 *
 * **Location is opt-in and never taken automatically.** There is no `getCurrentPosition` call on
 * mount, on focus, or on any path the user did not choose: capturing someone's precise position
 * because they opened a form is not consent, and the browser prompt alone is not a substitute for
 * asking. The button below is the only way coordinates are read, the result is shown before it is
 * saved, and it can be removed again.
 *
 * An address with no coordinates is a complete address. The hierarchical picker is the primary
 * path; the pin only sharpens a delivery estimate that already works without it.
 *
 * Refs: docs/08_BANGLADESH_CONTEXT.md §2; docs/07_SECURITY.md §7
 */
export function AddressForm({
  labels,
  initial,
  locale,
}: {
  labels: AddressFormLabels
  initial?: AddressFormValues
  locale: 'bn' | 'en'
}) {
  const values = initial ?? EMPTY
  const editing = values.id !== undefined

  const [state, formAction, pending] = useActionState(
    editing ? updateAddressAction : createAddressAction,
    idleAddressState,
  )

  const [areaId, setAreaId] = useState(values.areaPath.at(-1)?.id ?? '')
  const [coordinates, setCoordinates] = useState({
    latitude: values.latitude,
    longitude: values.longitude,
    /** How the coordinates were obtained. The server decides precision; this is only a hint. */
    source: values.latitude === '' ? '' : 'MAP_PIN',
  })
  const [locationError, setLocationError] = useState<string | null>(null)

  function captureLocation() {
    setLocationError(null)

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocationError(labels.locationUnsupported)
      return
    }

    // Called ONLY from the button's onClick. The browser prompt appears because the user asked
    // for it, which is the only circumstance in which it should appear at all.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          // Six decimal places is the column's precision; more would be stored then truncated.
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
          source: 'DEVICE_GPS',
        })
      },
      () => {
        // A refusal is a legitimate answer, not an error to nag about. The form still works.
        setLocationError(labels.locationDenied)
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  }

  function clearLocation() {
    setCoordinates({ latitude: '', longitude: '', source: '' })
    setLocationError(null)
  }

  const message =
    state.status === 'ok'
      ? { tone: 'success' as const, text: labels.saved }
      : state.status === 'error'
        ? {
            tone: 'error' as const,
            text:
              state.errorKey === 'errors.areaRequired'
                ? labels.errorAreaRequired
                : state.errorKey === 'errors.addressLineRequired'
                  ? labels.errorAddressLine
                  : state.errorKey === 'errors.phoneInvalid'
                    ? labels.errorPhone
                    : state.errorKey === 'errors.nameEmpty'
                      ? labels.errorName
                      : state.errorKey === 'errors.postalCodeInvalid'
                        ? labels.errorPostalCode
                        : state.errorKey === 'errors.coordinatesInvalid'
                          ? labels.errorCoordinates
                          : state.errorKey === 'errors.addressLimit'
                            ? labels.errorLimit
                            : state.errorKey === 'errors.notAllowed'
                              ? labels.errorNotAllowed
                              : labels.errorUnexpected,
          }
        : null

  const errorFor = (field: string) =>
    state.status === 'error' && state.field === field && message !== null
      ? { error: message.text }
      : {}

  return (
    <form action={formAction} className="lg-stack" noValidate>
      {message === null ? null : <Alert tone={message.tone}>{message.text}</Alert>}

      {editing ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="adminAreaId" value={areaId} />
      <input type="hidden" name="latitude" value={coordinates.latitude} />
      <input type="hidden" name="longitude" value={coordinates.longitude} />
      <input type="hidden" name="coordinateSource" value={coordinates.source} />

      <FormField id="label" label={labels.label} hint={labels.labelHint}>
        {({ describedBy }) => (
          <Input
            id="label"
            name="label"
            defaultValue={values.label}
            maxLength={40}
            describedBy={describedBy}
          />
        )}
      </FormField>

      <FormField id="recipientName" label={labels.recipientName} {...errorFor('recipientName')}>
        {({ describedBy, invalid }) => (
          <Input
            id="recipientName"
            name="recipientName"
            defaultValue={values.recipientName}
            required
            maxLength={120}
            autoComplete="name"
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <FormField id="recipientPhone" label={labels.recipientPhone} {...errorFor('recipientPhone')}>
        {({ describedBy, invalid }) => (
          <PhoneInput
            id="recipientPhone"
            name="recipientPhone"
            defaultValue={values.recipientPhone}
            required
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      {/* The primary way to give a location. Never a fallback. */}
      <AreaPicker
        labels={labels}
        locale={locale}
        initialPath={values.areaPath}
        onChange={setAreaId}
      />

      <FormField id="villageOrArea" label={labels.village}>
        {({ describedBy }) => (
          <Input
            id="villageOrArea"
            name="villageOrArea"
            defaultValue={values.villageOrArea}
            maxLength={120}
            describedBy={describedBy}
          />
        )}
      </FormField>

      <FormField id="addressLine" label={labels.addressLine} {...errorFor('addressLine')}>
        {({ describedBy, invalid }) => (
          <Input
            id="addressLine"
            name="addressLine"
            defaultValue={values.addressLine}
            required
            maxLength={250}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      <FormField id="landmark" label={labels.landmark}>
        {({ describedBy }) => (
          <Input
            id="landmark"
            name="landmark"
            defaultValue={values.landmark}
            maxLength={160}
            describedBy={describedBy}
          />
        )}
      </FormField>

      <FormField
        id="postalCode"
        label={labels.postalCode}
        hint={labels.postalCodeHint}
        {...errorFor('postalCode')}
      >
        {({ describedBy, invalid }) => (
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={values.postalCode}
            inputMode="numeric"
            maxLength={4}
            describedBy={describedBy}
            invalid={invalid}
          />
        )}
      </FormField>

      {/* Optional, opt-in, and reversible. */}
      <div className="lg-stack-tight">
        <p className="lg-hint">{labels.locationHelp}</p>
        {locationError === null ? null : <Alert tone="warning">{locationError}</Alert>}
        {coordinates.latitude === '' ? (
          <Button type="button" variant="secondary" onClick={captureLocation}>
            {labels.useCurrentLocation}
          </Button>
        ) : (
          <>
            <Alert tone="info">
              {labels.locationCaptured}: {coordinates.latitude}, {coordinates.longitude}
            </Alert>
            <Button type="button" variant="ghost" onClick={clearLocation}>
              {labels.clearLocation}
            </Button>
          </>
        )}
      </div>

      <Checkbox name="makeDefault" label={labels.makeDefault} defaultChecked={values.isDefault} />

      <Button type="submit" loading={pending}>
        {pending ? labels.loading : labels.save}
      </Button>
    </form>
  )
}
