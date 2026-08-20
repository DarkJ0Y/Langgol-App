/**
 * Firebase connection.
 *
 * Firebase is a connected **service**, not the system of record. PostgreSQL stays authoritative
 * for money, inventory and the ledger, because those invariants are enforced by the database
 * itself — the deferred balanced-transaction trigger, the atomic conditional inventory UPDATE,
 * the append-only rules and the CHECK constraints. Firestore cannot express any of them, and
 * docs/06_FINANCIAL_ARCHITECTURE.md §13 requires that an unbalanced transaction be prevented
 * "by a database trigger, not by hope".
 *
 * What Firebase is used for here is what it is genuinely good at: object storage for listing
 * images and delivery proof, and (later) push notifications to the `PUSH` channel the schema
 * already declares.
 *
 * The app is initialised **lazily and optionally**. An unconfigured environment is a supported
 * state, not an error: the adapters report themselves unavailable and callers degrade, because a
 * farmer must still be able to publish a listing when an image upload fails.
 */

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { env } from '@langgol/shared'

export interface FirebaseConnection {
  readonly app: FirebaseApp
  readonly projectId: string
  readonly storageBucket: string
}

let cached: FirebaseConnection | null | undefined

/** The config, or null when Firebase is not configured in this environment. */
function readConfig(): {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId?: string
} | null {
  const configuration = env()

  const projectId = configuration.FIREBASE_PROJECT_ID
  const apiKey = configuration.FIREBASE_API_KEY
  const appId = configuration.FIREBASE_APP_ID

  // All three are required to reach Firebase at all. Any one missing means "not configured"
  // rather than "misconfigured", which is a normal state in CI and in tests.
  if (!projectId || !apiKey || !appId) return null

  return {
    apiKey,
    authDomain: configuration.FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: configuration.FIREBASE_STORAGE_BUCKET ?? `${projectId}.firebasestorage.app`,
    messagingSenderId: configuration.FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId,
    ...(configuration.FIREBASE_MEASUREMENT_ID
      ? { measurementId: configuration.FIREBASE_MEASUREMENT_ID }
      : {}),
  }
}

/**
 * The initialised app, or null when Firebase is not configured.
 *
 * Cached on first call. `getApps()` is checked because Next.js hot-reload re-evaluates modules,
 * and initialising twice throws.
 */
export function firebaseConnection(): FirebaseConnection | null {
  if (cached !== undefined) return cached

  const config = readConfig()
  if (!config) {
    cached = null
    return null
  }

  const existing = getApps()
  const app = existing.length > 0 ? existing[0]! : initializeApp(config)

  cached = { app, projectId: config.projectId, storageBucket: config.storageBucket }
  return cached
}

export function isFirebaseConfigured(): boolean {
  return readConfig() !== null
}

/**
 * The config a browser needs, for a server component to pass to a client component.
 *
 * A Firebase web apiKey is a public project identifier, not a credential — it is in every
 * client bundle of every Firebase app. It is passed as a prop rather than through a
 * `NEXT_PUBLIC_*` variable because CI rejects public variables named `*KEY*`, and defeating that
 * control to save a prop would be a poor trade.
 */
export function browserFirebaseConfig(): Record<string, string> | null {
  const config = readConfig()
  if (!config) return null
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => typeof value === 'string' && value.length > 0),
  ) as Record<string, string>
}

/** Drop the cached app. Tests only. */
export function resetFirebaseConnection(): void {
  cached = undefined
}
