/**
 * A resolved, immutable view of platform configuration at a point in time.
 *
 * Every quote and order records the `configVersions` it was priced under, so a price computed
 * today can be reproduced exactly years later — including after the rate has changed three
 * times. That reproducibility is the whole reason configuration is versioned rather than
 * mutable.
 *
 * Refs: docs/03_ARCHITECTURE.md §7; docs/06_FINANCIAL_ARCHITECTURE.md §4
 */

import { configSchemas, isConfigKey, type ConfigKey, type ConfigValue } from './keys.js'

export class ConfigError extends Error {
  readonly code: 'NOT_SET' | 'INVALID' | 'UNKNOWN_KEY'
  readonly key: string

  constructor(code: 'NOT_SET' | 'INVALID' | 'UNKNOWN_KEY', key: string, message: string) {
    super(message)
    this.name = 'ConfigError'
    this.code = code
    this.key = key
  }
}

export interface ConfigEntry {
  readonly key: string
  readonly version: number
  /** `null` means the value is an open product decision, not that it is absent by accident. */
  readonly value: unknown
}

export interface ConfigSnapshot {
  /** Resolved at this instant; entries effective later are excluded. */
  readonly resolvedAt: Date
  /** Key → version, stamped onto anything priced under this snapshot. */
  readonly versions: Readonly<Record<string, number>>
  /** Keys present but awaiting a product decision. */
  readonly unsetKeys: readonly ConfigKey[]
  /** Keys the code knows about but the database has never been given. */
  readonly missingKeys: readonly ConfigKey[]

  /** Read a value, or `undefined` if it is unset or missing. */
  get<K extends ConfigKey>(key: K): ConfigValue<K> | undefined
  /** Read a value, or throw `ConfigError('NOT_SET')`. Never substitutes a default. */
  require<K extends ConfigKey>(key: K): ConfigValue<K>
  has(key: ConfigKey): boolean
}

/**
 * Build a snapshot from raw entries.
 *
 * Unknown keys are ignored rather than fatal: a newer deployment may have written configuration
 * this build does not know about, and refusing to start would turn a forward-compatible change
 * into an outage. Known keys with an invalid shape ARE fatal — a malformed commission rate is
 * not something to shrug at.
 */
export function createConfigSnapshot(
  entries: readonly ConfigEntry[],
  resolvedAt: Date,
): ConfigSnapshot {
  const values = new Map<ConfigKey, unknown>()
  const versions: Record<string, number> = {}
  const unsetKeys: ConfigKey[] = []

  for (const entry of entries) {
    if (!isConfigKey(entry.key)) continue

    versions[entry.key] = entry.version

    if (entry.value === null || entry.value === undefined) {
      unsetKeys.push(entry.key)
      continue
    }

    const parsed = configSchemas[entry.key].safeParse(entry.value)
    if (!parsed.success) {
      throw new ConfigError(
        'INVALID',
        entry.key,
        `Platform configuration "${entry.key}" v${String(entry.version)} is invalid: ` +
          parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }
    values.set(entry.key, parsed.data)
  }

  const missingKeys = (Object.keys(configSchemas) as ConfigKey[]).filter(
    (key) => !values.has(key) && !unsetKeys.includes(key),
  )

  return Object.freeze({
    resolvedAt,
    versions: Object.freeze(versions),
    unsetKeys: Object.freeze(unsetKeys),
    missingKeys: Object.freeze(missingKeys),

    get<K extends ConfigKey>(key: K): ConfigValue<K> | undefined {
      return values.get(key) as ConfigValue<K> | undefined
    },

    require<K extends ConfigKey>(key: K): ConfigValue<K> {
      const value = values.get(key)
      if (value === undefined) {
        throw new ConfigError(
          'NOT_SET',
          key,
          `Platform configuration "${key}" is not set. This is an open product decision; the ` +
            'operation refuses to proceed rather than assume a business parameter.',
        )
      }
      return value as ConfigValue<K>
    },

    has(key: ConfigKey): boolean {
      return values.has(key)
    },
  })
}

/** An empty snapshot. Every `require` throws — useful in tests that must not depend on config. */
export function emptyConfigSnapshot(resolvedAt: Date): ConfigSnapshot {
  return createConfigSnapshot([], resolvedAt)
}
