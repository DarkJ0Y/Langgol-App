/**
 * In-memory object storage.
 *
 * The counterpart of the memory SMS and email transports, and it exists for the same reason: a
 * flow that cannot be exercised without a cloud account is a flow that goes untested. KYC has
 * documents at the centre of it, so without this the submission path could only be tested with
 * the storage port mocked at every call site — which tests the mock.
 *
 * Not for production, and it says so: `providerName` names itself, and the environment check in
 * `packages/shared/src/env.ts` refuses pretend providers in a production deployment for the
 * transports that already have this shape.
 *
 * It enforces the same size and type rules as the real adapter. A memory transport that accepted
 * what Firebase would reject would let a test pass on a submission production refuses.
 */

import { randomUUID } from 'node:crypto'
import { isPrivateFolder } from '@langgol/application'
import type { DownloadedObject, StoragePort, StorageResult } from '@langgol/application'

const MAX_BYTES = 8 * 1024 * 1024

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
])

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

interface StoredBytes {
  readonly contentType: string
  readonly data: Uint8Array
}

const objects = new Map<string, StoredBytes>()

export const memoryStorage: StoragePort = {
  isAvailable: true,
  providerName: 'memory',

  async upload(input): Promise<StorageResult> {
    if (input.data.byteLength > MAX_BYTES) {
      return { ok: false, reason: 'TOO_LARGE' }
    }
    if (!ALLOWED_TYPES.has(input.contentType)) {
      return { ok: false, reason: 'UNSUPPORTED_TYPE' }
    }

    // Unguessable, exactly as the real adapter builds them: a test that relied on a predictable
    // key would be testing something production does not do.
    const storageKey = `${input.folder}/${randomUUID()}.${extensionFor(input.contentType)}`
    objects.set(storageKey, { contentType: input.contentType, data: input.data })

    return {
      ok: true,
      object: {
        storageKey,
        // A private object gets no URL even here. The point of the memory adapter is to behave
        // like the real one, and the real one must never hand out a link to a KYC document.
        url: isPrivateFolder(input.folder) ? '' : `memory://${storageKey}`,
        contentType: input.contentType,
        bytes: input.data.byteLength,
      },
    }
  },

  async publicUrl(storageKey: string): Promise<string | null> {
    const folder = storageKey.split('/')[0] ?? ''
    if (isPrivateFolder(folder as never)) return null
    return objects.has(storageKey) ? `memory://${storageKey}` : null
  },

  async download(storageKey: string): Promise<DownloadedObject | null> {
    return objects.get(storageKey) ?? null
  },
}

/** Empties the store. Tests only. */
export function resetMemoryStorage(): void {
  objects.clear()
}

/** How many objects are held. Lets a test assert an upload happened without guessing its key. */
export function memoryStorageSize(): number {
  return objects.size
}
