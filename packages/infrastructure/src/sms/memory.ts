import type { SmsMessage, SmsProvider } from './types.js'

export interface MemorySmsProvider extends SmsProvider {
  readonly outbox: readonly SmsMessage[]
  failNext(reason: string): void
  clear(): void
}

/** In-process capture for tests. Never registered outside the test environment. */
export function createMemorySmsProvider(): MemorySmsProvider {
  const outbox: SmsMessage[] = []
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
