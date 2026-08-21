'use server'

/**
 * Address book server actions.
 *
 * The five operations the account screen needs, each one validate → delegate. Authorization and
 * every rule about what an address may contain live in the use case; nothing is decided here.
 *
 * Note what none of these accept: a **user id**. The owner is the signed-in actor, and the
 * repository puts that in the WHERE clause, so there is no argument on any of these actions that
 * could be pointed at somebody else's address.
 *
 * Refs: docs/07_SECURITY.md §4.3, §5
 */

import { revalidatePath } from 'next/cache'
import {
  createAddress,
  deleteAddress,
  listAddresses,
  listAreaChildren,
  setDefaultAddress,
  updateAddress,
} from '@langgol/application'
import type { MessageKey } from '@langgol/i18n'
import { locationDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'
import {
  AddressFormSchema,
  IdSchema,
  coordinatesFrom,
  firstErrorField,
  present,
  readAddressForm,
} from './form'
import type { AddressActionState } from './state'

/** Map a domain error onto a message key. The user never sees an internal message. */
function toActionState(error: {
  code: string
  meta: Record<string, string | number | boolean>
}): AddressActionState {
  const field = typeof error.meta['field'] === 'string' ? error.meta['field'] : undefined
  const cause = typeof error.meta['code'] === 'string' ? error.meta['code'] : undefined

  if (error.code === 'VALIDATION_FAILED') {
    const key: MessageKey = cause?.startsWith('COORDINATES_')
      ? 'errors.coordinatesInvalid'
      : cause === 'POSTAL_CODE_INVALID'
        ? 'errors.postalCodeInvalid'
        : cause === 'PHONE_INVALID'
          ? 'errors.phoneInvalid'
          : cause === 'RECIPIENT_NAME_EMPTY'
            ? 'errors.nameEmpty'
            : cause === 'ADDRESS_LINE_EMPTY'
              ? 'errors.addressLineRequired'
              : field === 'adminAreaId'
                ? 'errors.areaRequired'
                : 'errors.addressLimit'
    return { status: 'error', errorKey: key, field }
  }

  switch (error.code) {
    case 'NOT_FOUND':
      return { status: 'error', errorKey: 'errors.notFound' }
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return { status: 'error', errorKey: 'errors.notAllowed' }
    default:
      return { status: 'error', errorKey: 'errors.unexpected' }
  }
}

/* --------------------------------------------------------------------- read */

export async function listAddressesAction() {
  const deps = await locationDeps()
  const result = await listAddresses(await currentActor(), deps)
  return result.ok ? { ok: true as const, addresses: result.value } : { ok: false as const }
}

export async function listAreasAction(parentId: string | null) {
  const deps = await locationDeps()
  const result = await listAreaChildren(await currentActor(), parentId, deps)
  return result.ok
    ? { ok: true as const, ...result.value }
    : { ok: false as const, parentId, level: null, areas: [], nextLevel: null }
}

/* ------------------------------------------------------------------- create */

export async function createAddressAction(
  _previous: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const parsed = AddressFormSchema.safeParse(readAddressForm(formData))

  if (!parsed.success) {
    const field = firstErrorField(parsed.error)
    return {
      status: 'error',
      errorKey:
        field === 'adminAreaId'
          ? 'errors.areaRequired'
          : field === 'addressLine'
            ? 'errors.addressLineRequired'
            : field === 'recipientPhone'
              ? 'errors.phoneInvalid'
              : field === 'recipientName'
                ? 'errors.nameEmpty'
                : 'errors.unexpected',
      field,
    }
  }

  const coordinates = coordinatesFrom(parsed.data)
  const deps = await locationDeps()

  const result = await createAddress(
    await currentActor(),
    {
      label: parsed.data.label || null,
      recipientName: parsed.data.recipientName,
      recipientPhone: parsed.data.recipientPhone,
      adminAreaId: parsed.data.adminAreaId,
      villageOrArea: parsed.data.villageOrArea || null,
      addressLine: parsed.data.addressLine,
      landmark: parsed.data.landmark || null,
      postalCode: parsed.data.postalCode || null,
      ...(coordinates ?? {}),
      ...(parsed.data.coordinateSource !== undefined
        ? { coordinateSource: parsed.data.coordinateSource }
        : {}),
      ...(parsed.data.makeDefault === true ? { makeDefault: true } : {}),
    },
    deps,
  )

  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account/addresses')
  return { status: 'ok', noticeKey: 'address.saved' }
}

/* ------------------------------------------------------------------- update */

export async function updateAddressAction(
  _previous: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const id = IdSchema.safeParse({ id: present(formData, 'id') })
  if (!id.success) return { status: 'error', errorKey: 'errors.unexpected' }

  const parsed = AddressFormSchema.safeParse(readAddressForm(formData))

  if (!parsed.success) {
    const field = firstErrorField(parsed.error)
    return {
      status: 'error',
      errorKey:
        field === 'adminAreaId'
          ? 'errors.areaRequired'
          : field === 'addressLine'
            ? 'errors.addressLineRequired'
            : field === 'recipientPhone'
              ? 'errors.phoneInvalid'
              : field === 'recipientName'
                ? 'errors.nameEmpty'
                : 'errors.unexpected',
      ...(field === undefined ? {} : { field }),
    }
  }

  const coordinates = coordinatesFrom(parsed.data)
  const deps = await locationDeps()

  const result = await updateAddress(
    await currentActor(),
    id.data.id,
    {
      label: parsed.data.label || null,
      recipientName: parsed.data.recipientName,
      recipientPhone: parsed.data.recipientPhone,
      adminAreaId: parsed.data.adminAreaId,
      villageOrArea: parsed.data.villageOrArea || null,
      addressLine: parsed.data.addressLine,
      landmark: parsed.data.landmark || null,
      postalCode: parsed.data.postalCode || null,
      ...(coordinates ?? {}),
      ...(parsed.data.coordinateSource !== undefined
        ? { coordinateSource: parsed.data.coordinateSource }
        : {}),
    },
    deps,
  )

  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account/addresses')
  return { status: 'ok', noticeKey: 'address.saved' }
}

/* ------------------------------------------------------------------- delete */

export async function deleteAddressAction(
  _previous: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const parsed = IdSchema.safeParse({ id: present(formData, 'id') })
  if (!parsed.success) return { status: 'error', errorKey: 'errors.unexpected' }

  const deps = await locationDeps()
  const result = await deleteAddress(await currentActor(), parsed.data.id, deps)
  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account/addresses')
  return { status: 'ok', noticeKey: 'address.removed' }
}

/* -------------------------------------------------------------- set default */

export async function setDefaultAddressAction(
  _previous: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const parsed = IdSchema.safeParse({ id: present(formData, 'id') })
  if (!parsed.success) return { status: 'error', errorKey: 'errors.unexpected' }

  const deps = await locationDeps()
  const result = await setDefaultAddress(await currentActor(), parsed.data.id, deps)
  if (!result.ok) return toActionState(result.error)

  revalidatePath('/account/addresses')
  return { status: 'ok', noticeKey: 'address.defaultChanged' }
}
