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
import { addressFormLabels } from './labels'

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
            edit: t.t('address.edit'),
            hasLocation: t.t('address.locationCaptured'),
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
        <AddressForm locale={locale} labels={addressFormLabels(t)} />
      </Card>

      <LinkButton href="/account" variant="ghost">
        {t.t('verify.backToAccount')}
      </LinkButton>
    </div>
  )
}
