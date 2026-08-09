import type { SmsProvider } from './types.js'

/**
 * Local development: writes the message to the terminal.
 *
 * Refuses to exist in production — `parseEnv` rejects a non-HTTP provider there, because a
 * console "provider" in production means nobody receives an OTP and every login fails silently.
 */
export const consoleSmsProvider: SmsProvider = {
  id: 'console',
  send(message) {
    // This adapter's entire purpose is terminal output.
    console.warn(`\n[SMS → ${message.to}]\n${message.body}\n`)
    return Promise.resolve({ accepted: true, providerRef: `console-${Date.now().toString(36)}` })
  },
}
