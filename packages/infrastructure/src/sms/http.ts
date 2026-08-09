import type { SmsProvider } from './types.js'

export interface HttpSmsConfig {
  readonly apiUrl: string
  readonly apiKey: string
  readonly senderId: string
  readonly timeoutMs?: number
}

/**
 * Generic HTTP adapter for a Bangladeshi SMS aggregator.
 *
 * Aggregators differ in payload shape; the request body below is the common
 * sender/recipient/message form and is the one place to adjust when a vendor is chosen. What
 * matters architecturally is that the vendor lives behind this boundary: switching aggregator
 * — which happens when delivery rates on one operator degrade — must not touch a use case.
 */
export function createHttpSmsProvider(config: HttpSmsConfig): SmsProvider {
  const timeoutMs = config.timeoutMs ?? 10_000

  return {
    id: 'http',
    async send(message) {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, timeoutMs)

      try {
        const response = await fetch(config.apiUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            sender: config.senderId,
            to: message.to,
            message: message.body,
            type: message.unicode ? 'unicode' : 'text',
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          // The body may contain vendor detail; the status is what we act on.
          return { accepted: false, error: `HTTP ${String(response.status)}` }
        }

        const providerRef = response.headers.get('x-message-id') ?? undefined
        return providerRef === undefined ? { accepted: true } : { accepted: true, providerRef }
      } catch (error) {
        return {
          accepted: false,
          error: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
