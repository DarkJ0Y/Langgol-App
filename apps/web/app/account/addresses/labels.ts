import type { Translator } from '@langgol/i18n'
import type { AddressFormLabels } from './address-form'

/**
 * Every string the address form can display, resolved on the server.
 *
 * Shared by the create and edit screens so the two cannot drift — a label added for one and
 * forgotten on the other is the sort of thing nobody notices until it renders as an empty
 * `<label>` in the language they do not read.
 *
 * Resolving here also keeps the translator out of the client bundle: shipping both catalogues to
 * a phone on a metered connection to render a form is not a trade worth making.
 */
export function addressFormLabels(t: Translator): AddressFormLabels {
  return {
    division: t.t('address.division'),
    district: t.t('address.district'),
    upazila: t.t('address.upazila'),
    union: t.t('address.union'),
    choose: t.t('address.selectArea'),
    optional: t.t('address.optional'),
    label: t.t('address.label'),
    labelHint: t.t('address.labelHint'),
    recipientName: t.t('address.recipientName'),
    recipientPhone: t.t('address.recipientPhone'),
    village: t.t('address.village'),
    addressLine: t.t('address.addressLine'),
    landmark: t.t('address.landmark'),
    postalCode: t.t('address.postalCode'),
    postalCodeHint: t.t('address.postalCodeHint'),
    makeDefault: t.t('address.makeDefault'),
    save: t.t('common.save'),
    loading: t.t('common.loading'),
    saved: t.t('address.saved'),
    useCurrentLocation: t.t('address.useCurrentLocation'),
    locationCaptured: t.t('address.locationCaptured'),
    clearLocation: t.t('address.clearLocation'),
    locationHelp: t.t('address.locationHelp'),
    locationDenied: t.t('address.locationDenied'),
    locationUnsupported: t.t('address.locationUnsupported'),
    errorAreaRequired: t.t('errors.areaRequired'),
    errorAddressLine: t.t('errors.addressLineRequired'),
    errorPhone: t.t('errors.phoneInvalid'),
    errorName: t.t('errors.nameEmpty'),
    errorPostalCode: t.t('errors.postalCodeInvalid'),
    errorCoordinates: t.t('errors.coordinatesInvalid'),
    errorLimit: t.t('errors.addressLimit'),
    errorNotAllowed: t.t('errors.notAllowed'),
    errorUnexpected: t.t('errors.unexpected'),
  }
}
