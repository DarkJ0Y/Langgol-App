import { env } from '@langgol/shared'
import { consoleEmailProvider } from './console.js'
import { createMemoryEmailProvider } from './memory.js'
import { createHttpEmailProvider } from './http.js'
import type { EmailProvider } from './types.js'

export * from './types.js'
export { consoleEmailProvider } from './console.js'
export { createMemoryEmailProvider, type MemoryEmailProvider } from './memory.js'
export { createHttpEmailProvider, type HttpEmailConfig } from './http.js'

let instance: EmailProvider | null | undefined

/**
 * Resolve the configured email provider, or null when there is none.
 *
 * Returning null rather than throwing is the deliberate difference from `smsProvider()`. Email
 * is optional to the platform, so "no email provider" is a legitimate deployment rather than a
 * misconfiguration, and every caller has to handle its absence anyway — a throw would only move
 * that handling somewhere less obvious.
 */
export function emailProvider(): EmailProvider | null {
  if (instance !== undefined) return instance

  const config = env()
  switch (config.EMAIL_PROVIDER) {
    case 'http':
      instance = createHttpEmailProvider({
        apiUrl: config.EMAIL_API_URL ?? '',
        apiKey: config.EMAIL_API_KEY ?? '',
        from: config.EMAIL_FROM,
      })
      break
    case 'memory':
      instance = createMemoryEmailProvider()
      break
    case 'console':
      instance = consoleEmailProvider
      break
    case 'none':
      instance = null
      break
  }
  return instance ?? null
}

export function resetEmailProvider(): void {
  instance = undefined
}
