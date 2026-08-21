import type { EmailProvider } from './types.js'

/**
 * Local development: writes the message to the terminal.
 *
 * Unlike the SMS console provider this is NOT refused in production by `parseEnv` — because an
 * absent email channel degrades gracefully (a reminder goes unsent) where an absent SMS channel
 * means nobody can log in at all. Production is still steered to `http` by configuration; this
 * one simply is not a boot-stopping mistake.
 */
export const consoleEmailProvider: EmailProvider = {
  id: 'console',
  send(message) {
    // This adapter's entire purpose is terminal output.
    console.warn(`\n[EMAIL → ${message.to}]\n${message.subject}\n${message.body}\n`)
    return Promise.resolve({ accepted: true, providerRef: `console-${Date.now().toString(36)}` })
  },
}
