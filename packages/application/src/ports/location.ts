/**
 * Ports for reading the administrative tree and managing a user's addresses.
 *
 * Separate from `AddressRepository` in marketplace.ts, which answers exactly one question —
 * "resolve this buyer's delivery destination for a quote" — and should keep answering only that.
 * A port that grows a method every time a screen appears stops being a boundary.
 *
 * Every method here that touches an address takes the owner's `userId` and is expected to put it
 * in the WHERE clause rather than filter afterwards. An address belonging to someone else must be
 * *not found*, not found-then-rejected: the difference is whether the existence of another user's
 * address is observable.
 *
 * Refs: docs/07_SECURITY.md §4.3; docs/08_BANGLADESH_CONTEXT.md §2
 */

import type { AreaLevel, LocationPrecision } from '@langgol/domain/location'

export interface AdminAreaRecord {
  readonly id: string
  readonly level: AreaLevel
  readonly parentId: string | null
  readonly nameBn: string
  readonly nameEn: string
  readonly hasCentroid: boolean
}

export interface AdminAreaRepository {
  /**
   * Children of a node, or the roots when `parentId` is null.
   *
   * The picker walks the tree one level at a time rather than loading it whole: ~4,500 unions is
   * a payload no farmer on a metered connection should pay for to choose one.
   */
  listChildren(parentId: string | null): Promise<readonly AdminAreaRecord[]>

  /** Root-to-node chain, coarse first. Empty when the id is unknown. */
  resolvePath(areaId: string): Promise<readonly AdminAreaRecord[]>

  findById(areaId: string): Promise<AdminAreaRecord | null>
}

/** An address as the account surface reads it. */
export interface AddressRecord {
  readonly id: string
  readonly userId: string
  readonly label: string | null
  readonly recipientName: string
  readonly recipientPhone: string
  readonly countryCode: string
  readonly adminAreaId: string
  readonly villageOrArea: string | null
  readonly addressLine: string
  readonly landmark: string | null
  readonly postalCode: string | null
  readonly latitude: number | null
  readonly longitude: number | null
  readonly precision: LocationPrecision
  readonly isDefault: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
  /** Root-to-leaf area chain, so a caller can render "Rajshahi, Bogura, Shibganj" without a join. */
  readonly areaPath: readonly AdminAreaRecord[]
}

export interface AddressWriteInput {
  readonly label: string | null
  readonly recipientName: string
  readonly recipientPhone: string
  readonly countryCode: string
  readonly adminAreaId: string
  readonly villageOrArea: string | null
  readonly addressLine: string
  readonly landmark: string | null
  readonly postalCode: string | null
  readonly latitude: number | null
  readonly longitude: number | null
  readonly precision: LocationPrecision
}

export interface AddressBookRepository {
  /** Every live address for a user, default first. */
  listForUser(userId: string): Promise<readonly AddressRecord[]>

  /** Ownership is part of the query — another user's address is not found. */
  findOwned(addressId: string, userId: string): Promise<AddressRecord | null>

  countForUser(userId: string): Promise<number>

  /**
   * Create an address, optionally as the default.
   *
   * Making it default must clear the previous one in the SAME transaction: a partial unique index
   * enforces one default per user, so two statements would either fail or leave a window with
   * none.
   */
  create(input: {
    readonly userId: string
    readonly address: AddressWriteInput
    readonly makeDefault: boolean
  }): Promise<AddressRecord>

  /** Apply a PARTIAL update. Only the keys present are written. Null when not owned. */
  update(input: {
    readonly addressId: string
    readonly userId: string
    readonly changes: Partial<AddressWriteInput>
  }): Promise<AddressRecord | null>

  /**
   * Soft-delete. Returns the id of whichever address became default afterwards, if the deleted
   * one held it — a user who deletes their default should not be left with none.
   */
  softDelete(input: {
    readonly addressId: string
    readonly userId: string
    readonly at: Date
  }): Promise<{ readonly deleted: boolean; readonly promotedId: string | null }>

  /** Move the default flag. Atomic for the same reason `create` is. */
  setDefault(input: {
    readonly addressId: string
    readonly userId: string
  }): Promise<AddressRecord | null>
}
