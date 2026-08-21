'use client'

import { useActionState } from 'react'
import { Alert, Button, LinkButton } from '@langgol/ui/components'
import { deleteAddressAction, setDefaultAddressAction } from './actions'
import { idleAddressState } from './state'

export interface AddressSummary {
  readonly id: string
  readonly label: string | null
  readonly recipientName: string
  readonly recipientPhone: string
  /** "Rajshahi, Bogura, Shibganj" — already resolved and localised server-side. */
  readonly areaPath: string
  readonly addressLine: string
  readonly postalCode: string | null
  readonly hasCoordinates: boolean
  readonly isDefault: boolean
}

export interface AddressListLabels {
  readonly isDefault: string
  readonly edit: string
  readonly hasLocation: string
  readonly setDefault: string
  readonly remove: string
  readonly confirmRemove: string
  readonly none: string
  readonly loading: string
  readonly removed: string
  readonly defaultChanged: string
  readonly errorUnexpected: string
}

/**
 * The saved addresses, default first.
 *
 * Each row carries its own forms rather than one shared form with a hidden id, so a failure on
 * one address cannot leave another row's controls in an error state — and so the id posted is
 * always the id next to the button that was pressed.
 */
export function AddressList({
  addresses,
  labels,
}: {
  addresses: readonly AddressSummary[]
  labels: AddressListLabels
}) {
  const [removeState, removeAction, removing] = useActionState(
    deleteAddressAction,
    idleAddressState,
  )
  const [defaultState, defaultAction, settingDefault] = useActionState(
    setDefaultAddressAction,
    idleAddressState,
  )

  const notice =
    removeState.status === 'ok'
      ? labels.removed
      : defaultState.status === 'ok'
        ? labels.defaultChanged
        : null

  const error =
    removeState.status === 'error' || defaultState.status === 'error'
      ? labels.errorUnexpected
      : null

  if (addresses.length === 0) {
    return <p className="lg-subtitle">{labels.none}</p>
  }

  return (
    <div className="lg-stack">
      {notice === null ? null : <Alert tone="success">{notice}</Alert>}
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      <ul className="lg-stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {addresses.map((address) => (
          <li key={address.id} className="lg-card">
            <div className="lg-stack-tight">
              <strong>{address.label ?? address.recipientName}</strong>
              {address.isDefault ? <Alert tone="info">{labels.isDefault}</Alert> : null}

              <span className="lg-subtitle">
                {address.recipientName} · {address.recipientPhone}
              </span>
              <span className="lg-subtitle">
                {address.addressLine}
                {address.postalCode === null ? '' : ` · ${address.postalCode}`}
              </span>
              <span className="lg-subtitle">{address.areaPath}</span>
              {/* Whether a pin is attached is worth showing: it is what decides whether the
                  delivery estimate is anchored to this address or to an area centroid. */}
              {address.hasCoordinates ? (
                <span className="lg-subtitle">{labels.hasLocation}</span>
              ) : null}

              <div className="lg-stack-tight">
                <LinkButton href={`/account/addresses/${address.id}`} variant="secondary">
                  {labels.edit}
                </LinkButton>

                {address.isDefault ? null : (
                  <form action={defaultAction}>
                    <input type="hidden" name="id" value={address.id} />
                    <Button type="submit" variant="secondary" loading={settingDefault}>
                      {settingDefault ? labels.loading : labels.setDefault}
                    </Button>
                  </form>
                )}

                <form
                  action={removeAction}
                  onSubmit={(event) => {
                    // Deleting an address is easy to do by accident on a small screen and there
                    // is no undo in this surface.
                    if (!window.confirm(labels.confirmRemove)) event.preventDefault()
                  }}
                >
                  <input type="hidden" name="id" value={address.id} />
                  <Button type="submit" variant="ghost" loading={removing}>
                    {removing ? labels.loading : labels.remove}
                  </Button>
                </form>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
