/**
 * Object storage port.
 *
 * Listing images, delivery proof photos and trip cost receipts are files, and files do not belong
 * in PostgreSQL. `ListingImage.storageKey` and `Delivery.proofPhotoKey` have always been keys
 * into some object store; this is the interface that store sits behind.
 *
 * Provider choice must be a configuration change, not a refactor (docs/03_ARCHITECTURE.md §2.1),
 * so nothing above this interface knows whether the bytes are in Firebase, S3 or a local folder.
 *
 * **Availability is part of the contract.** A farmer on a 3G connection in a field will fail an
 * upload regularly, so `isAvailable` is explicit and every method reports failure as a value
 * rather than throwing — a listing without a photo is still a listing worth publishing.
 */

export type StorageFolder = 'listing-images' | 'delivery-proof' | 'trip-receipts'

export interface StoredObject {
  /** The key persisted on the row. Opaque to callers. */
  readonly storageKey: string
  /** A URL a browser can render. May expire, so it is never persisted. */
  readonly url: string
  readonly contentType: string
  readonly bytes: number
}

export type StorageFailureReason =
  'NOT_CONFIGURED' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'PROVIDER_ERROR'

export type StorageResult =
  | { readonly ok: true; readonly object: StoredObject }
  | { readonly ok: false; readonly reason: StorageFailureReason; readonly detail?: string }

export interface StoragePort {
  /** False when no provider is configured. Callers degrade rather than fail. */
  readonly isAvailable: boolean
  readonly providerName: string

  upload(input: {
    readonly folder: StorageFolder
    readonly filename: string
    readonly contentType: string
    readonly data: Uint8Array
  }): Promise<StorageResult>

  /** A renderable URL for a stored key, or null when it cannot be resolved. */
  publicUrl(storageKey: string): Promise<string | null>
}
