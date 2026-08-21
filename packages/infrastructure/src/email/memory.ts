import type { EmailMessage, EmailProvider } from './types.js'

export interface MemoryEmailProvider extends EmailProvider {
  readonly outbox: readonly EmailMessage[]
  failNext(reason: string): void
  clear(): void
}

/** In-process capture for tests. Never registered outside the test environment. */
export function createMemoryEmailProvider(): MemoryEmailProvider {
  const outbox: EmailMessage[] = []
  let failure: string | null = null

  return {
    id: 'memory',
    outbox,
    failNext(reason) {
      failure = reason
    },
    clear() {
      outbox.length = 0
      failure = null
    },
    send(message) {
      if (failure !== null) {
        const error = failure
        failure = null
        return Promise.resolve({ accepted: false, error })
      }
      outbox.push(message)
      return Promise.resolve({ accepted: true, providerRef: `memory-${String(outbox.length)}` })
    },
  }
}
