import type { EmailProvider } from './types.js'

export interface HttpEmailConfig {
  readonly apiUrl: string
  readonly apiKey: string
  readonly from: string
  readonly timeoutMs?: number
}

/**
 * Generic HTTP adapter for a transactional email vendor.
 *
 * The payload below is the common from/to/subject/text form. Vendors differ in the details, and
 * this is the one place to adjust when one is chosen — the point of the boundary is that
 * switching vendor never reaches a use case.
 */
export function createHttpEmailProvider(config: HttpEmailConfig): EmailProvider {
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
            from: config.from,
            to: message.to,
            subject: message.subject,
            text: message.body,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          // The body may contain vendor detail, and for email that detail routinely quotes the
          // message — including the verification link. The status is what we act on.
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
