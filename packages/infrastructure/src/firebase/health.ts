/**
 * Firebase connectivity check.
 *
 * Deliberately makes a **real network call** rather than reporting "configured" and hoping. A
 * config object that parses proves nothing: the project can be deleted, the bucket renamed, the
 * key restricted to other referrers. The distinction between "we have credentials" and "we can
 * reach the service" is the whole point of a health check.
 */

import { browserFirebaseConfig, firebaseConnection } from './app.js'

export interface FirebaseHealth {
  readonly configured: boolean
  readonly reachable: boolean
  readonly projectId: string | null
  readonly storageBucket: string | null
  readonly checkedAt: string
  readonly detail: string
}

/**
 * Verify the project is actually reachable.
 *
 * Uses the Identity Toolkit config endpoint: it is unauthenticated, cheap, and answers exactly
 * the question asked — does this apiKey resolve to a live project? A 400 with
 * `CONFIGURATION_NOT_FOUND` means the key is valid but the project has no Identity Toolkit
 * config, which still proves the project exists and the key works.
 */
export async function checkFirebase(timeoutMs = 5000): Promise<FirebaseHealth> {
  const checkedAt = new Date().toISOString()
  const connection = firebaseConnection()
  const config = browserFirebaseConfig()

  if (!connection || !config) {
    return {
      configured: false,
      reachable: false,
      projectId: null,
      storageBucket: null,
      checkedAt,
      detail: 'Firebase is not configured in this environment',
    }
  }

  const base = {
    configured: true,
    projectId: connection.projectId,
    storageBucket: connection.storageBucket,
    checkedAt,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(config['apiKey'] ?? '')}`,
      { signal: controller.signal },
    )

    // 200 = reachable and readable. 400/403 = the key reached Google and Google answered, which
    // is still proof of connectivity; only a network failure means unreachable.
    const reachable = response.status < 500
    return {
      ...base,
      reachable,
      detail: reachable
        ? `Reached Firebase (HTTP ${String(response.status)})`
        : `Firebase returned HTTP ${String(response.status)}`,
    }
  } catch (cause) {
    return {
      ...base,
      reachable: false,
      detail: cause instanceof Error ? cause.message : 'Network error reaching Firebase',
    }
  } finally {
    clearTimeout(timer)
  }
}
