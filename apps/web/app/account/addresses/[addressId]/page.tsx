import { notFound } from 'next/navigation'
import { getAddress } from '@langgol/application'
import { areaName } from '@langgol/domain/location'
import { createTranslator } from '@langgol/i18n'
import { Card, LinkButton } from '@langgol/ui/components'
import { locationDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import { getLocale } from '@/lib/locale'
import { AddressForm } from '../address-form'
import { addressFormLabels } from '../labels'

/**
 * Edit one saved address.
 *
 * `getAddress` scopes the lookup to the signed-in actor, so an id belonging to someone else
 * produces a 404 — the same answer as an id that never existed. Rendering `notFound()` rather
 * than a redirect keeps that indistinguishable from the outside.
 *
 * The form is the same component the create screen uses; only the initial values differ. That is
 * what "reusable" was supposed to mean, and until this page existed it was only a claim.
 */
export default async function EditAddressPage({
  params,
}: {
  params: Promise<{ addressId: string }>
}) {
  const { addressId } = await params

  const actor = await currentActor()
  const deps = await locationDeps()

  const result = await getAddress(actor, addressId, deps)
  if (!result.ok) notFound()
  const address = result.value

  const locale = await getLocale()
  const t = createTranslator(locale)

  return (
    <div className="lg-stack">
      <Card>
        <h1 className="lg-title">{t.t('address.edit')}</h1>
        <AddressForm
          locale={locale}
          labels={addressFormLabels(t)}
          initial={{
            id: address.id,
            label: address.label ?? '',
            recipientName: address.recipientName,
            recipientPhone: address.recipientPhone,
            villageOrArea: address.villageOrArea ?? '',
            addressLine: address.addressLine,
            landmark: address.landmark ?? '',
            postalCode: address.postalCode ?? '',
            // Strings, because that is what the hidden inputs carry. Empty means no pin.
            latitude: address.latitude === null ? '' : String(address.latitude),
            longitude: address.longitude === null ? '' : String(address.longitude),
            isDefault: address.isDefault,
            // Rehydrates the picker at the level the user left it, rather than making them
            // re-choose division → district → upazila to correct a house number.
            areaPath: address.areaPath.map((area) => ({
              id: area.id,
              name: areaName(area, locale),
            })),
          }}
        />
      </Card>

      <LinkButton href="/account/addresses" variant="ghost">
        {t.t('address.title')}
      </LinkButton>
    </div>
  )
}
