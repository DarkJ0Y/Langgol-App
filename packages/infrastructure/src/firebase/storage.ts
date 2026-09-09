/**
 * Firebase Cloud Storage adapter.
 *
 * Backs `StoragePort` with the bucket from `FIREBASE_STORAGE_BUCKET`. Keys are namespaced by
 * folder and made unguessable, because a sequential key lets anyone enumerate every farmer's
 * photographs by counting.
 *
 * Two limits are enforced here rather than trusted to the caller: a size cap and a content-type
 * allowlist. An upload endpoint without both is a free file host with someone else's bill.
 */

import { getStorage, ref, uploadBytes, getBytes, getDownloadURL } from 'firebase/storage'
import { randomUUID } from 'node:crypto'
import type { DownloadedObject, StoragePort, StorageResult } from '@langgol/application'
import { isPrivateFolder } from '@langgol/application'
import { firebaseConnection } from './app.js'

/**
 * 8 MiB. A modern phone photograph exceeds this only when it has not been resized, and the
 * farmer app resizes before upload — a farmer on a metered 3G connection should not be sending
 * 20 MB either way.
 */
const MAX_BYTES = 8 * 1024 * 1024

/** Images only. Never an archive or anything executable. */
const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  // KYC evidence may be a scan, and a scanner produces a PDF. Judged in far more detail by
  // `domain/kyc/documents.ts`, which also checks the bytes against the declared type; this set
  // is the adapter's own floor, not the whole rule.
  'application/pdf',
])

/**
 * Which stored keys are private.
 *
 * Derived from the key's own prefix rather than remembered by the caller. `publicUrl` receives a
 * key and nothing else, so this is the only thing it can check — and a private object escaping
 * through it would undo every access control above.
 */
function keyIsPrivate(storageKey: string): boolean {
  const folder = storageKey.split('/')[0] ?? ''
  return isPrivateFolder(folder as never)
}

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/heic':
      return 'heic'
    case 'application/pdf':
      return 'pdf'
    default:
      return 'jpg'
  }
}

export const firebaseStorage: StoragePort = {
  get isAvailable(): boolean {
    return firebaseConnection() !== null
  },

  providerName: 'firebase-storage',

  async upload(input): Promise<StorageResult> {
    const connection = firebaseConnection()
    if (!connection) {
      return {
        ok: false,
        reason: 'NOT_CONFIGURED',
        detail: 'FIREBASE_PROJECT_ID, FIREBASE_API_KEY and FIREBASE_APP_ID must all be set',
      }
    }

    if (input.data.byteLength > MAX_BYTES) {
      return {
        ok: false,
        reason: 'TOO_LARGE',
        detail: `${String(input.data.byteLength)} bytes exceeds the ${String(MAX_BYTES)} byte limit`,
      }
    }

    if (!ALLOWED_TYPES.has(input.contentType)) {
      return {
        ok: false,
        reason: 'UNSUPPORTED_TYPE',
        detail: `${input.contentType} is not an accepted image type`,
      }
    }

    // Unguessable by construction: a sequential key would let anyone walk every farmer's photos.
    const storageKey = `${input.folder}/${randomUUID()}.${extensionFor(input.contentType)}`

    try {
      const storage = getStorage(connection.app)
      const handle = ref(storage, storageKey)
      await uploadBytes(handle, input.data, { contentType: input.contentType })
      const url = await getDownloadURL(handle)

      return {
        ok: true,
        object: {
          storageKey,
          url,
          contentType: input.contentType,
          bytes: input.data.byteLength,
        },
      }
    } catch (cause) {
      // A failed upload must not take a listing down with it, so this is a value, not a throw.
      return {
        ok: false,
        reason: 'PROVIDER_ERROR',
        detail: cause instanceof Error ? cause.message : 'Unknown storage error',
      }
    }
  },

  async publicUrl(storageKey: string): Promise<string | null> {
    /*
     * A private object has no public URL, and asking for one is a bug rather than a request to
     * be served. Firebase's `getDownloadURL` mints a link that does not expire and is bound to
     * nobody, so returning one for a KYC document would put a permanent, transferable link to
     * somebody's identity card wherever it was rendered.
     */
    if (keyIsPrivate(storageKey)) return null

    const connection = firebaseConnection()
    if (!connection) return null

    try {
      return await getDownloadURL(ref(getStorage(connection.app), storageKey))
    } catch {
      // A missing object is a normal outcome — a deleted image, a stale key — not an error worth
      // propagating to a page render.
      return null
    }
  },

  /**
   * Fetch the bytes for an authorized route to stream.
   *
   * The content type is not stored alongside the object by this adapter, so it is recovered from
   * the key's extension — which is safe precisely because the extension was chosen by
   * `extensionFor` from a validated content type at upload time, never from a filename the
   * uploader supplied.
   */
  async download(storageKey: string): Promise<DownloadedObject | null> {
    const connection = firebaseConnection()
    if (!connection) return null

    try {
      const bytes = await getBytes(ref(getStorage(connection.app), storageKey))
      return { contentType: typeForKey(storageKey), data: new Uint8Array(bytes) }
    } catch {
      return null
    }
  },
}

function typeForKey(storageKey: string): string {
  const extension = storageKey.slice(storageKey.lastIndexOf('.') + 1).toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'heic':
      return 'image/heic'
    case 'pdf':
      return 'application/pdf'
    default:
      return 'image/jpeg'
  }
}
