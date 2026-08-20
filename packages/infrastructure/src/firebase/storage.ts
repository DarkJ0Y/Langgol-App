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

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { randomUUID } from 'node:crypto'
import type { StoragePort, StorageResult } from '@langgol/application'
import { firebaseConnection } from './app.js'

/**
 * 8 MiB. A modern phone photograph exceeds this only when it has not been resized, and the
 * farmer app resizes before upload — a farmer on a metered 3G connection should not be sending
 * 20 MB either way.
 */
const MAX_BYTES = 8 * 1024 * 1024

/** Images only. Never a document, an archive or anything executable. */
const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
])

function extensionFor(contentType: string): string {
  switch (contentType) {
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/heic':
      return 'heic'
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
}
