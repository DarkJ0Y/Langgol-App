import { redirect } from 'next/navigation'
import { listAddresses } from '@langgol/application'
import { areaName } from '@langgol/domain/location'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { locationDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { AddressForm } from './address-form'
import { AddressList } from './address-list'

/**
 * The signed-in user's address book.
 *
 * Reads through the use case, so the same authorization that guards an action guards this render.
 * `listAddresses` takes no user id — the owner is the actor — so there is no argument here that
 * could be aimed at another person's addresses.
 */
export default async function AddressesPage() {
  const actor = await currentActor()
  const deps = await locationDeps()

  const result = await listAddresses(actor, deps)
  if (!result.ok) redirect('/auth')

  const locale = await getLocale()
  const t = createTranslator(locale)

  const summaries = result.value.map((address) => ({
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    // Resolved and localised here so the client never receives the tree to walk itself.
    areaPath: address.areaPath.map((area) => areaName(area, locale)).join(', '),
    addressLine: address.addressLine,
    postalCode: address.postalCode,
    hasCoordinates: address.latitude !== null,
    isDefault: address.isDefault,
  }))

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('address.title')}</h1>
        <AddressList
          addresses={summaries}
          labels={{
            isDefault: t.t('address.isDefault'),
            setDefault: t.t('address.setDefault'),
            remove: t.t('address.remove'),
            confirmRemove: t.t('address.confirmRemove'),
            none: t.t('address.none'),
            loading: t.t('common.loading'),
            removed: t.t('address.removed'),
            defaultChanged: t.t('address.defaultChanged'),
            errorUnexpected: t.t('errors.unexpected'),
          }}
        />
      </Card>

      <Card>
        <h2 className="lg-title">{t.t('address.addNew')}</h2>
        <AddressForm
          locale={locale}
          labels={{
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
          }}
        />
      </Card>

      <LinkButton href="/account" variant="ghost">
        {t.t('verify.backToAccount')}
      </LinkButton>
    </div>
  )
}
