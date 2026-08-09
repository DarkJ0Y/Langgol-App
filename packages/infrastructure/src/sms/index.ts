import { env } from '@langgol/shared'
import { consoleSmsProvider } from './console.js'
import { createMemorySmsProvider } from './memory.js'
import { createHttpSmsProvider } from './http.js'
import type { SmsProvider } from './types.js'

export * from './types.js'
export { consoleSmsProvider } from './console.js'
export { createMemorySmsProvider, type MemorySmsProvider } from './memory.js'
export { createHttpSmsProvider, type HttpSmsConfig } from './http.js'

let instance: SmsProvider | undefined

/**
 * Resolve the configured SMS provider.
 *
 * `parseEnv` has already refused to boot with a console or memory provider in production, so
 * this function cannot select a fake one there. That check lives at startup rather than here
 * because a misconfiguration should stop a deployment, not the first login.
 */
export function smsProvider(): SmsProvider {
  if (instance !== undefined) return instance

  const config = env()
  switch (config.SMS_PROVIDER) {
    case 'http':
      instance = createHttpSmsProvider({
        apiUrl: config.SMS_API_URL ?? '',
        apiKey: config.SMS_API_KEY ?? '',
        senderId: config.SMS_SENDER_ID,
      })
      break
    case 'memory':
      instance = createMemorySmsProvider()
      break
    case 'console':
      instance = consoleSmsProvider
      break
  }
  return instance
}

export function resetSmsProvider(): void {
  instance = undefined
}
