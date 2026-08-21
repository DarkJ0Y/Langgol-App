/**
 * A user's address book: list, create, update, delete, set default.
 *
 * Every operation is scoped to the signed-in actor. There is no `userId` parameter on any of
 * them — the owner is the actor, always — and the repository puts ownership in the WHERE clause,
 * so another user's address is *not found* rather than found-and-refused. Those are different
 * answers: the second one confirms the address exists.
 *
 * The `AdminArea` tree is the primary location model and is not duplicated here. An address
 * points into it; the area's own validity (does this id exist, is it deep enough to deliver to)
 * is checked against the tree rather than re-encoded.
 *
 * **GPS is optional and never collected implicitly.** Coordinates arrive only when a caller
 * passes them, the precision recorded says where they came from, and an address with none is a
 * complete address — which for most of rural Bangladesh it is.
 *
 * Refs: docs/07_SECURITY.md §4.3; docs/08_BANGLADESH_CONTEXT.md §2
 */

import { allowed, isActor, type MaybeActor } from '@langgol/domain/policy'
import {
  AddressError,
  DEFAULT_COUNTRY,
  isDeepEnoughForAddress,
  precisionFor,
  validateAddress,
  type LocationPrecision,
} from '@langgol/domain/location'
import { Errors, err, ok, type AppError, type Result } from '@langgol/shared'
import type {
  AddressBookRepository,
  AddressRecord,
  AdminAreaRepository,
  AuditPort,
  Clock,
} from '../../ports/index.js'

/**
 * A cap, so one account cannot fill the table.
 *
 * Generous on purpose — a trader may genuinely deliver to a dozen markets, and a limit that bites
 * a real user is a bug reported as "the app is broken".
 */
const MAX_ADDRESSES_PER_USER = 30

export interface AddressDeps {
  readonly clock: Clock
  readonly addresses: AddressBookRepository
  readonly areas: AdminAreaRepository
  readonly audit: AuditPort
}

/** Where the coordinates came from. Decides the precision recorded; never sent by the client. */
export type CoordinateSource = 'DEVICE_GPS' | 'MAP_PIN' | 'NONE'

export interface AddressCommand {
  readonly label?: string | null
  readonly recipientName?: string
  readonly recipientPhone?: string
  readonly countryCode?: string
  readonly adminAreaId?: string
  readonly villageOrArea?: string | null
  readonly addressLine?: string
  readonly landmark?: string | null
  readonly postalCode?: string | null
  readonly latitude?: number | null
  readonly longitude?: number | null
  readonly coordinateSource?: CoordinateSource
  readonly makeDefault?: boolean
}

function validationError(error: unknown): AppError | null {
  return error instanceof AddressError
    ? Errors.validation(error.message, { field: error.field, code: error.code })
    : null
}

/**
 * Check the area exists and is specific enough to deliver to.
 *
 * A division id is a real id and would pass a foreign key, but "somewhere in Rajshahi" is not an
 * address — it is eight thousand square kilometres.
 */
async function checkArea(areaId: string, areas: AdminAreaRepository): Promise<AppError | null> {
  const area = await areas.findById(areaId)
  if (area === null) {
    return Errors.validation('That area was not found', { field: 'adminAreaId' })
  }
  if (!isDeepEnoughForAddress(area.level)) {
    return Errors.validation('Choose at least an upazila', { field: 'adminAreaId' })
  }
  return null
}

/* -------------------------------------------------------------------- list */

export async function listAddresses(
  actor: MaybeActor,
  deps: AddressDeps,
): Promise<Result<readonly AddressRecord[], AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'address:read', { ownerUserId: actor.userId })) {
    return err(Errors.forbidden())
  }
  return ok(await deps.addresses.listForUser(actor.userId))
}

/* --------------------------------------------------------------------- get */

/**
 * One address, by id, owned by the caller.
 *
 * The read counterpart of `updateAddress`, and it answers the same way: an address belonging to
 * someone else is NOT FOUND. Exists so an edit screen can load a single row rather than fetching
 * the whole address book to render one of them.
 */
export async function getAddress(
  actor: MaybeActor,
  addressId: string,
  deps: AddressDeps,
): Promise<Result<AddressRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const address = await deps.addresses.findOwned(addressId, actor.userId)
  if (address === null) return err(Errors.notFound('Address'))

  if (!allowed(actor, 'address:read', { ownerUserId: address.userId })) {
    return err(Errors.forbidden())
  }

  return ok(address)
}

/* ------------------------------------------------------------------ create */

export async function createAddress(
  actor: MaybeActor,
  command: AddressCommand,
  deps: AddressDeps,
): Promise<Result<AddressRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())
  if (!allowed(actor, 'address:create')) return err(Errors.forbidden())

  const existing = await deps.addresses.countForUser(actor.userId)
  if (existing >= MAX_ADDRESSES_PER_USER) {
    return err(Errors.validation('You have reached the maximum number of saved addresses'))
  }

  const source = command.coordinateSource ?? 'NONE'
  const hasCoordinates =
    command.latitude !== undefined &&
    command.latitude !== null &&
    command.longitude !== undefined &&
    command.longitude !== null

  let validated
  try {
    validated = validateAddress({
      label: command.label ?? null,
      recipientName: command.recipientName ?? '',
      recipientPhone: command.recipientPhone ?? '',
      countryCode: command.countryCode ?? DEFAULT_COUNTRY,
      adminAreaId: command.adminAreaId ?? '',
      villageOrArea: command.villageOrArea ?? null,
      addressLine: command.addressLine ?? '',
      landmark: command.landmark ?? null,
      postalCode: command.postalCode ?? null,
      latitude: command.latitude ?? null,
      longitude: command.longitude ?? null,
    })
  } catch (error) {
    const mapped = validationError(error)
    if (mapped) return err(mapped)
    throw error
  }

  const areaProblem = await checkArea(validated.adminAreaId ?? '', deps.areas)
  if (areaProblem) return err(areaProblem)

  /*
   * The first address becomes the default whether or not it was asked for. A user with exactly
   * one address and no default is a checkout that cannot preselect anything, for no reason.
   */
  const makeDefault = command.makeDefault === true || existing === 0

  const created = await deps.addresses.create({
    userId: actor.userId,
    address: {
      label: validated.label ?? null,
      recipientName: validated.recipientName ?? '',
      recipientPhone: validated.recipientPhone ?? '',
      countryCode: validated.countryCode ?? DEFAULT_COUNTRY,
      adminAreaId: validated.adminAreaId ?? '',
      villageOrArea: validated.villageOrArea ?? null,
      addressLine: validated.addressLine ?? '',
      landmark: validated.landmark ?? null,
      postalCode: validated.postalCode ?? null,
      latitude: validated.latitude ?? null,
      longitude: validated.longitude ?? null,
      precision: precisionFor({ hasCoordinates, source }),
    },
    makeDefault,
  })

  /*
   * Audited with the area and whether a pin was attached — never the address line, the recipient
   * name or the coordinates. Those are the parts that identify where a person lives, and the
   * audit table has a different retention policy from the addresses table. docs/07 §11
   */
  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'ADDRESS_CREATED',
    entityType: 'address',
    entityId: created.id,
    meta: { area: created.adminAreaId, precision: created.precision },
  })

  return ok(created)
}

/* ------------------------------------------------------------------ update */

export async function updateAddress(
  actor: MaybeActor,
  addressId: string,
  command: AddressCommand,
  deps: AddressDeps,
): Promise<Result<AddressRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  // Read it as the owner first: this is what makes someone else's address indistinguishable from
  // one that does not exist.
  const current = await deps.addresses.findOwned(addressId, actor.userId)
  if (current === null) return err(Errors.notFound('Address'))

  if (!allowed(actor, 'address:update', { ownerUserId: current.userId })) {
    return err(Errors.forbidden())
  }

  let validated
  try {
    validated = validateAddress({
      ...(command.label !== undefined ? { label: command.label } : {}),
      ...(command.recipientName !== undefined ? { recipientName: command.recipientName } : {}),
      ...(command.recipientPhone !== undefined ? { recipientPhone: command.recipientPhone } : {}),
      ...(command.countryCode !== undefined ? { countryCode: command.countryCode } : {}),
      ...(command.adminAreaId !== undefined ? { adminAreaId: command.adminAreaId } : {}),
      ...(command.villageOrArea !== undefined ? { villageOrArea: command.villageOrArea } : {}),
      ...(command.addressLine !== undefined ? { addressLine: command.addressLine } : {}),
      ...(command.landmark !== undefined ? { landmark: command.landmark } : {}),
      ...(command.postalCode !== undefined ? { postalCode: command.postalCode } : {}),
      ...(command.latitude !== undefined ? { latitude: command.latitude } : {}),
      ...(command.longitude !== undefined ? { longitude: command.longitude } : {}),
      // The stored country decides whether a pin has to be inside Bangladesh.
      ...(command.countryCode === undefined ? { countryCode: current.countryCode } : {}),
    })
  } catch (error) {
    const mapped = validationError(error)
    if (mapped) return err(mapped)
    throw error
  }

  if (validated.adminAreaId !== undefined) {
    const areaProblem = await checkArea(validated.adminAreaId, deps.areas)
    if (areaProblem) return err(areaProblem)
  }

  const changes: Partial<Parameters<AddressBookRepository['update']>[0]['changes']> = {}
  for (const key of [
    'label',
    'recipientName',
    'recipientPhone',
    'countryCode',
    'adminAreaId',
    'villageOrArea',
    'addressLine',
    'landmark',
    'postalCode',
  ] as const) {
    // Only keys the CALLER supplied. `validated` carries a country we may have filled in above.
    if (command[key] !== undefined && validated[key] !== undefined) {
      Object.assign(changes, { [key]: validated[key] })
    }
  }

  /*
   * Coordinates move together, and so does the precision that describes them. Writing a new pin
   * while leaving a stale `EXACT` behind would claim a GPS fix for a point someone dragged.
   */
  if (command.latitude !== undefined || command.longitude !== undefined) {
    const latitude = validated.latitude ?? null
    const longitude = validated.longitude ?? null
    const hasCoordinates = latitude !== null && longitude !== null
    Object.assign(changes, {
      latitude,
      longitude,
      precision: precisionFor({
        hasCoordinates,
        source: hasCoordinates ? (command.coordinateSource ?? 'MAP_PIN') : 'NONE',
      }) satisfies LocationPrecision,
    })
  }

  if (Object.keys(changes).length === 0) return ok(current)

  const updated = await deps.addresses.update({
    addressId,
    userId: actor.userId,
    changes,
  })
  if (updated === null) return err(Errors.notFound('Address'))

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'ADDRESS_UPDATED',
    entityType: 'address',
    entityId: addressId,
    // Field NAMES only. What changed is what an investigation needs; the values are where a
    // person lives.
    reason: Object.keys(changes).sort().join(','),
  })

  return ok(updated)
}

/* ------------------------------------------------------------------ delete */

export interface DeleteAddressResult {
  readonly deleted: boolean
  /** Whichever address took over as default, when the deleted one held it. */
  readonly promotedId: string | null
}

export async function deleteAddress(
  actor: MaybeActor,
  addressId: string,
  deps: AddressDeps,
): Promise<Result<DeleteAddressResult, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const current = await deps.addresses.findOwned(addressId, actor.userId)
  if (current === null) return err(Errors.notFound('Address'))

  if (!allowed(actor, 'address:delete', { ownerUserId: current.userId })) {
    return err(Errors.forbidden())
  }

  /*
   * Soft delete. Orders reference the address they were delivered to, and a hard delete would
   * either break that reference or rewrite delivery history — neither is acceptable for a record
   * that money moved against.
   */
  const result = await deps.addresses.softDelete({
    addressId,
    userId: actor.userId,
    at: deps.clock.now(),
  })

  if (result.deleted) {
    await deps.audit.record({
      actorUserId: actor.userId,
      action: 'ADDRESS_DELETED',
      entityType: 'address',
      entityId: addressId,
      ...(result.promotedId === null ? {} : { reason: `promoted=${result.promotedId}` }),
    })
  }

  return ok(result)
}

/* ------------------------------------------------------------- set default */

export async function setDefaultAddress(
  actor: MaybeActor,
  addressId: string,
  deps: AddressDeps,
): Promise<Result<AddressRecord, AppError>> {
  if (!isActor(actor)) return err(Errors.unauthenticated())

  const current = await deps.addresses.findOwned(addressId, actor.userId)
  if (current === null) return err(Errors.notFound('Address'))

  if (!allowed(actor, 'address:update', { ownerUserId: current.userId })) {
    return err(Errors.forbidden())
  }

  if (current.isDefault) return ok(current)

  const updated = await deps.addresses.setDefault({ addressId, userId: actor.userId })
  if (updated === null) return err(Errors.notFound('Address'))

  await deps.audit.record({
    actorUserId: actor.userId,
    action: 'ADDRESS_DEFAULT_CHANGED',
    entityType: 'address',
    entityId: addressId,
  })

  return ok(updated)
}
