import { describe, expect, it } from 'vitest'
import { createLogger, createLoggingErrorReporter, type LogRecord } from './logger.js'
import { maskValue, redact, REDACTED } from './redact.js'

function capture() {
  const records: LogRecord[] = []
  const logger = createLogger({
    level: 'trace',
    sink: (record) => records.push(record),
    now: () => new Date('2026-08-10T10:00:00Z'),
  })
  return { logger, records }
}

describe('redaction by key', () => {
  it('removes secrets wherever they appear, at any depth', () => {
    const result = redact({
      code: '123456',
      nested: { sessionToken: 'abc', payoutAccountRef: '017…', apiKey: 'k' },
      list: [{ password: 'p' }],
    }) as Record<string, unknown>

    expect(result['code']).toBe(REDACTED)
    const nested = result['nested'] as Record<string, unknown>
    expect(nested['sessionToken']).toBe(REDACTED)
    expect(nested['payoutAccountRef']).toBe(REDACTED)
    expect(nested['apiKey']).toBe(REDACTED)
    expect((result['list'] as Record<string, unknown>[])[0]?.['password']).toBe(REDACTED)
  })

  it('masks personal data instead of removing it, so a log stays diagnosable', () => {
    const result = redact({
      phone: '+8801712345678',
      email: 'rahim@example.com',
    }) as Record<string, string>
    expect(result['phone']).toBe('+880171****5678')
    expect(result['email']).toBe('r****@example.com')
  })

  it('leaves ordinary diagnostic values alone', () => {
    const result = redact({ orderId: 'ord-1', count: 3, ok: true }) as Record<string, unknown>
    expect(result).toEqual({ orderId: 'ord-1', count: 3, ok: true })
  })
})

describe('redaction of identity data', () => {
  /*
   * "No raw NID in logs" is a P10 requirement, and a rule enforced only by developer discipline
   * is a rule that fails at 02:00 when somebody is debugging a failed submission. These pin that
   * the redactor catches it whatever the key is called.
   */

  it('removes a national identity number however it is labelled', () => {
    const result = redact({
      nid: '1234567890',
      identityNumber: '1234567890',
      identity_number: '1234567890',
    }) as Record<string, unknown>

    expect(result['nid']).toBe(REDACTED)
    expect(result['identityNumber']).toBe(REDACTED)
    expect(result['identity_number']).toBe(REDACTED)
  })

  it('removes it from a nested payload, which is how it would actually arrive', () => {
    const result = redact({
      submission: { userId: 'u-1', identityNumber: '1234567890' },
    }) as { submission: Record<string, unknown> }

    expect(result.submission['identityNumber']).toBe(REDACTED)
    // The surrounding diagnostic context survives, or the log stops being useful.
    expect(result.submission['userId']).toBe('u-1')
  })

  it('removes a ciphertext too', () => {
    // Not secret in the way the number is, but it is the encrypted form of it and has no business
    // in a log line that will outlive the request.
    const result = redact({ identityNumberCiphertext: 'v1$a$b$c' }) as Record<string, unknown>
    expect(result['identityNumberCiphertext']).toBe(REDACTED)
  })

  it('leaves an already-masked value alone, so a log stays diagnosable', () => {
    // The mask is what the audit trail deliberately records. Redacting it would remove the one
    // thing that tells two submissions apart.
    const result = redact({ maskedDocument: '••••••7890' }) as Record<string, unknown>
    expect(result['maskedDocument']).toBe('••••••7890')
  })
})

describe('redaction by value shape', () => {
  it('catches a phone number that arrived under an innocent key', () => {
    // The realistic failure: someone logs { note: '+8801712345678' } while debugging.
    const result = redact({ note: '+8801712345678' }) as Record<string, string>
    expect(result['note']).toBe('+880171****5678')
  })

  it('catches a bare password hash and a bearer token', () => {
    const result = redact({
      stored: 'scrypt$16384$8$1$c2FsdA$ZGVyaXZlZA',
      header: 'Bearer abc.def.ghi',
    }) as Record<string, string>
    expect(result['stored']).not.toContain('ZGVyaXZlZA')
    expect(result['header']).not.toContain('abc.def.ghi')
  })
})

describe('redaction robustness', () => {
  it('survives cycles', () => {
    const cyclic: Record<string, unknown> = { name: 'a' }
    cyclic['self'] = cyclic
    expect((redact(cyclic) as Record<string, unknown>)['self']).toBe('[circular]')
  })

  it('serialises bigint money, which JSON cannot', () => {
    expect(redact({ totalPoisha: 25600n })).toEqual({ totalPoisha: '25600' })
  })

  it('keeps errors readable but drops their payload', () => {
    const error = new Error('boom', { cause: { secret: 'x' } })
    expect(redact({ error })).toEqual({ error: { name: 'Error', message: 'boom' } })
  })

  it('masks a short value entirely rather than revealing most of it', () => {
    expect(maskValue('short')).toBe(REDACTED)
  })
})

describe('logger', () => {
  it('emits structured JSON with a level and a timestamp', () => {
    const { logger, records } = capture()
    logger.info('order placed', { orderId: 'ord-1' })
    expect(records[0]).toEqual({
      level: 'info',
      time: '2026-08-10T10:00:00.000Z',
      message: 'order placed',
      orderId: 'ord-1',
    })
  })

  it('redacts every payload without the call site asking', () => {
    // This is the property that matters: a developer debugging at 02:00 cannot leak a phone
    // number by forgetting, because forgetting is not an available option.
    const { logger, records } = capture()
    logger.info('otp sent', { phone: '+8801712345678', code: '123456' })
    expect(records[0]?.['phone']).toBe('+880171****5678')
    expect(records[0]?.['code']).toBe(REDACTED)
    expect(JSON.stringify(records[0])).not.toContain('123456')
  })

  it('honours the minimum level', () => {
    const records: LogRecord[] = []
    const logger = createLogger({ level: 'warn', sink: (record) => records.push(record) })
    logger.debug('quiet')
    logger.info('quiet')
    logger.warn('loud')
    logger.error('louder')
    expect(records.map((record) => record.level)).toEqual(['warn', 'error'])
  })

  it('carries request correlation through a child logger', () => {
    const { logger, records } = capture()
    const request = logger.child({ requestId: 'req-9', route: '/api/auth' })
    request.info('handled', { status: 200 })
    expect(records[0]?.['requestId']).toBe('req-9')
    expect(records[0]?.['route']).toBe('/api/auth')
    expect(records[0]?.['status']).toBe(200)
  })

  it('lets per-call context override the base without mutating it', () => {
    const { logger, records } = capture()
    const request = logger.child({ userId: 'user-1' })
    request.info('a', { userId: 'user-2' })
    request.info('b')
    expect(records[0]?.['userId']).toBe('user-2')
    expect(records[1]?.['userId']).toBe('user-1')
  })
})

describe('error reporter', () => {
  it('routes through the logger, so redaction applies to reported errors too', () => {
    const { logger, records } = capture()
    const reporter = createLoggingErrorReporter(logger)
    reporter.report({
      error: new Error('payment failed'),
      context: { orderId: 'ord-1', phone: '+8801712345678' },
    })
    expect(records[0]?.level).toBe('error')
    expect(records[0]?.message).toBe('payment failed')
    expect(records[0]?.['phone']).toBe('+880171****5678')
  })

  it('escalates to fatal when asked', () => {
    const { logger, records } = capture()
    createLoggingErrorReporter(logger).report({
      error: new Error('ledger imbalance'),
      level: 'fatal',
    })
    expect(records[0]?.level).toBe('fatal')
  })
})
